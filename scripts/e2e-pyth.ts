/**
 * Pyth 银行的端到端验收:一次性钱包通过真实的 HTTP 接口(兑换台 + API)走完
 *   SOL → Pyth 测试币(兑换台按实时价)→ 存入 → 借 tUSDC → 还清 → 全部取出。
 *
 *   pnpm exec tsx scripts/e2e-pyth.ts          # 默认 pSOL
 *   pnpm exec tsx scripts/e2e-pyth.ts pBTC     # 任一 Pyth 银行(pBTC/pETH)
 *
 * 前提:API(8787)、水龙头/兑换台(8788)在运行;.env 里有 RPC_URL 和 ANCHOR_WALLET(只用来给新钱包转 0.15 SOL)。花费约 0.15 SOL。
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { Connection, Keypair, LAMPORTS_PER_SOL, SystemProgram, Transaction, VersionedTransaction, sendAndConfirmTransaction } from '@solana/web3.js';
import type { BuildResponse, PoolView, SendResponse, SwapQuoteResponse, SwapRatesView, WalletView } from '../src/api/types';

const API = process.env.API_URL ?? 'http://localhost:8787', DESK = (process.env.FAUCET_URL ?? 'http://localhost:8788/faucet').replace(/\/faucet$/, '');
const connection = new Connection(process.env.RPC_URL!, { commitment: 'confirmed', fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(20_000) }) });

async function http<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, body === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const json = await response.json() as T & { error?: unknown };
  if (!response.ok) throw new Error(`${url} → ${response.status} ${JSON.stringify(json.error ?? json)}`);
  return json;
}

(async () => {
  const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.ANCHOR_WALLET!, 'utf8'))));
  const wallet = Keypair.generate(), address = wallet.publicKey.toBase58();
  const sign = (base64: string) => { const tx = VersionedTransaction.deserialize(Buffer.from(base64, 'base64')); tx.sign([wallet]); return Buffer.from(tx.serialize()).toString('base64'); };
  const pool = await http<PoolView>(`${API}/api/pool`), bank = (label: string) => pool.banks.find(b => b.label === label)!;
  const SYMBOL = process.argv[2] ?? 'pSOL';
  const pSOL = bank(SYMBOL), tUSDC = bank('tUSDC');
  console.log(`新钱包 ${address}\n${SYMBOL} 银行 ${pSOL.address} 价格 $${pSOL.price}(${pSOL.oracle_source})`);
  if (SYMBOL.startsWith('p') && pSOL.oracle_source !== 'pyth') throw new Error(`${SYMBOL} 银行不是 Pyth 定价`);

  console.log('1. 管理员转 0.15 SOL');
  await sendAndConfirmTransaction(connection, new Transaction().add(SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: wallet.publicKey, lamports: 0.15 * LAMPORTS_PER_SOL })), [admin]);

  const rates = await http<SwapRatesView>(`${DESK}/swap/rates`);
  console.log('2. 兑换台汇率:', rates.assets.map(a => `${a.symbol}=$${a.usd}(${a.source})`).join(' '));
  const quote = await http<SwapQuoteResponse>(`${DESK}/swap/quote`, { wallet: address, from: 'SOL', to: SYMBOL, amount: '0.1' });
  const swapped = await http<SendResponse>(`${DESK}/swap/send`, { transaction: sign(quote.transaction) });
  if (swapped.status !== 'confirmed') throw new Error(`兑换失败 ${JSON.stringify(swapped)}`);
  console.log(`   ✓ ${quote.summary}`);

  const step = async (title: string, request: { action: string; bank: string; amount: string; all?: boolean }) => {
    const built = await http<BuildResponse>(`${API}/api/build`, { ...request, wallet: address });
    if (!built.simulation.ok) throw new Error(`${title} 模拟失败: ${built.simulation.error?.name} ${built.simulation.error?.message}`);
    const sent = await http<SendResponse>(`${API}/api/send`, { transaction: sign(built.transaction) });
    if (sent.status !== 'confirmed') throw new Error(`${title} 发送失败 ${JSON.stringify(sent)}`);
    console.log(`${title}: ✓ ${built.summary}(${built.simulation.units_consumed} CU)${sent.signature}`);
  };
  const half = BigInt(quote.out_amount) / 2n; // 只存一半,剩下的留给手续费以外的操作
  await step(`3. 存 ${SYMBOL}(首次,自动建账户)`, { action: 'deposit', bank: pSOL.address, amount: String(half) });
  await step(`4. 以 ${SYMBOL} 作抵押借 tUSDC`, { action: 'borrow', bank: tUSDC.address, amount: '2000000' });
  for (let i = 0; i < 30; i++) { // 等索引器把借款入库(先入库的可能只有存款),看 API 算出的健康度
    const mine = (await http<{ authority: string; status: string; health: { init: number; maint: number } }[]>(`${API}/api/accounts`)).find(a => a.authority === address);
    if (mine && mine.status !== 'no_debt') { console.log(`   API: 状态 ${mine.status},开仓健康度 $${mine.health.init.toFixed(4)},维持健康度 $${mine.health.maint.toFixed(4)}`); break; }
    await new Promise(r => setTimeout(r, 2000));
  }
  const w = await http<WalletView>(`${API}/api/wallet/${address}`);
  console.log('   钱包:', w.tokens.map(t => `${t.label}=${t.amount}`).join(' '));
  // 还清全部要连利息一起还,比借到的 2 tUSDC 略多:先用一点 SOL 换些 tUSDC(真实联调第一次就是在这里余额不足)。
  const topUp = await http<SwapQuoteResponse>(`${DESK}/swap/quote`, { wallet: address, from: 'SOL', to: 'tUSDC', amount: '0.002' });
  if ((await http<SendResponse>(`${DESK}/swap/send`, { transaction: sign(topUp.transaction) })).status !== 'confirmed') throw new Error('补 tUSDC 失败');
  console.log(`   ✓ ${topUp.summary}(用来付利息)`);
  await step('5. 还清 tUSDC', { action: 'repay', bank: tUSDC.address, amount: '0', all: true });
  await step(`6. 取出全部 ${SYMBOL}`, { action: 'withdraw', bank: pSOL.address, amount: '0', all: true });
  console.log('\n✓ 银行端到端通过');
  process.exit(0);
})().catch(error => { console.error('\n✗', String(error?.message ?? error).replace(/api-key=[^\s&"']+/g, 'api-key=***')); process.exit(1); });
