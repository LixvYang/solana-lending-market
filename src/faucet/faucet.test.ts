/** INPUT: 假 RPC、专用钱包、纯限流/指令解码。 OUTPUT: 水龙头离线证据(含可选 Pyth 资产)。 POSITION: EP8 测试。 SYNC: folder.md。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, PublicKey, VersionedTransaction, SystemInstruction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, decodeTransferInstruction, decodeMintToInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { TransactionInstruction } from '@solana/web3.js';
import { emptyLimits, reserve, type LimitState } from './limit';
import { faucetGrants, nativeAmount, dailyLimit } from './config';
import { createFaucet } from './service';
import { faucetRoute } from './server';
import { setupInstructions } from './setup';
import { fakeRpc, fakeClock, tokenInfo, addresses as a } from '../api/wallet-test-utils';
import type { BankView } from '../api/types';
test('pure limiter: wallet 10min, IP rolling hour 5, global UTC day quota/reset and state immutable', () => {
  const now = 1700000000000, initial = emptyLimits();
  const first = reserve(initial, 'w', 'ip', now); assert.ok(first.ok); assert.deepEqual(initial, emptyLimits());
  const blocked = reserve(first.state, 'w', 'other-ip', now + 1); assert.ok(!blocked.ok); assert.equal(blocked.next, now + 600000);
  assert.ok(reserve(first.state, 'w', 'other-ip', now + 600000).ok);
  let state: LimitState = initial;
  for (let i = 0; i < 5; i++) { const hit = reserve(state, `w${i}`, 'same', now + i); assert.ok(hit.ok); state = hit.state; }
  const sixth = reserve(state, 'new', 'same', now + 6); assert.ok(!sixth.ok); assert.equal(sixth.next, now + 3600000);
  assert.ok(reserve(state, 'new', 'same', now + 3600000).ok);
  const daily = reserve(first.state, 'fresh', 'fresh-ip', now + 2, 1); assert.ok(!daily.ok);
  const midnight = Date.parse(`${new Date(now).toISOString().slice(0, 10)}T00:00:00Z`) + 86400000;
  assert.equal(daily.next, midnight); assert.ok(reserve(first.state, 'fresh', 'fresh-ip', midnight, 1).ok);
});
test('faucet transfers exact default grants with idempotent destination ATAs, never mint-to', async () => {
  const payer = Keypair.generate(), wallet = Keypair.generate().publicKey;
  const banks = [{ label: 'tUSDC', mint: a.mints.tUSDC, decimals: 6 }, { label: 'tSOL', mint: a.mints.tSOL, decimals: 9 }] as BankView[];
  const grants = faucetGrants(banks, {}), sent: VersionedTransaction[] = [];
  assert.deepEqual(grants.map(g => g.amount), [1000000000n, 10000000000n]);
  const rpc = fakeRpc({ getAccountInfo: async key => {
    const grant = grants.find(g => key.equals(getAssociatedTokenAddressSync(g.mint, payer.publicKey)));
    return grant ? tokenInfo(grant.mint, payer.publicKey, grant.amount * 10n) : null;
  }, sendRawTransaction: async raw => { sent.push(VersionedTransaction.deserialize(Uint8Array.from(raw))); return 'unused'; },
  getSignatureStatuses: async () => ({ context: { slot: 1 }, value: [sent.length ? { slot: 20, confirmations: 1, err: null, confirmationStatus: 'confirmed' } : null] }) });
  const grant = createFaucet(payer, rpc, grants, 2000, fakeClock());
  const response = await grant({ wallet: wallet.toBase58() }, 'ip'); assert.equal(sent.length, 1); assert.equal(response.signatures.length, 1);
  assert.deepEqual(response.granted, [{ label: 'tUSDC', amount: '1000000000' }, { label: 'tSOL', amount: '10000000000' }]);
  const tx = sent[0], keys = tx.message.staticAccountKeys, instructions = tx.message.compiledInstructions;
  const transfers = instructions.filter(ix => keys[ix.programIdIndex].equals(TOKEN_PROGRAM_ID)).map(ix => decodeTransferInstruction(new TransactionInstruction({ programId: TOKEN_PROGRAM_ID,
    keys: Array.from(ix.accountKeyIndexes).map(i => ({ pubkey: keys[i], isSigner: tx.message.isAccountSigner(i), isWritable: tx.message.isAccountWritable(i) })), data: Buffer.from(ix.data) })));
  assert.deepEqual(transfers.map(ix => ix.data.amount), grants.map(g => g.amount)); assert.equal(transfers.length, 2);
  transfers.forEach((ix, i) => { assert.equal(ix.keys.owner.pubkey.toBase58(), payer.publicKey.toBase58()); assert.equal(ix.keys.destination.pubkey.toBase58(), getAssociatedTokenAddressSync(grants[i].mint, wallet).toBase58()); });
  const creates = instructions.filter(ix => keys[ix.programIdIndex].equals(ASSOCIATED_TOKEN_PROGRAM_ID)); assert.equal(creates.length, 2);
  for (const ix of creates) { assert.deepEqual([...ix.data], [1]); assert.equal(keys[ix.accountKeyIndexes[0]].toBase58(), payer.publicKey.toBase58()); }
  assert.equal((await faucetRoute('POST', '/faucet', { wallet: wallet.toBase58() }, 'ip2', grant)).status, 429);
  assert.equal((await faucetRoute('POST', '/faucet', { wallet: '?' }, 'ip', grant)).status, 400);
});
test('faucet insufficient balance 503 and limit next_allowed_at, CORS and safe RPC failure', async () => {
  const payer = Keypair.generate(), wallet = Keypair.generate().publicKey.toBase58();
  const grants = [{ label: 'tUSDC', mint: new PublicKey(a.mints.tUSDC), amount: 1000n }];
  const handler = createFaucet(payer, fakeRpc({ getAccountInfo: async () => null }), grants, 2000, fakeClock());
  const unavailable = await faucetRoute('POST', '/faucet', { wallet }, 'ip', handler); assert.equal(unavailable.status, 503); assert.match(unavailable.body, /余额不足/);
  const limit = await faucetRoute('POST', '/faucet', { wallet }, 'ip', handler); assert.equal(limit.status, 429); assert.ok(JSON.parse(limit.body).next_allowed_at);
  assert.equal((await faucetRoute('GET', '/faucet', null, 'ip', handler)).status, 404); assert.equal((await faucetRoute('OPTIONS', '/faucet', null, 'ip', handler)).status, 204);
  const bad = createFaucet(payer, fakeRpc({ getAccountInfo: async () => { throw Error('RPC_URL api-key=secret private key'); } }), grants, 2000, fakeClock());
  const failure = await faucetRoute('POST', '/faucet', { wallet }, 'ip', bad); assert.equal(failure.status, 503); assert.ok(!/RPC_URL|api-key|secret|private/.test(failure.body));
});
test('setup instructions use admin SOL transfer and mint authority; amount/config exact parsing', () => {
  const admin = Keypair.generate().publicKey, faucet = Keypair.generate().publicKey;
  const grants = [{ label: 'tUSDC', mint: new PublicKey(a.mints.tUSDC), amount: 2000000000000n }];
  const instructions = setupInstructions(admin, faucet, 2000000000n, grants);
  const sol = SystemInstruction.decodeTransfer(instructions[0]); assert.equal(sol.lamports, 2000000000n); assert.ok(sol.fromPubkey.equals(admin)); assert.ok(sol.toPubkey.equals(faucet));
  const mint = decodeMintToInstruction(instructions[2]); assert.equal(mint.data.amount, grants[0].amount); assert.ok(mint.keys.authority.pubkey.equals(admin));
  assert.equal(nativeAmount('1000.123456', 6), 1000123456n); assert.equal(dailyLimit(undefined), 2000);
  for (const value of ['0', '-1', '1.0000001', 'NaN', '18446744073709551616']) assert.throws(() => nativeAmount(value, 6));
  for (const value of ['0', '1.2', '-1']) assert.throws(() => dailyLimit(value));
});
test('faucet handle reads bounded JSON and uses socket IP, ignoring forwarded IP without socket', async () => {
  const { handleFaucet } = await import('./server');
  let actualIp = '', status = 0, body = '';
  const req = { method: 'POST', url: '/faucet', headers: { 'content-type': 'application/json', 'x-forwarded-for': 'spoofed' },
    socket: { remoteAddress: '127.0.0.1' }, async *[Symbol.asyncIterator]() { yield '{"wallet":"valid"}'; } };
  const res = { setHeader: () => {}, set statusCode(value: number) { status = value; }, end: (value: string) => { body = value; } };
  const grant = async (_value: unknown, ip: string) => { actualIp = ip; return { signatures: [], granted: [], next_allowed_at: new Date(0).toISOString() }; };
  const { IncomingMessage, ServerResponse } = await import('node:http');
  await handleFaucet(req as unknown as InstanceType<typeof IncomingMessage>, res as unknown as InstanceType<typeof ServerResponse>, grant);
  assert.equal(status, 200); assert.equal(actualIp, '127.0.0.1'); assert.ok(JSON.parse(body));
  req.headers['content-type'] = 'text/plain';
  await handleFaucet(req as unknown as InstanceType<typeof IncomingMessage>, res as unknown as InstanceType<typeof ServerResponse>, grant);
  assert.equal(status, 400);
});
test('Pyth 银行是可选水龙头资产:默认约 $500 一份,可按环境变量覆盖', () => {
  const m = () => Keypair.generate().publicKey.toBase58();
  const base = [{ label: 'tUSDC', mint: m(), decimals: 6 }, { label: 'tSOL', mint: m(), decimals: 9 }] as BankView[];
  assert.deepEqual(faucetGrants(base, {}).map(g => g.label), ['tUSDC', 'tSOL']);
  const py = ['pSOL', 'pBTC', 'pETH'].map((label, i) => ({ label, mint: m(), decimals: i === 0 ? 9 : 8 })) as BankView[];
  const hype = { label: 'tHYPE', mint: m(), decimals: 8 } as BankView;
  const withP = faucetGrants([...base, ...py, hype], {});
  assert.deepEqual(withP.map(g => [g.label, g.amount]), [
    ['tUSDC', 1_000_000_000n], ['tSOL', 10_000_000_000n], ['pSOL', 10_000_000_000n],
    ['pBTC', 600_000n], ['pETH', 20_000_000n], ['tHYPE', 600_000_000n],
  ]);
  assert.equal(faucetGrants([...base, ...py, hype], { FAUCET_PBTC_AMOUNT: '0.01' }).find(g => g.label === 'pBTC')?.amount, 1_000_000n);
  assert.throws(() => faucetGrants([base[1]], {}), /unavailable/);
});
