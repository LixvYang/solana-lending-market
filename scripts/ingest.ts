/** INPUT: RPC_URL、DATABASE_URL、CLI 模式。 OUTPUT: finalized 入库/解码/当前账户快照。 POSITION: EP6 只读链上采集入口。 SYNC: 同步 folder.md。 */
import { parseIngestArgs, ingestUsage } from './ingest-options';
import { runStoreCommand, reportError } from './store-command';
import { Rpc } from '../src/ingest/rpc';
import { backfill } from '../src/ingest/signatures';
import { tailOnce } from '../src/ingest/tail';
import { finalizeSweep } from '../src/ingest/finalize';
import { syncStored } from '../src/store/sync';
import { followOnce, followInterval } from '../src/ingest/follow';
import { marginfiIdl } from '../src/decoder/idl';
import { startWorkerHealth } from '../src/core/worker-health';
import { hostAddress, portNumber } from '../src/api/server';
async function main() {
  const parsed = followInterval(process.argv.slice(2));
  const args = parsed.args;
  if (args.length === 1 && args[0] === '--help') { console.log('用法: ' + ingestUsage.replace(/^用法: /, '')); return; }
  const options = parseIngestArgs(args);
  if (!process.env.RPC_URL) throw new Error('RPC_URL is required');
  // 跟随模式默认 confirmed:交易几秒内就能出现在页面上;之后由终局清扫确认或删除(见 src/ingest/finalize.ts)。
  // 回填和扫区间永远 finalized。
  const commitment = options.commitment ?? (options.mode === 'follow' ? 'confirmed' : 'finalized');
  const health = startWorkerHealth(parsed.seconds * 1000, process.env.PORT ? portNumber(process.env.PORT) : undefined, hostAddress());
  let stopped = false;
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => { stopped = true; });
  const rpc = new Rpc(process.env.RPC_URL, { commitment });
  let lastSnapshotAt: number | null = null;
  try { await runStoreCommand(async db => {
    while (!stopped) {
      if (options.mode === 'follow') {
        const now = Date.now();
        const result = await followOnce(db, rpc, marginfiIdl.address, commitment === 'finalized', lastSnapshotAt, now,
          () => syncStored(db, rpc, marginfiIdl), () => finalizeSweep(db, rpc));
        lastSnapshotAt = result.snapshotAt;
        health.success();
        // 15 秒 × 每月约 2,880 分钟 = 8.64 万次签名查询；5 分钟兜底快照约 8,640 次账户/预言机批量调用，另加新交易及 pending 清扫。
        console.log(`${new Date(now).toISOString()} inserted=${result.inserted} snapshot=${result.snapshot} sweep=${result.sweep}`);
        if (options.once) return;
        await new Promise<void>(resolve => {
          const done = () => { clearTimeout(timer); process.off('SIGINT', done); process.off('SIGTERM', done); resolve(); };
          const timer = setTimeout(done, parsed.seconds * 1000);
          process.once('SIGINT', done); process.once('SIGTERM', done);
        });
        continue;
      }
      // tail:逐 slot getBlock，只适合扫一小段；追赶历史请用 backfill。
      const inserted = options.mode === 'backfill' ? await backfill(db, rpc, marginfiIdl.address)
        : await tailOnce(db, rpc, marginfiIdl.address, options.from, options.to);
      const { decoded, snapshots } = await syncStored(db, rpc, marginfiIdl);
      health.success();
      const sweep = commitment === 'confirmed' ? await finalizeSweep(db, rpc) : null;
      console.log(`inserted=${inserted} decoded=${decoded} snapshots=${snapshots}${sweep ? ` finalized=${sweep.finalized} dropped=${sweep.dropped} pending=${sweep.pending}` : ''}`);
      if (options.mode === 'backfill' || options.once || options.to !== undefined) return;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }); } finally { await health.close(); }
}
void main().catch(reportError);
