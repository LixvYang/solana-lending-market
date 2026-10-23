/** INPUT: 假 RPC、随机密钥。 OUTPUT: 兑换台八种资产两两兑换、随预言机变化的报价、签名归属与转发守卫断言。 POSITION: 离线测试。 SYNC: folder.md。 */
import assert from 'node:assert/strict';
import { createPublicKey, verify } from 'node:crypto';
import { test } from 'node:test';
import { Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, createTransferInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { fakeClock, fakeRpc, tokenInfo } from '../api/wallet-test-utils';
import { createSwap, notionalMicro, swapOut, type PricedAsset, type SwapConfig } from './swap';
import { faucetRoute } from './server';
import type { SwapAsset } from '../api/types';

const desk = Keypair.generate(), user = Keypair.generate();
const mint = { tSOL: Keypair.generate().publicKey, tUSDC: Keypair.generate().publicKey, pSOL: Keypair.generate().publicKey,
  pBTC: Keypair.generate().publicKey, pETH: Keypair.generate().publicKey, tHYPE: Keypair.generate().publicKey };
const SOL: PricedAsset = { symbol: 'SOL', decimals: 9, usdMicro: 50_000_000n };       // $50
const tSOL: PricedAsset = { symbol: 'tSOL', decimals: 9, mint: mint.tSOL, usdMicro: 50_000_000n };   // $50
const tUSDC: PricedAsset = { symbol: 'tUSDC', decimals: 6, mint: mint.tUSDC, usdMicro: 1_000_000n }; // $1
const pSOL: PricedAsset = { symbol: 'pSOL', decimals: 9, mint: mint.pSOL, usdMicro: 104_708_908n };  // Pyth 价 $104.708908
const pBTC: PricedAsset = { symbol: 'pBTC', decimals: 8, mint: mint.pBTC, usdMicro: 70_000_000_000n };
const pETH: PricedAsset = { symbol: 'pETH', decimals: 8, mint: mint.pETH, usdMicro: 3_500_000_000n };
const tHYPE: PricedAsset = { symbol: 'tHYPE', decimals: 8, mint: mint.tHYPE, usdMicro: 80_000_000n };
const by = { SOL, tSOL, tUSDC, pSOL, pBTC, pETH, tHYPE } as const;
// 测试里价格由一张可改的表提供(生产环境读预言机账户,见 prices.test.ts)。
const table = new Map(Object.values(by).map(a => [a.symbol, a.usdMicro]));
const config: SwapConfig = { assets: Object.values(by), minUsdMicro: 50_000n, maxUsdMicro: 100_000_000n, // $0.05 ~ $100
  price: async a => ({ usdMicro: table.get(a.symbol)!, source: a.symbol.startsWith('p') ? 'pyth' : 'mock' }) };
const stocked = (tokenAmount = 10n ** 15n, lamports = 5_000_000_000) => fakeRpc({
  getBalance: (async () => lamports) as never,
  getAccountInfo: (async (key: PublicKey) => {
    for (const m of Object.values(mint)) if (key.equals(getAssociatedTokenAddressSync(m, desk.publicKey))) return tokenInfo(m, desk.publicKey, tokenAmount);
    return null; }) as never });
const swapWith = (rpc = stocked()) => createSwap(desk, rpc, config, fakeClock());
const sigOk = (tx: VersionedTransaction, index: number) => verify(null, tx.message.serialize(),
  createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), tx.message.staticAccountKeys[index].toBuffer()]), format: 'der', type: 'spki' }), tx.signatures[index]);
const status = (e: unknown) => (e as { status?: number }).status;

test('换出数量:统一的 USD 单价、整数运算、向下取整,不会多给,绕一圈不会变多(没有套利环)', () => {
  assert.equal(swapOut(1_000_000_000n, SOL, tUSDC), 50_000_000n);     // 1 SOL → 50 tUSDC
  assert.equal(swapOut(50_000_000n, tUSDC, SOL), 1_000_000_000n);     // 50 tUSDC → 1 SOL
  assert.equal(swapOut(1_000_000_000n, SOL, tSOL), 1_000_000_000n);   // SOL ↔ tSOL 1:1
  assert.equal(swapOut(2_000_000_000n, tSOL, tUSDC), 100_000_000n);   // 2 tSOL → 100 tUSDC
  assert.equal(swapOut(1n, tUSDC, SOL), 20n);                         // 0.000001 tUSDC = $0.000001 → 0.00000002 SOL = 20 lamports
  assert.equal(swapOut(19n, SOL, tUSDC), 0n);                         // 太小:向下取整为 0
  // 绕一圈:SOL → tUSDC → tSOL → SOL,任何起点数量都不会拿回更多
  for (const start of [1_000_000_000n, 123_456_789n, 7n, 999_999_999_999n]) {
    const back = swapOut(swapOut(swapOut(start, SOL, tUSDC), tUSDC, tSOL), tSOL, SOL);
    assert.ok(back <= start, `${start} → ${back}`);
  }
  assert.equal(notionalMicro(1_000_000_000n, SOL), 50_000_000n);      // 1 SOL = $50
  assert.equal(notionalMicro(100_000_000n, tUSDC), 100_000_000n);     // 100 tUSDC = $100
});

// 每个方向交易里都是"用户给出 from + 兑换台给出 to",手续费由用户付,兑换台已签、用户未签
const AMOUNT: Record<SwapAsset, string> = { SOL: '0.5', tSOL: '0.5', tUSDC: '25', pSOL: '0.2', pBTC: '0.001', pETH: '0.01', tHYPE: '0.01' };
const PAIRS: [SwapAsset, SwapAsset, string][] = (Object.keys(by) as SwapAsset[]).flatMap(from =>
  (Object.keys(by) as SwapAsset[]).filter(to => to !== from).map(to => [from, to, AMOUNT[from]] as [SwapAsset, SwapAsset, string]));
for (const [from, to, amount] of PAIRS) {
  test(`报价 ${from} → ${to}:两条腿的方向、数量、付款人、签名归属`, async () => {
    const quote = await swapWith().quote({ wallet: user.publicKey.toBase58(), from, to, amount });
    const a = by[from], b = by[to];
    const amountIn = BigInt(quote.in_amount), out = BigInt(quote.out_amount);
    assert.equal(out, swapOut(amountIn, a, b)); assert.equal(quote.in_decimals, a.decimals); assert.equal(quote.out_decimals, b.decimals);
    const tx = VersionedTransaction.deserialize(Buffer.from(quote.transaction, 'base64')), keys = tx.message.staticAccountKeys;
    assert.ok(keys[0].equals(user.publicKey), '手续费付款人是用户');
    const deskIndex = keys.findIndex(k => k.equals(desk.publicKey));
    assert.ok(deskIndex > 0 && deskIndex < tx.message.header.numRequiredSignatures && sigOk(tx, deskIndex), '兑换台是签名者且签名有效');
    assert.ok(tx.signatures[0].every(x => x === 0), '用户的签名还没有');
    const ixs = tx.message.compiledInstructions;
    const sol = ixs.filter(ix => keys[ix.programIdIndex].equals(SystemProgram.programId));
    const spl = ixs.filter(ix => keys[ix.programIdIndex].equals(TOKEN_PROGRAM_ID));
    // 用户给出 from
    if (a.mint) {
      const leg = spl[0]; assert.equal(Buffer.from(leg.data).readBigUInt64LE(1), amountIn);
      assert.ok(keys[leg.accountKeyIndexes[0]].equals(getAssociatedTokenAddressSync(a.mint, user.publicKey)));
      assert.ok(keys[leg.accountKeyIndexes[1]].equals(getAssociatedTokenAddressSync(a.mint, desk.publicKey)));
      assert.ok(keys[leg.accountKeyIndexes[2]].equals(user.publicKey), '授权人是用户');
    } else {
      const leg = sol[0]; assert.equal(Buffer.from(leg.data).readBigUInt64LE(4), amountIn);
      assert.ok(keys[leg.accountKeyIndexes[0]].equals(user.publicKey) && keys[leg.accountKeyIndexes[1]].equals(desk.publicKey));
    }
    // 兑换台给出 to
    if (b.mint) {
      const leg = spl[spl.length - 1]; assert.equal(Buffer.from(leg.data).readBigUInt64LE(1), out);
      assert.ok(keys[leg.accountKeyIndexes[0]].equals(getAssociatedTokenAddressSync(b.mint, desk.publicKey)));
      assert.ok(keys[leg.accountKeyIndexes[1]].equals(getAssociatedTokenAddressSync(b.mint, user.publicKey)));
      assert.ok(keys[leg.accountKeyIndexes[2]].equals(desk.publicKey), '授权人是兑换台');
    } else {
      const leg = sol[sol.length - 1]; assert.equal(Buffer.from(leg.data).readBigUInt64LE(4), out);
      assert.ok(keys[leg.accountKeyIndexes[0]].equals(desk.publicKey) && keys[leg.accountKeyIndexes[1]].equals(user.publicKey));
    }
  });
}

test('报价的边界:同一资产、未知资产、太小、太大、非法数量、兑换台余额不足(代币与 SOL)', async () => {
  const swap = swapWith(), wallet = user.publicKey.toBase58();
  for (const [from, to, amount] of [['SOL', 'SOL', '0.1'], ['SOL', 'DOGE', '0.1'], ['DOGE', 'SOL', '0.1'], ['SOL', 'tUSDC', '0.0001'], ['SOL', 'tUSDC', '3'],
    ['tUSDC', 'SOL', '0.01'], ['tUSDC', 'SOL', '101'], ['SOL', 'tUSDC', '0'], ['SOL', 'tUSDC', 'abc'], ['SOL', 'tUSDC', '-1']])
    await assert.rejects(swap.quote({ wallet, from, to, amount }), (e: unknown) => status(e) === 400, `${from}→${to} ${amount}`);
  await assert.rejects(swap.quote({ wallet: 'not-a-key', from: 'SOL', to: 'tSOL', amount: '0.1' }), (e: unknown) => status(e) === 400);
  await assert.rejects(swapWith(stocked(1n)).quote({ wallet, from: 'SOL', to: 'tUSDC', amount: '0.5' }), (e: unknown) => status(e) === 503);    // 代币不足
  // SOL 不足:要付出 0.5 SOL,兑换台有 0.52 SOL,但必须保留 0.05(付 ATA 租金等),可用只有 0.47 → 拒绝;
  // 有 0.56 SOL 时可用 0.51 → 放行。正好卡在"保留金额"这条规则上,去掉保留就会放行前一种。
  await assert.rejects(swapWith(stocked(10n ** 15n, 520_000_000)).quote({ wallet, from: 'tUSDC', to: 'SOL', amount: '25' }), (e: unknown) => status(e) === 503);
  assert.equal((await swapWith(stocked(10n ** 15n, 560_000_000)).quote({ wallet, from: 'tUSDC', to: 'SOL', amount: '25' })).out_amount, '500000000');
  assert.deepEqual(await swap.rates(), { assets: [{ symbol: 'SOL', decimals: 9, usd: '50', source: 'mock' }, { symbol: 'tSOL', decimals: 9, usd: '50', source: 'mock' },
    { symbol: 'tUSDC', decimals: 6, usd: '1', source: 'mock' }, { symbol: 'pSOL', decimals: 9, usd: '104.708908', source: 'pyth' },
    { symbol: 'pBTC', decimals: 8, usd: '70000', source: 'pyth' }, { symbol: 'pETH', decimals: 8, usd: '3500', source: 'pyth' },
    { symbol: 'tHYPE', decimals: 8, usd: '80', source: 'mock' }], min_usd: '0.05', max_usd: '100' });
});

test('汇率跟着预言机走:同一个兑换台,价格变了报价就变;读不到价格或价格为 0 时拒绝(503),不按旧价成交', async () => {
  const swap = swapWith(), wallet = user.publicKey.toBase58();
  const out = async () => BigInt((await swap.quote({ wallet, from: 'pSOL', to: 'tUSDC', amount: '0.2' })).out_amount);
  assert.equal(await out(), 20_941_781n);                 // 0.2 × $104.708908 = 20.9417816 tUSDC,向下取整
  table.set('pSOL', 90_000_000n);
  try {
    assert.equal(await out(), 18_000_000n);               // 跌到 $90 → 18 tUSDC
    table.set('pSOL', 0n);
    await assert.rejects(out(), (e: unknown) => status(e) === 503);
  } finally { table.set('pSOL', pSOL.usdMicro); }
  const broken = createSwap(desk, stocked(), { ...config, price: async () => { throw Object.assign(new Error('stale'), { status: 503 }); } }, fakeClock());
  await assert.rejects(broken.quote({ wallet, from: 'SOL', to: 'tUSDC', amount: '0.5' }), (e: unknown) => status(e) === 503);
});

test('rates使用共享汇率读取器,quote强制走fresh读取当前成交价', async () => {
  let cachedCalls = 0, freshCalls = 0;
  const price = Object.assign(async (a: { symbol: string }) => {
    cachedCalls++;
    return { usdMicro: a.symbol === 'SOL' ? 50_000_000n : 1_000_000n, source: 'mock' as const };
  }, { fresh: async (a: { symbol: string }) => {
    freshCalls++;
    return { usdMicro: a.symbol === 'SOL' ? 40_000_000n : 1_000_000n, source: 'mock' as const };
  } });
  const swap = createSwap(desk, stocked(), { ...config, assets: [SOL, tUSDC], price }, fakeClock());
  await swap.rates(); assert.equal(cachedCalls, 2); assert.equal(freshCalls, 0);
  const quote = await swap.quote({ wallet: user.publicKey.toBase58(), from: 'SOL', to: 'tUSDC', amount: '0.5' });
  assert.equal(quote.out_amount, '20000000'); assert.equal(freshCalls, 2); assert.equal(cachedCalls, 2);
});

test('转发守卫:用户签完的兑换交易(含 SOL 收款方向)放行;不是兑换台签的、或含别的程序的拒绝', async () => {
  const swap = swapWith(), wallet = user.publicKey.toBase58();
  for (const [from, to, amount] of [['SOL', 'tSOL', '0.1'], ['tUSDC', 'SOL', '10']] as const) {
    const quote = await swap.quote({ wallet, from, to, amount });
    const signed = VersionedTransaction.deserialize(Buffer.from(quote.transaction, 'base64')); signed.sign([user]);
    assert.equal((await swap.submit({ transaction: Buffer.from(signed.serialize()).toString('base64') })).status, 'confirmed');
    await assert.rejects(swap.submit({ transaction: quote.transaction }), (e: unknown) => status(e) === 400); // 用户没签
  }
  const other = Keypair.generate();
  const forged = new VersionedTransaction(new TransactionMessage({ payerKey: other.publicKey, recentBlockhash: PublicKey.default.toBase58(),
    instructions: [SystemProgram.transfer({ fromPubkey: other.publicKey, toPubkey: other.publicKey, lamports: 1 })] }).compileToV0Message());
  forged.sign([other]);
  await assert.rejects(swap.submit({ transaction: Buffer.from(forged.serialize()).toString('base64') }), /not a swap transaction/);
  const withOtherProgram = new VersionedTransaction(new TransactionMessage({ payerKey: user.publicKey, recentBlockhash: PublicKey.default.toBase58(),
    instructions: [createTransferInstruction(getAssociatedTokenAddressSync(mint.tSOL, desk.publicKey), getAssociatedTokenAddressSync(mint.tSOL, user.publicKey), desk.publicKey, 1n),
      { programId: Keypair.generate().publicKey, keys: [], data: Buffer.alloc(0) }] }).compileToV0Message());
  withOtherProgram.sign([user, desk]);
  await assert.rejects(swap.submit({ transaction: Buffer.from(withOtherProgram.serialize()).toString('base64') }), /not a swap transaction/);
});

test('HTTP 路由:只有配置了兑换台才有 /swap/*,否则 404', async () => {
  const noGrant = async () => { throw new Error('unused'); };
  assert.equal((await faucetRoute('GET', '/swap/rates', undefined, '1.1.1.1', noGrant as never)).status, 404);
  const route = await faucetRoute('GET', '/swap/rates', undefined, '1.1.1.1', noGrant as never, swapWith());
  assert.equal(route.status, 200); assert.equal(JSON.parse(route.body).assets.length, 7);
  assert.equal((await faucetRoute('POST', '/swap/quote', { wallet: user.publicKey.toBase58(), from: 'SOL', to: 'tSOL', amount: '5' }, '1.1.1.1', noGrant as never, swapWith())).status, 400);
});

test('tHYPE 兑换使用固定 mock 价格 $80，而 BTC/ETH 仍按 Pyth 报价', async () => {
  const swap = swapWith(), wallet = user.publicKey.toBase58();
  assert.equal((await swap.quote({ wallet, from: 'tHYPE', to: 'tUSDC', amount: '1' })).out_amount, '80000000');
  assert.equal((await swap.rates()).assets.find(a => a.symbol === 'tHYPE')?.source, 'mock');
});

// 单个资产价格故障不会拖垮整张汇率表。
test('单个资产价格不可用时，汇率表照常返回其他资产，只把它标成不可用;涉及它的报价仍被拒', async () => {
  const stale: SwapConfig = { ...config, price: async a => {
    if (a.symbol === 'tHYPE') throw Object.assign(new Error('价格暂时不可用，请稍后再试。'), { status: 503 });
    return config.price(a);
  } };
  const swap = createSwap(desk, stocked(), stale, fakeClock());
  const rates = await swap.rates();
  assert.equal(rates.assets.find(a => a.symbol === 'tUSDC')?.usd, '1');
  assert.deepEqual(rates.assets.find(a => a.symbol === 'tHYPE'), { symbol: 'tHYPE', decimals: 8, usd: null, source: null, unavailable: '价格暂时不可用，请稍后再试。' });
  const wallet = user.publicKey.toBase58();
  assert.equal((await swap.quote({ wallet, from: 'SOL', to: 'tUSDC', amount: '0.5' })).out_amount, '25000000');
  await assert.rejects(swap.quote({ wallet, from: 'SOL', to: 'tHYPE', amount: '0.5' }));
});
