/**
 * INPUT: pg Pool 或进程内 PGlite。
 * OUTPUT: Db、pgDb、pgliteDb；SQL BIGINT 顶层结果统一为十进制字符串。
 * POSITION: EP6 唯一数据库适配边界。SYNC: 同步 folder.md。
 */
import { Pool, type PoolClient } from 'pg';
import { PGlite, type Transaction } from '@electric-sql/pglite';
export type Row = Record<string, unknown>;
export interface Db {
  query<T extends Row = Row>(sql: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number }>;
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  withAdvisoryLock?<T>(key: number, fn: (locked: Db) => Promise<T>): Promise<T>;
}
export function normalizeRows<T extends Row>(rows: T[], fields: { name: string; dataTypeID: number }[] = []): T[] {
  const int8 = new Set(fields.filter(field => field.dataTypeID === 20).map(field => field.name));
  // 只转换 SQL 列；JSONB 内的字符串/数字由存储格式决定，不猜测其类型。
  return rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) =>
    [key, value !== null && (typeof value === 'bigint' || int8.has(key)) ? String(value) : value])) as T);
}
function pgConnection(connection: Pool | PoolClient): Db {
  return {
    async query<T extends Row>(sql: string, params: unknown[] = []) {
      // 无参数的多语句 SQL(迁移文件)pg 会返回结果数组，取最后一条；PGlite 的 exec 也是同样语义。
      // 这个差异只有连真实 Postgres 才会暴露，PGlite 测试看不出来。
      const raw = await connection.query(sql, params) as unknown;
      const result = (Array.isArray(raw) ? raw.at(-1) : raw) as { rows: T[]; fields?: { name: string; dataTypeID: number }[]; rowCount: number | null };
      return { rows: normalizeRows(result.rows, result.fields) as T[], rowCount: result.rowCount ?? 0 };
    },
    async transaction<T>(fn: (tx: Db) => Promise<T>) {
      // Pool 的每条 query 可选不同连接；事务必须固定到同一个 client。
      const pool = 'totalCount' in connection ? connection as Pool : null;
      const client = pool ? await pool.connect() : connection as PoolClient;
      try {
        await client.query('BEGIN');
        const result = await fn(pgConnection(client));
        await client.query('COMMIT');
        return result;
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { if (pool) client.release(); }
    },
  };
}
export function pgDb(pool: Pool = new Pool({ connectionString: process.env.DATABASE_URL ??
  'postgres://indexer:indexer@localhost:5433/indexer', max: poolMax(process.env.PG_POOL_MAX) })) {
  return { ...pgConnection(pool), close: () => pool.end(), withAdvisoryLock: async <T>(key: number, fn: (locked: Db) => Promise<T>) => {
    const client = await pool.connect();
    let locked = false;
    try {
      await client.query('SELECT pg_advisory_lock($1)', [key]); locked = true;
      return await fn(pgConnection(client));
    } finally {
      if (locked) {
        try { await client.query('SELECT pg_advisory_unlock($1)', [key]); client.release(); }
        catch (error) { client.release(error as Error); throw error; }
      } else client.release();
    }
  } };
}
export function poolMax(value: string | undefined): number {
  if (value === undefined) return 5;
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 100) throw new Error('invalid PG_POOL_MAX');
  return Number(value);
}
export function pgliteDb(database = new PGlite()) {
  const adapt = (connection: PGlite | Transaction): Db => ({
    async query<T extends Row>(sql: string, params: unknown[] = []) {
      // PGlite 的 extended query 不接受多个 SQL statement；迁移没有参数，走 exec。
      const results = params.length ? [await connection.query<T>(sql, params)] : await connection.exec(sql);
      const result = results.at(-1);
      return { rows: normalizeRows((result?.rows ?? []) as T[], result?.fields), rowCount: result?.rows.length || result?.affectedRows || 0 };
    },
    transaction: fn => {
      if (!('transaction' in connection)) throw new Error('nested transactions are not supported');
      return connection.transaction(tx => fn(adapt(tx)));
    },
  });
  return { ...adapt(database), close: () => database.close() };
}
