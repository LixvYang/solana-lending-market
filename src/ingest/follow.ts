/** INPUT: Db 与一次跟随轮询的动作。 OUTPUT: 入库、快照、清扫计数。 POSITION: EP6 常驻跟随的低频 RPC 编排。 */
import type { Db } from '../store/db';
import type { Idl } from '../decoder/idl';
import { backfill, type SignatureRpc } from './signatures';

export const SNAPSHOT_INTERVAL_MS = 5 * 60_000;
export function followInterval(args: string[]): { args: string[]; seconds: number } {
  const index = args.indexOf('--interval');
  if (index < 0) return { args, seconds: 15 };
  if (index !== args.lastIndexOf('--interval') || !args.includes('--follow')) throw new Error('用法: --interval 只用于 --follow');
  const raw = args[index + 1];
  if (!raw || !/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) < 1) throw new Error('invalid --interval seconds');
  return { args: args.filter((_, i) => i !== index && i !== index + 1), seconds: Number(raw) };
}
export interface FollowRpc extends SignatureRpc {}
export interface FollowResult {
  inserted: number;
  snapshot: boolean;
  sweep: boolean;
  decoded: number;
  snapshots: number;
  finalized?: number;
  dropped?: number;
  pending?: number;
}

export async function followOnce(db: Db, rpc: FollowRpc, programId: string, finalized: boolean,
  lastSnapshotAt: number | null, now: number,
  sync: () => Promise<{ decoded: number; snapshots: number }>,
  sweep: () => Promise<{ finalized: number; dropped: number; pending: number }>): Promise<FollowResult & { snapshotAt: number }> {
  const inserted = await backfill(db, rpc, programId, { stopAtKnown: true, finalized });
  const snapshot = inserted > 0 || lastSnapshotAt === null || now - lastSnapshotAt >= SNAPSHOT_INTERVAL_MS;
  const synced = snapshot ? await sync() : { decoded: 0, snapshots: 0 };
  const pendingRows = await db.query('SELECT 1 FROM raw_tx WHERE NOT finalized LIMIT 1');
  const swept = !finalized && pendingRows.rowCount ? await sweep() : null;
  return { inserted, snapshot, sweep: swept !== null, decoded: synced.decoded, snapshots: synced.snapshots,
    ...(swept ?? {}), snapshotAt: snapshot ? now : lastSnapshotAt! };
}
