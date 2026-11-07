/** INPUT: 精确假 feed、假时钟与刷新错误。 OUTPUT: keeper 指令/恢复/五次退出。 POSITION: EP8 离线验证。 SYNC: folder.md。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { PublicKey } from '@solana/web3.js';
import { feedInfo, mockOwner } from '../api/wallet-test-utils';
import { priceInstruction, refreshPrices, type PriceRpc } from './price';
import { keeperLoop, intervalMs } from './loop';
import { createHash } from 'node:crypto';
import { decodePullFeed } from '../decoder/switchboard';
const rpc: PriceRpc = { getMultipleAccountsInfo: async keys => keys.map(() => feedInfo(1700000000, 50123456789012345678n)), getSlot: async () => 333,
  getBlockTime: async () => 1700000060 };
test('keeper only emits refresh_timestamp and cannot alter price bytes', async () => {
  const value = await priceInstruction(rpc, mockOwner, 'tSOL'), ix = value.instruction;
  assert.equal(ix.keys[0].isSigner, false); assert.equal(ix.keys[0].isWritable, true);
  assert.deepEqual(ix.data, createHash('sha256').update('global:refresh_timestamp').digest().subarray(0, 8));
  const bytes = feedInfo().data;
  assert.equal(decodePullFeed(bytes).price.numerator, 50n * 10n ** 18n);
  let reads = 0, slots = 0, times = 0;
  const batchRpc = { ...rpc, getMultipleAccountsInfo: async (keys: PublicKey[]) => { reads++; return keys.map(() => feedInfo(1700000000, 50123456789012345678n)); },
    getSlot: async () => { slots++; return 333; }, getBlockTime: async () => { times++; return 1700001000; } };
  const sent: string[][] = [];
  await refreshPrices(batchRpc, mockOwner, async values => { sent.push(values.map(v => v.label)); });
  assert.equal(reads, 1); assert.equal(slots, 1); assert.equal(times, 1); assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], ['tUSDC', 'tSOL', 'tHYPE']);
  await assert.rejects(priceInstruction({ ...rpc, getBlockTime: async () => null }, mockOwner, 'tSOL'), /time unavailable/);
  await assert.rejects(priceInstruction({ ...rpc, getMultipleAccountsInfo: async () => [null] }, mockOwner, 'tSOL'), /owner/);
});
test('keeper survives transient RPC failure, resets consecutive counter, exits only after five; safe logs', async () => {
  let calls = 0, waits = 0; const logs: string[] = [];
  const recovered = await keeperLoop(async () => { calls++; await priceInstruction({ ...rpc, getMultipleAccountsInfo: async () => {
    if (calls === 1) throw Error('RPC_URL api-key=secret private key'); return [feedInfo()];
  } }, mockOwner, 'tSOL'); }, async ms => { assert.equal(ms, 60000); waits++; }, 60000, () => calls >= 3, msg => logs.push(msg));
  assert.equal(recovered, 0); assert.equal(calls, 3); assert.equal(waits, 2);
  assert.ok(!/RPC_URL|api-key|secret|private/.test(logs.join()));
  calls = 0; waits = 0;
  const failed = await keeperLoop(async () => { calls++; if (calls !== 5) throw Error('failure'); }, async () => { waits++; }, 60000, () => false, msg => logs.push(msg));
  assert.equal(failed, 1); assert.equal(calls, 10); assert.equal(waits, 9); // 4失败、1成功、再5失败。
  assert.equal(intervalMs([]), 180000); assert.equal(intervalMs(['--interval', '5']), 5000);
  for (const args of [['--interval', '0'], ['--interval', '1.5'], ['--bad']]) assert.throws(() => intervalMs(args));
});
test('keeper 只跳过再等两轮也不会过期的价格:tSOL/tUSDC(240 秒)每轮刷新,tHYPE(900 秒)年龄过 540 秒才刷新', async () => {
  const at = (age: number) => ({ ...rpc, getMultipleAccountsInfo: async (keys: PublicKey[]) => keys.map(() => feedInfo(1700000600 - age, 50)),
    getBlockTime: async () => 1700000600 });
  const labels = async (age: number) => (await refreshPrices(at(age), mockOwner, async () => 'sig')).values.map(v => v.label);
  assert.deepEqual(await labels(0), ['tUSDC', 'tSOL']);
  assert.deepEqual(await labels(539), ['tUSDC', 'tSOL']);
  assert.deepEqual(await labels(540), ['tUSDC', 'tSOL', 'tHYPE']);
});
