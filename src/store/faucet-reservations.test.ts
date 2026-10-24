import test from 'node:test';
import assert from 'node:assert/strict';
import { pgliteDb } from './db';
import { migrate } from './migrate';
import { createFaucetReservations } from './faucet-reservations';

test('database faucet reservations reuse the sliding window rules and expose quota', async () => {
  const db = pgliteDb();
  try {
    await migrate(db);
    const limits = createFaucetReservations(db, () => 1_700_000_000_000);
    assert.deepEqual(await limits.quota(5, 2), { max: 2, remaining: 2, window_hours: 5, resets_at: null });
    assert.equal((await limits.reserve('wallet-a', '192.0.2.1', 5, 2)).ok, true);
    assert.deepEqual(await limits.quota(5, 2), { max: 2, remaining: 1, window_hours: 5, resets_at: null });
    assert.equal((await limits.reserve('wallet-a', '192.0.2.1', 5, 2)).ok, false);
    assert.equal((await limits.reserve('wallet-b', '192.0.2.2', 5, 2)).ok, true);
    const full = await limits.reserve('wallet-c', '192.0.2.3', 5, 2);
    assert.deepEqual(full, { ok: false, next: 1_700_018_000_000, reason: 'window' });
    assert.deepEqual(await limits.quota(5, 2), { max: 2, remaining: 0, window_hours: 5, resets_at: new Date(1_700_018_000_000).toISOString() });
  } finally { await db.close(); }
});

test('concurrent database reservations cannot exceed the site window maximum', async () => {
  const db = pgliteDb();
  try {
    await migrate(db);
    const limits = createFaucetReservations(db, () => 1_700_000_000_000);
    const results = await Promise.all(['wallet-a', 'wallet-b'].map(wallet => limits.reserve(wallet, wallet, 5, 1)));
    assert.equal(results.filter(result => result.ok).length, 1);
    assert.equal((await limits.quota(5, 1)).remaining, 0);
  } finally { await db.close(); }
});
