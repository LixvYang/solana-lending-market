/** INPUT: DATABASE_URL、本地 SQL。 OUTPUT: 迁移命令。 POSITION: EP6 pg 入口。 SYNC: 同步 folder.md。 */
import { runStoreCommand, reportError } from './store-command';
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--help') console.log('用法: migrate');
else if (args.length) reportError(new Error('用法: migrate'));
else void runStoreCommand(async () => { console.log('migrations applied'); }, true).catch(reportError);
