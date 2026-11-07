/** INPUT: tHYPE PullFeed and fake RPC. OUTPUT: keeper refresh list without feed signatures. POSITION: offline keeper test. SYNC: folder.md. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
import { feedInfo, mockOwner } from '../api/wallet-test-utils';
import { PRICE_TOKENS, priceInstruction, refreshPrices } from './price';
import { keeperLoop, intervalMs } from './loop';
import type { PriceRpc } from './price';

const refreshDisc = createHash('sha256').update('global:refresh_timestamp').digest().subarray(0, 8);
const rpc: PriceRpc = { getMultipleAccountsInfo: async keys => keys.map(() => feedInfo()), getSlot: async () => 333,
  getBlockTime: async () => 1700000060 };

test('keeper emits a public timestamp refresh with no feed signer or price payload', async () => {
  assert.deepEqual(PRICE_TOKENS, ['tUSDC', 'tSOL', 'tHYPE']);
  const value = await priceInstruction(rpc, mockOwner, 'tHYPE'), ix = value.instruction;
  assert.ok(ix.programId.equals(mockOwner)); assert.equal(ix.keys.length, 1);
  assert.equal(ix.keys[0].isSigner, false); assert.equal(ix.keys[0].isWritable, true);
  assert.deepEqual(ix.data, refreshDisc);
  let reads = 0, slots = 0, times = 0;
  const batchRpc = { ...rpc,
    getMultipleAccountsInfo: async (keys: PublicKey[]) => { reads++; return keys.map(() => feedInfo()); },
    getSlot: async () => { slots++; return 333; }, getBlockTime: async () => { times++; return 1700000060; } };
  const sent: string[][] = [];
  await refreshPrices(batchRpc, mockOwner, async values => { sent.push(values.map(v => v.label)); });
  assert.equal(reads, 1); assert.equal(slots, 1); assert.equal(times, 1);
  assert.deepEqual(sent, [['tUSDC', 'tSOL']]);
  await assert.rejects(priceInstruction({ ...rpc, getBlockTime: async () => null }, mockOwner, 'tSOL'), /time unavailable/);
  await assert.rejects(priceInstruction({ ...rpc, getMultipleAccountsInfo: async () => [null] }, mockOwner, 'tSOL'), /owner/);
  const invalid = feedInfo(); invalid.data[0] ^= 1;
  await assert.rejects(priceInstruction({ ...rpc, getMultipleAccountsInfo: async () => [invalid] }, mockOwner, 'tSOL'), /feed/);
});

test('keeper survives transient RPC failure and exits only after five consecutive failures', async () => {
  let calls = 0, waits = 0; const logs: string[] = [];
  const recovered = await keeperLoop(async () => { calls++; await priceInstruction({ ...rpc,
    getMultipleAccountsInfo: async () => { if (calls === 1) throw Error('RPC_URL api-key=secret private key'); return [feedInfo()]; },
  }, mockOwner, 'tSOL'); }, async ms => { assert.equal(ms, 60000); waits++; }, 60000, () => calls >= 3, msg => logs.push(msg));
  assert.equal(recovered, 0); assert.equal(calls, 3); assert.equal(waits, 2);
  assert.ok(!/RPC_URL|api-key|secret|private/.test(logs.join()));
  calls = 0; waits = 0;
  const failed = await keeperLoop(async () => { calls++; if (calls !== 5) throw Error('failure'); }, async () => { waits++; }, 60000, () => false, msg => logs.push(msg));
  assert.equal(failed, 1); assert.equal(calls, 10); assert.equal(waits, 9);
  assert.equal(intervalMs([]), 180000); assert.equal(intervalMs(['--interval', '5']), 5000);
  for (const args of [['--interval', '0'], ['--interval', '1.5'], ['--bad']]) assert.throws(() => intervalMs(args));
});

test('keeper only refreshes feeds that would expire before two more intervals', async () => {
  const at = (age: number) => ({ ...rpc, getMultipleAccountsInfo: async (keys: PublicKey[]) => keys.map(() => feedInfo(1700000600 - age)),
    getBlockTime: async () => 1700000600 });
  const labels = async (age: number) => (await refreshPrices(at(age), mockOwner, async () => 'sig')).values.map(v => v.label);
  assert.deepEqual(await labels(0), ['tUSDC', 'tSOL']);
  assert.deepEqual(await labels(539), ['tUSDC', 'tSOL']);
  assert.deepEqual(await labels(540), ['tUSDC', 'tSOL', 'tHYPE']);
});
