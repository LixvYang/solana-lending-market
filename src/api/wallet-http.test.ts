/** INPUT: PGlite、无 socket HTTP 替身与假 RPC。 OUTPUT: M7 HTTP/钱包验收。 POSITION: EP8 离线测试。 SYNC: folder.md。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { deriveKeypair } from '../../scenario/lib/actors';
import { seedApi } from './test-utils';
import { addresses as a, services, tokenInfo, builtTx, feedInfo } from './wallet-test-utils';
import { route, handle } from './server';
import { getWallet } from './wallet';
async function http(db: Awaited<ReturnType<typeof seedApi>>, body: string | Buffer, contentType = 'application/json', url = '/api/build', svc = services(), contentLength?: string) {
  const req = { method: 'POST', url, headers: { 'content-type': contentType, 'content-length': contentLength }, async *[Symbol.asyncIterator]() { yield body; } };
  let status = 0, result = ''; const headers: Record<string, string> = {};
  const res = { setHeader: (k: string, v: string) => { headers[k] = v; }, set statusCode(v: number) { status = v; }, end: (v: string) => { result = v; } };
  await handle(db, req as unknown as IncomingMessage, res as unknown as ServerResponse, svc);
  return { status, body: result, headers };
}
test('wallet returns exact SPL balances, missing ATA=0, SOL/account/faucet and rejects invalid pubkey', async () => {
  const db = await seedApi(); try {
    const mint = new PublicKey(a.mints.tUSDC), wallet = new PublicKey(a.actors.bob), ata = getAssociatedTokenAddressSync(mint, wallet);
    let calls = 0;
    const svc = { ...services({ getBalance: async () => { throw Error('getBalance must not be called'); }, getMultipleAccountsInfo: async keys => {
      calls++;
      return keys.map(key => key.equals(wallet) ? { ...feedInfo(), lamports: 123456789 }
        : key.equals(ata) ? tokenInfo(mint, wallet, 18446744073709551615n) : null);
    } }), faucetUrl: 'http://localhost:8788/faucet' };
    const view = await getWallet(db, svc, a.actors.bob);
    assert.equal(calls, 1);
    assert.equal(view.sol_lamports, '123456789'); assert.equal(view.marginfi_account, a.marginfiAccounts.bob); assert.equal(view.faucet_url, svc.faucetUrl);
    assert.equal(view.tokens.find(t => t.mint === a.mints.tUSDC)?.amount, '18446744073709551615'); assert.equal(view.tokens.find(t => t.mint === a.mints.tSOL)?.amount, '0');
    assert.equal(view.tokens.find(t => t.mint === a.mints.tUSDC)?.has_account, true); assert.equal(view.tokens.find(t => t.mint === a.mints.tSOL)?.has_account, false);
    const missing = await getWallet(db, services({ getBalance: async () => { throw Error('getBalance must not be called'); },
      getMultipleAccountsInfo: async () => [null, ...Array.from({ length: 6 }, () => null)] }), deriveKeypair('m7/fresh').publicKey.toBase58());
    assert.equal(missing.sol_lamports, '0');
    const fresh = await getWallet(db, services(), deriveKeypair('m7/fresh').publicKey.toBase58()); assert.equal(fresh.marginfi_account, null); assert.equal(fresh.faucet_url, null);
    assert.equal((await route(db, 'GET', '/api/wallet/invalid', undefined, svc)).status, 400);
    const response = await route(db, 'GET', `/api/wallet/${a.actors.bob}`, undefined, svc); assert.equal(response.status, 200); assert.deepEqual(JSON.parse(response.body), view);
    await assert.rejects(getWallet(db, services({ getAccountInfo: async () => tokenInfo(PublicKey.default, wallet, 1n) }), a.actors.bob), /invalid token/);
  } finally { await db.close(); }
});
test('HTTP POST build/send 200/400/404/413/503, invalid JSON, chunk limit, 409 structured price, CORS without socket', async () => {
  const db = await seedApi(); try {
    const request = { action: 'deposit', wallet: a.actors.bob, bank: a.banks.tUSDC, amount: '1000000000' };
    const response = await http(db, JSON.stringify(request)); assert.equal(response.status, 200); const tx = builtTx(JSON.parse(response.body).transaction); tx.sign([deriveKeypair('bob')]);
    const sent = await http(db, JSON.stringify({ transaction: Buffer.from(tx.serialize()).toString('base64') }), 'application/json', '/api/send');
    assert.equal(sent.status, 200);
    assert.equal(JSON.parse(sent.body).status, 'confirmed');
    assert.equal(JSON.parse(sent.body).indexed, false);
    assert.equal((await http(db, 'invalid')).status, 400); assert.equal((await http(db, '{}', 'text/plain')).status, 400);
    assert.equal((await http(db, '{}')).status, 400); assert.equal((await http(db, '{}', 'application/json', '/missing')).status, 404);
    assert.equal((await http(db, Buffer.alloc(65537))).status, 413); assert.equal((await http(db, '{}', 'application/json', '/api/build', services(), '65537')).status, 413);
    for (const path of ['/api/build', '/api/send']) assert.equal((await route(db, 'POST', path, request)).status, 503);
    assert.equal((await route(db, 'GET', `/api/wallet/${a.actors.bob}`)).status, 503); assert.equal((await route(db, 'GET', '/api/pool')).status, 200);
    const stale = await http(db, JSON.stringify({ ...request, action: 'borrow' }), 'application/json', '/api/build', services({ getAccountInfo: async () => ({ ...feedInfo(1), owner: PublicKey.default }) })); // 价格账户不归允许的预言机程序:无法刷新
    assert.equal(stale.status, 409); assert.equal(JSON.parse(stale.body).code, 'PRICE_UNAVAILABLE'); assert.match(JSON.parse(stale.body).error, /价格/);
    const preflight = await route(db, 'OPTIONS', '/api/build'); assert.equal(preflight.status, 204); assert.match(preflight.headers['Access-Control-Allow-Methods'], /POST/); assert.match(preflight.headers['Access-Control-Allow-Headers'], /Content-Type/);
    const failure = await http(db, JSON.stringify(request), 'application/json', '/api/build', services({ getLatestBlockhash: async () => { throw Error('RPC_URL api-key=secret PRIVATE_KEY=abc'); } }));
    assert.equal(failure.status, 500); assert.ok(!/RPC_URL|api-key|secret|PRIVATE_KEY/.test(failure.body));
  } finally { await db.close(); }
});
