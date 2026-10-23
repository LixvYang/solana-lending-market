/** Single container entrypoint. SERVICE selects one long-running process. */
import 'dotenv/config';
import { pgDb } from '../src/store/db';
import { assertMigrated, migrate } from '../src/store/migrate';
import { selectedService } from './service';
async function main() {
  const service = selectedService(process.env.SERVICE);
  let stopping = false;
  // 只在收到退出信号后才开始 10 秒倒计时：各服务自己会平滑收尾(关连接、跑完当前轮次),这里只兜底防卡死。
  // 不能在启动时就设定时器——那样每个服务都会在启动 10 秒后自杀(曾实测发生)。
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => {
    stopping = true;
    setTimeout(() => process.exit(1), 10_000).unref();
  });
  const db = pgDb();
  try {
    if (service === 'api') await migrate(db, undefined, true);
    else await assertMigrated(db);
  } finally { await db.close(); }
  if (stopping) return;
  if (service === 'api') await import('./serve-api');
  else if (service === 'faucet') await import('./faucet');
  else if (service === 'keeper') await import('./price-keeper');
  else {
    process.argv = [process.argv[0], process.argv[1], '--follow'];
    await import('./ingest');
  }
}
// 云平台上只能看日志排查，所以要打印真实原因;连接串里的密码与 RPC 的 api-key 打码。
const redact = (text: string) => text.replace(/(\/\/[^:\/\s]+:)[^@\s]+@/g, '$1***@').replace(/api-key=[^\s&"']+/g, 'api-key=***');
void main().catch(error => { console.error(`service startup failed: ${redact(error instanceof Error ? error.message : String(error))}`); process.exitCode = 1; });
