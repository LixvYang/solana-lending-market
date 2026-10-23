/** INPUT: KEEPER_KEYPAIR/RPC_URL、--interval 秒。 OUTPUT: 价格时间戳维护。 POSITION: EP8 独立专用钱包进程。 SYNC: folder.md。 */
import 'dotenv/config';
import { mocksProgram } from '../scenario/lib/mock-feed';
import { refreshPrices } from '../src/keeper/price';
import { keeperLoop, intervalMs } from '../src/keeper/loop';
import { cliRpc, serviceKeypair, sendInstructions } from './admin-runtime';
import { startWorkerHealth } from '../src/core/worker-health';
import { hostAddress, portNumber } from '../src/api/server';
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') { console.log('用法: price-keeper [--interval 秒] (默认 180)'); return; }
  const interval = intervalMs(args), payer = serviceKeypair(process.env.KEEPER_SECRET_KEY, process.env.KEEPER_KEYPAIR, 'KEEPER'), rpc = cliRpc(), program = mocksProgram();
  const health = startWorkerHealth(interval, process.env.PORT ? portNumber(process.env.PORT) : undefined, hostAddress());
  let stopped = false;
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { stopped = true; });
  process.exitCode = await keeperLoop(async () => {
    try {
      const { values, signature } = await refreshPrices(rpc, program, batch => sendInstructions(rpc, payer,
        batch.map(value => value.instruction), batch.map(value => value.signer)));
      health.success();
      console.log(`${new Date().toISOString()} refreshed=${values.map(v => v.label).join(',') || 'none'} signature=${signature ?? 'none'}`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.log(`${new Date().toISOString()} refreshed=none failure=${reason.replace(/https?:\/\/\S+/g, '[rpc]').replace(/(api.?key|token|secret|private.?key)[=: ]+\S+/gi, '$1=[redacted]').slice(0, 200)}`);
      throw error;
    }
  }, ms => new Promise(resolve => {
    const done = () => { clearTimeout(timer); process.off('SIGINT', done); process.off('SIGTERM', done); resolve(); };
    const timer = setTimeout(done, ms);
    process.once('SIGINT', done); process.once('SIGTERM', done);
  }), interval, () => stopped, () => {});
  await health.close();
}
void main().catch(error => {
  const reason = error instanceof Error ? error.message : String(error);
  console.error(`price keeper startup failed: ${reason}`);
  process.exitCode = 1;
});
