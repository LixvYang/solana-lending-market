/** INPUT: PGlite、fixture、假签名 RPC。 OUTPUT: 跟随轮次 RPC 预算断言。 POSITION: EP6 跟随编排测试。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fixture from '../../fixtures/m1-transactions.json';
import type { RawTransaction } from './rpc';
import { marginfiIdl } from '../decoder/idl';
import { pgliteDb } from '../store/db';
import { migrate } from '../store/migrate';
import { insertRawTx } from '../store/raw';
import { followOnce, followInterval } from './follow';
const sample = structuredClone(Object.values(fixture.transactions).find(tx => tx.transaction.message.accountKeys.includes(marginfiIdl.address))!) as RawTransaction;
const tx = (signature: string) => ({ ...structuredClone(sample), transaction: { ...sample.transaction, signatures: [signature] } });

test('--interval changes only follow delay and rejects invalid use', () => {
  assert.deepEqual(followInterval(['--follow', '--interval', '30']), { args: ['--follow'], seconds: 30 });
  assert.deepEqual(followInterval(['--follow']), { args: ['--follow'], seconds: 15 });
  assert.throws(() => followInterval(['--tail', '--interval', '30']), /只用于/);
  assert.throws(() => followInterval(['--follow', '--interval', '0']), /invalid/);
});

test('idle follow does one signature RPC, skips snapshots, and does not sweep without pending rows', async () => {
  const db = pgliteDb();
  try {
    await migrate(db); await insertRawTx(db, tx('known'));
    let signatureCalls = 0, syncCalls = 0, sweepCalls = 0;
    const rpc = { getSignaturesForAddress: async () => { signatureCalls++; return [{ signature: 'known', err: null }]; }, getTransaction: async () => null };
    const result = await followOnce(db, rpc, marginfiIdl.address, false, 10_000, 20_000,
      async () => { syncCalls++; return { decoded: 0, snapshots: 0 }; }, async () => { sweepCalls++; return { finalized: 0, dropped: 0, pending: 0 }; });
    assert.equal(signatureCalls, 1); assert.equal(syncCalls, 0); assert.equal(sweepCalls, 0);
    assert.equal(result.snapshot, false); assert.equal(result.sweep, false);
  } finally { await db.close(); }
});

test('new transaction snapshots; five-minute deadline snapshots even when idle; pending rows trigger sweep', async () => {
  const db = pgliteDb();
  try {
    await migrate(db); await insertRawTx(db, tx('known'));
    let signatureCalls = 0, syncCalls = 0, sweepCalls = 0;
    const rpc = { getSignaturesForAddress: async () => { signatureCalls++; return signatureCalls === 1 ? [{ signature: 'new', err: null }, { signature: 'known', err: null }] : [{ signature: 'known', err: null }]; },
      getTransaction: async (signature: string) => signature === 'new' ? tx('new') : null };
    const sync = async () => { syncCalls++; return { decoded: 1, snapshots: 2 }; };
    const sweep = async () => { sweepCalls++; return { finalized: 0, dropped: 0, pending: 1 }; };
    const first = await followOnce(db, rpc, marginfiIdl.address, false, 0, 1_000, sync, sweep);
    assert.equal(first.inserted, 1); assert.equal(first.snapshot, true); assert.equal(first.sweep, true);
    const due = await followOnce(db, rpc, marginfiIdl.address, false, 1_000, 301_000, sync, sweep);
    assert.equal(due.inserted, 0); assert.equal(due.snapshot, true); assert.equal(syncCalls, 2);
    assert.equal(signatureCalls, 2); assert.equal(sweepCalls, 2);
  } finally { await db.close(); }
});
