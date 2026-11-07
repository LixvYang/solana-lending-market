/** INPUT: Db、一次跟随 RPC。 OUTPUT: 原子租约与按需同步。 POSITION: Vercel 按请求同步，不影响常驻 ingest。 */
import type { Db, Row } from '../store/db';
import { followOnce } from './follow';
import { finalizeSweep } from './finalize';
import { syncStored } from '../store/sync';
import { marginfiIdl } from '../decoder/idl';
import type { Rpc } from './rpc';

const SYNC_INTERVAL_MS = 30_000;
const LEASE_MS = 60_000;
interface SyncRow extends Row { last_snapshot_at: unknown }
const millis = (value: unknown): number | null => value == null ? null : value instanceof Date ? value.getTime() : new Date(String(value)).getTime();

export async function acquireSyncLease(db: Db, now: number) {
  const result = await db.query<SyncRow>(`UPDATE vercel_sync_state SET lease_until = $1
    WHERE singleton = TRUE AND (last_sync_at IS NULL OR last_sync_at <= $2)
      AND (lease_until IS NULL OR lease_until < $3)
    RETURNING last_snapshot_at`, [new Date(now + LEASE_MS), new Date(now - SYNC_INTERVAL_MS), new Date(now)]);
  return result.rowCount ? { lastSnapshotAt: millis(result.rows[0].last_snapshot_at) } : null;
}

export async function finishSync(db: Db, now: number, lastSnapshotAt: number | null) {
  await db.query(`UPDATE vercel_sync_state SET last_sync_at = $1, last_snapshot_at = COALESCE($2, last_snapshot_at), lease_until = NULL WHERE singleton = TRUE`,
    [new Date(now), lastSnapshotAt === null ? null : new Date(lastSnapshotAt)]);
}

export async function maybeSync(db: Db, rpc: Rpc, now = Date.now()): Promise<boolean> {
  let lease: Awaited<ReturnType<typeof acquireSyncLease>>;
  try { lease = await acquireSyncLease(db, now); }
  catch { console.error('on-demand index sync failed'); return false; }
  if (!lease) return false;
  let snapshotAt = lease.lastSnapshotAt;
  try {
    const result = await followOnce(db, rpc, marginfiIdl.address, false, lease.lastSnapshotAt, now,
      () => syncStored(db, rpc, marginfiIdl), () => finalizeSweep(db, rpc));
    snapshotAt = result.snapshotAt;
    return true;
  } catch {
    console.error('on-demand index sync failed');
    return false;
  } finally {
    try { await finishSync(db, Date.now(), snapshotAt); }
    catch { console.error('on-demand index sync state update failed'); }
  }
}
