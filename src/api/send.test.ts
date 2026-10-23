/** INPUT: 合成签名交易、假 RPC/时钟。 OUTPUT: 转发守卫/幂等/超时断言。 POSITION: EP8 离线验收。 SYNC: folder.md。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction, PublicKey } from '@solana/web3.js';
import { marginfiIdl } from '../decoder/idl';
import { guardTransaction, sendTransaction } from './send';
import { fakeRpc, fakeClock } from './wallet-test-utils';
import { programError, publicLogs } from './program-error';
export function signedFixture(marginfi = true) {
  const payer = Keypair.generate();
  const instructions = marginfi ? [new TransactionInstruction({ programId: new PublicKey(marginfiIdl.address), keys: [{ pubkey: payer.publicKey, isSigner: true, isWritable: true }], data: Buffer.from(marginfiIdl.instructions[0].discriminator) })]
    : [SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: PublicKey.default, lamports: 1 })];
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: PublicKey.default.toBase58(), instructions }).compileToV0Message());
  tx.sign([payer]);
  return { tx, input: { transaction: Buffer.from(tx.serialize()).toString('base64') } };
}
test('send rejects no marginfi, unsigned payer, forged signature, malformed/oversized bytes and non-signer payer', () => {
  assert.throws(() => guardTransaction(signedFixture(false).input), /marginfi/);
  const { tx } = signedFixture();
  tx.signatures[0].fill(0); assert.throws(() => guardTransaction({ transaction: Buffer.from(tx.serialize()).toString('base64') }), /signature/);
  tx.signatures[0].fill(1); assert.throws(() => guardTransaction({ transaction: Buffer.from(tx.serialize()).toString('base64') }), /signature/);
  tx.message.header.numRequiredSignatures = 0; tx.signatures = [];
  assert.throws(() => guardTransaction({ transaction: Buffer.from(tx.serialize()).toString('base64') }), /fee payer/);
  for (const transaction of ['?', 'AAAA', Buffer.alloc(1233).toString('base64')]) assert.throws(() => guardTransaction({ transaction }));
  const good = signedFixture(); assert.ok(guardTransaction(good.input).bytes.length <= 1232);
  assert.throws(() => guardTransaction({ transaction: Buffer.concat([Buffer.from(good.input.transaction, 'base64'), Buffer.from([0])]).toString('base64') }), /noncanonical/);
});
test('send replays identical bytes at 2s, confirms, duplicate submission succeeds despite send errors', async () => {
  const fixture = signedFixture(), clock = fakeClock(); let polls = 0; const sent: Buffer[] = [];
  const rpc = fakeRpc({ getSignatureStatuses: async () => ({ context: { slot: 21 }, value: [++polls < 3 ? null : { slot: 21, confirmations: 1, err: null, confirmationStatus: 'confirmed' }] }),
    sendRawTransaction: async bytes => { sent.push(Buffer.from(bytes)); throw Error('RPC_URL https://rpc?api-key=secret'); } });
  const response = await sendTransaction(fixture.input, rpc, clock); assert.equal(response.status, 'confirmed'); assert.equal(response.slot, '21');
  assert.equal(sent.length, 2); assert.deepEqual(sent[0], sent[1]); assert.equal(clock.now(), 1700000004000);
  assert.deepEqual(await sendTransaction(fixture.input, rpc, clock), response); assert.equal(sent.length, 2);
  assert.ok(!/RPC_URL|api-key|secret/.test(JSON.stringify(response)));
});
test('send failure translates chain custom error; transient failures continue; 60s gives timeout', async () => {
  const fixture = signedFixture();
  const failed = await sendTransaction(fixture.input, fakeRpc({ getSignatureStatuses: async () => ({ context: { slot: 1 }, value: [{ slot: 99, confirmations: 1, err: { InstructionError: [0, { Custom: 6010 }] }, confirmationStatus: 'confirmed' }] }) }), fakeClock());
  assert.equal(failed.status, 'failed'); assert.equal(failed.error?.name, 'RiskEngineInitRejected'); assert.equal(failed.slot, '99');
  let replays = 0; const clock = fakeClock();
  const timeout = await sendTransaction(fixture.input, fakeRpc({ getSignatureStatuses: async () => { throw Error('api-key=secret'); }, sendRawTransaction: async () => { replays++; return 'ignored'; } }), clock);
  assert.equal(timeout.status, 'timeout'); assert.equal(timeout.error, null); assert.equal(replays, 30); assert.equal(clock.now(), 1700000060000);
  assert.deepEqual(programError('api-key=secret'), { code: null, name: 'Unknown', message: '交易未能执行，请重新构建并重试。' });
  // 代币转账余额不足(SPL Token Custom(1)):真实联调里"还清全部"时钱包只有借到的数、不够付利息就会遇到。
  assert.equal(programError({ InstructionError: [3, { Custom: 1 }] }).name, 'InsufficientFunds');
  assert.match(programError({ InstructionError: [3, { Custom: 1 }] }).message, /利息/);
  assert.deepEqual(publicLogs(['Program log: secret', `Program ${marginfiIdl.address} success`]), ['[program output omitted]', `Program ${marginfiIdl.address} success`]);
});
test('confirmation deadline also bounds an RPC that never resolves', async () => {
  const fixture = signedFixture(); let reads = 0;
  const clock = { now: () => ++reads === 1 ? 0 : reads === 2 ? 59999 : 60000, sleep: async () => {} };
  const result = await sendTransaction(fixture.input, fakeRpc({ getSignatureStatuses: async () => new Promise(() => {}) }), clock);
  assert.equal(result.status, 'timeout');
});

test('confirmed responses report whether immediate indexing succeeded', async () => {
  const fixture = signedFixture();
  const ok = await sendTransaction(fixture.input, fakeRpc(), fakeClock(), async () => {});
  assert.equal(ok.status, 'confirmed');
  assert.equal(ok.indexed, true);

  const failed = await sendTransaction(fixture.input, fakeRpc(), fakeClock(), async () => { throw Error('db unavailable'); });
  assert.equal(failed.status, 'confirmed');
  assert.equal(failed.indexed, false);
});
