/** INPUT: FAUCET_KEYPAIR/RPC_URL/FAUCET_PORT、Db 池子。 OUTPUT: 独立水龙头 8788。 POSITION: EP8 仅持有专用钱包。 SYNC: folder.md。 */
import 'dotenv/config';
import { pgDb } from '../src/store/db';
import { getPool } from '../src/api/queries';
import { hostAddress, portNumber } from '../src/api/server';
import { faucetGrants, windowHours, windowMax, minimumSol } from '../src/faucet/config';
import { createFaucet } from '../src/faucet/service';
import { createFaucetServer } from '../src/faucet/server';
import { createSwap, type SwapAssetConfig } from '../src/faucet/swap';
import { oraclePrices } from '../src/faucet/prices';
import { FEED_IDS, pythPushAccount } from '../src/oracle/pyth';
import { nativeAmount } from '../src/faucet/config';
import { insertDeskEvent } from '../src/store/desk-events';
import { createFaucetReservations } from '../src/store/faucet-reservations';
import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { serviceKeypair, cliRpc } from './admin-runtime';
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') { console.log('用法: faucet (PORT/FAUCET_PORT 默认 8788)'); return; }
  if (args.length) throw Error('invalid arguments');
  // 从不读取 ANCHOR_WALLET；这个钱包没有 group admin/mint authority 权限。
  const payer = serviceKeypair(process.env.FAUCET_SECRET_KEY, process.env.FAUCET_KEYPAIR, 'FAUCET'), rpc = cliRpc(), db = pgDb();
  let grants, banks;
  try { banks = (await getPool(db)).banks; grants = faucetGrants(banks); } catch (error) { await db.close(); throw error; }
  // 兑换台:SOL 与池子里所有测试币任意两两互换。汇率不写死:每次报价读各资产在借贷池里用的同一个价格账户;
  // pSOL/pBTC/pETH 和 SOL 读 Pyth,tSOL/tUSDC/tHYPE 读我们写入的 mock,与借贷池估值一致。
  const usd = (name: string, fallback: string) => nativeAmount(process.env[name] ?? fallback, 6); // USD × 1e6
  const tokens = banks.filter(b => ['tSOL', 'tUSDC', 'tHYPE', 'pSOL', 'pBTC', 'pETH'].includes(b.label) && b.oracle_feed);
  const assets: SwapAssetConfig[] = [{ symbol: 'SOL', decimals: 9 },
    ...tokens.map(b => ({ symbol: b.label as SwapAssetConfig['symbol'], decimals: b.decimals, mint: new PublicKey(b.mint) }))];
  const deskAccounts = Object.fromEntries(assets.map(asset => [asset.symbol, asset.mint ? getAssociatedTokenAddressSync(asset.mint, payer.publicKey) : payer.publicKey]));
  const oracles = { SOL: pythPushAccount(FEED_IDS['SOL/USD']), ...Object.fromEntries(tokens.map(b => [b.label, new PublicKey(b.oracle_feed!)])) };
  const swap = createSwap(payer, rpc, { assets, deskAccounts, price: oraclePrices(rpc, oracles, undefined, Object.values(deskAccounts)),
    minUsdMicro: usd('SWAP_MIN_USD', '0.05'), maxUsdMicro: usd('SWAP_MAX_USD', '100') }, undefined,
    (signature, wallet, from, to) => insertDeskEvent(db, { signature, wallet, kind: 'swap', from, to, status: 'confirmed' }));
  const reservations = createFaucetReservations(db);
  const server = createFaucetServer(createFaucet(payer, rpc, grants, windowHours(process.env.FAUCET_WINDOW_HOURS), windowMax(process.env.FAUCET_WINDOW_MAX), minimumSol(process.env.FAUCET_MIN_SOL), undefined,
    (signature, wallet, details) => insertDeskEvent(db, { signature, wallet, kind: 'faucet', details, status: 'confirmed' }), reservations), swap,
    async () => { await db.query('SELECT 1'); }, proxyHops(process.env.TRUST_PROXY_HOPS));
  server.on('error', () => { console.error('faucet server failed'); void db.close(); process.exitCode = 1; });
  const host = hostAddress();
  const port = portNumber(process.env.PORT ?? process.env.FAUCET_PORT ?? '8788');
  server.listen(port, host, () => console.log(`faucet listening on http://${host}:${port}`));
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => server.close(() => { void db.close(); }));
}
void main().catch(() => { console.error('faucet startup failed; check configuration'); process.exitCode = 1; });
function proxyHops(value: string | undefined) {
  if (value === undefined) return 0;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw Error('invalid TRUST_PROXY_HOPS');
  return Number(value);
}
