import test from 'node:test';
import assert from 'node:assert/strict';
import { pgliteDb } from '../store/db';
import { migrate } from '../store/migrate';
import { acquireSyncLease, finishSync } from './vercel-sync';

test('on-demand sync lease is throttled, exclusive, expires, and persists snapshot time', async () => {
  const db = pgliteDb();
  try {
    await migrate(db);
    const now = 1_700_000_000_000;
    const claims = await Promise.all([acquireSyncLease(db, now), acquireSyncLease(db, now)]);
    assert.equal(claims.filter(Boolean).length, 1);
    const lease = claims.find(Boolean)!;
    assert.equal(await acquireSyncLease(db, now + 29_999), null);
    assert.equal(await acquireSyncLease(db, now + 59_999), null);
    const expired = await acquireSyncLease(db, now + 60_001);
    assert.equal(expired?.lastSnapshotAt, null);
    await finishSync(db, now + 61_001, now);
    assert.equal(await acquireSyncLease(db, now + 91_000), null);
    const next = await acquireSyncLease(db, now + 91_001);
    assert.equal(next?.lastSnapshotAt, now);
    await finishSync(db, now + 92_001, next!.lastSnapshotAt);
    assert.equal(await acquireSyncLease(db, now + 122_000), null);
    assert.ok(lease.lastSnapshotAt === null);
  } finally { await db.close(); }
});
