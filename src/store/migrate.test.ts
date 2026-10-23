/** INPUT: PGlite、本地 SQL。 OUTPUT: 重复迁移与回滚断言。 POSITION: EP6 离线测试。 SYNC: 同步 folder.md。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pgliteDb } from './db';
import { assertMigrated, migrate } from './migrate';
import type { Db, Row } from './db';
test('migrations run once and create every table and query index', async () => {
  const db = pgliteDb();
  try {
    await migrate(db); await migrate(db);
    await assertMigrated(db);
    assert.equal((await db.query('SELECT * FROM schema_migrations')).rowCount, 4);
    const tables = (await db.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")).rows.map(r => r.tablename);
    for (const name of ['raw_tx', 'ingest_cursor', 'instructions', 'events', 'account_states', 'labels']) assert.ok(tables.includes(name));
    const indexes = (await db.query("SELECT indexname FROM pg_indexes WHERE schemaname = 'public'")).rows.map(r => r.indexname);
    for (const name of ['instructions_name_idx', 'events_name_idx', 'events_slot_idx', 'events_account_idx', 'raw_tx_unfinalized_idx']) assert.ok(indexes.includes(name));
    // 004:乐观入库的标记列,默认 TRUE(迁移前已有的行都是 finalized 入库的)
    const column = (await db.query("SELECT column_default FROM information_schema.columns WHERE table_name = 'raw_tx' AND column_name = 'finalized'")).rows[0];
    assert.match(String(column.column_default), /true/i);
  } finally { await db.close(); }
});
test('deployment migrations request a session advisory lock', async () => {
  const base = pgliteDb(), calls: string[] = [];
  const wrap = (baseDb: Db): Db => ({
    query: async <T extends Row>(sql: string, params?: unknown[]) => {
      if (sql.includes('pg_advisory_xact_lock')) { calls.push(sql); return { rows: [], rowCount: 1 }; }
      return baseDb.query<T>(sql, params);
    },
    transaction: <T>(fn: (tx: Db) => Promise<T>) => baseDb.transaction(tx => fn(wrap(tx))),
    withAdvisoryLock: async <T>(key: number, fn: (locked: Db) => Promise<T>) => {
      calls.push(`pg_advisory_lock:${key}`); return fn(wrap(baseDb));
    },
  });
  const db = wrap(base);
  try { await migrate(db, undefined, true); assert.deepEqual(calls, ['pg_advisory_lock:1979633716']); await assertMigrated(base); }
  finally { await base.close(); }
});
test('one failing SQL file rolls back its DDL and migration record', async () => {
  const db = pgliteDb(), directory = await mkdtemp(join(tmpdir(), 'm4-migrations-'));
  try {
    await writeFile(join(directory, '001_bad.sql'), 'CREATE TABLE accidental(n int); SELECT missing_column;');
    await assert.rejects(migrate(db, directory), /missing_column/);
    assert.equal((await db.query("SELECT to_regclass('accidental') AS name")).rows[0].name, null);
    assert.equal((await db.query('SELECT * FROM schema_migrations')).rowCount, 0);
  } finally { await db.close(); await rm(directory, { recursive: true }); }
});
