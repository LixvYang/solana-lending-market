/** INPUT: KEEPER_KEYPAIR/RPC_URL、--interval 秒。 OUTPUT: 价格时间戳维护。 POSITION: EP8 独立专用钱包进程。 SYNC: folder.md。 */
import 'dotenv/config';
import { mocksProgram } from '../scenario/lib/mock-feed';
import { refreshPrices } from '../src/keeper/price';
import { keeperLoop, intervalMs } from '../src/keeper/loop';
import { cliRpc, readKeypair, sendInstructions } from './admin-runtime';
import { realClock } from '../src/api/wallet-rpc';
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') { console.log('用法: price-keeper [--interval 秒] (默认 180)'); return; }
  if (!process.env.KEEPER_KEYPAIR) throw Error('缺少 KEEPER_KEYPAIR:请配置专用 keeper 钱包文件路径,不要在服务器上放管理员钱包');
  const interval = intervalMs(args), payer = readKeypair(process.env.KEEPER_KEYPAIR), rpc = cliRpc(), program = mocksProgram();
  let stopped = false;
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { stopped = true; });
  process.exitCode = await keeperLoop(async () => {
    try {
      const { values, signature } = await refreshPrices(rpc, program, batch => sendInstructions(rpc, payer,
        batch.map(value => value.instruction), batch.map(value => value.signer)));
      console.log(`${new Date().toISOString()} refreshed=${values.map(v => v.label).join(',') || 'none'} signature=${signature ?? 'none'}`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.log(`${new Date().toISOString()} refreshed=none failure=${reason.replace(/https?:\/\/\S+/g, '[rpc]').replace(/(api.?key|token|secret|private.?key)[=: ]+\S+/gi, '$1=[redacted]').slice(0, 200)}`);
      throw error;
    }
  }, realClock.sleep, interval, () => stopped, () => {});
}
void main().catch(error => {
  const reason = error instanceof Error ? error.message : String(error);
  console.error(`price keeper startup failed: ${reason}`);
  process.exitCode = 1;
});
