/** INPUT: Db、本地 SQL 目录。 OUTPUT: migrate。 POSITION: EP6 手写迁移入口。 SYNC: 同步 folder.md。 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Db } from './db';
export async function migrate(db: Db, directory = join(process.cwd(), 'src/store/migrations'), lock = false): Promise<void> {
  const names = (await readdir(directory)).filter(name => name.endsWith('.sql')).sort();
  const run = async (lockedDb: Db) => {
    await lockedDb.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY)');
    for (const name of names) {
      await lockedDb.transaction(async tx => {
        if ((await tx.query('SELECT name FROM schema_migrations WHERE name = $1', [name])).rowCount) return;
        await tx.query(await readFile(join(directory, name), 'utf8'));
        await tx.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
      });
    }
  };
  if (lock) {
    if (!db.withAdvisoryLock) throw new Error('database adapter does not support session advisory locks');
    await db.withAdvisoryLock(1979633716, run);
  } else await run(db);
}
export async function assertMigrated(db: Db, directory = join(process.cwd(), 'src/store/migrations')): Promise<void> {
  const expected = (await readdir(directory)).filter(name => name.endsWith('.sql')).sort();
  const result = await db.query<{ name: string }>('SELECT name FROM schema_migrations ORDER BY name');
  if (expected.some((name, index) => result.rows[index]?.name !== name) || result.rows.length !== expected.length)
    throw new Error('database migrations are incomplete');
}
