/** INPUT: CLI 入口路径、DATABASE_URL。 OUTPUT: runStoreCommand，关闭连接与安全报错。 POSITION: EP6 CLI 公共资源生命周期。 SYNC: 同步 folder.md。 */
import { dirname, join, resolve } from 'node:path';
import { pgDb, type Db } from '../src/store/db';
import { assertMigrated, migrate } from '../src/store/migrate';
export async function runStoreCommand(action: (db: Db) => Promise<void>): Promise<void> {
  const db = pgDb();
  try {
    const directory = join(dirname(resolve(process.argv[1])), '../src/store/migrations');
    if (process.env.SERVICE) await assertMigrated(db, directory);
    else await migrate(db, directory);
    await action(db);
  } finally { await db.close(); }
}
export function reportError(error: unknown): void {
  console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1;
}
