/** INPUT: FAUCET_KEYPAIR/RPC_URL/FAUCET_PORT、Db 池子。 OUTPUT: 独立水龙头 8788。 POSITION: EP8 仅持有专用钱包。 SYNC: folder.md。 */
import 'dotenv/config';
import { pgDb } from '../src/store/db';
import { getPool } from '../src/api/queries';
import { hostAddress, portNumber } from '../src/api/server';
import { faucetGrants, dailyLimit } from '../src/faucet/config';
import { createFaucet } from '../src/faucet/service';
import { createFaucetServer } from '../src/faucet/server';
import { createSwap, type SwapAssetConfig } from '../src/faucet/swap';
import { oraclePrices } from '../src/faucet/prices';
import { FEED_IDS, pythPushAccount } from '../src/oracle/pyth';
import { nativeAmount } from '../src/faucet/config';
import { PublicKey } from '@solana/web3.js';
import { readKeypair, cliRpc } from './admin-runtime';
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') { console.log('用法: faucet (FAUCET_PORT 默认 8788)'); return; }
  if (args.length) throw Error('invalid arguments');
  // 从不读取 ANCHOR_WALLET；这个钱包没有 group admin/mint authority 权限。
  const payer = readKeypair(process.env.FAUCET_KEYPAIR), rpc = cliRpc(), db = pgDb();
  let grants, banks;
  try { banks = (await getPool(db)).banks; grants = faucetGrants(banks); } finally { await db.close(); }
  // 兑换台:SOL 与池子里所有测试币任意两两互换。汇率不写死:每次报价读各资产在借贷池里用的同一个价格账户;
  // pSOL/pBTC/pETH 和 SOL 读 Pyth,tSOL/tUSDC/tHYPE 读我们写入的 mock,与借贷池估值一致。
  const usd = (name: string, fallback: string) => nativeAmount(process.env[name] ?? fallback, 6); // USD × 1e6
  const tokens = banks.filter(b => ['tSOL', 'tUSDC', 'tHYPE', 'pSOL', 'pBTC', 'pETH'].includes(b.label) && b.oracle_feed);
  const assets: SwapAssetConfig[] = [{ symbol: 'SOL', decimals: 9 },
    ...tokens.map(b => ({ symbol: b.label as SwapAssetConfig['symbol'], decimals: b.decimals, mint: new PublicKey(b.mint) }))];
  const oracles = { SOL: pythPushAccount(FEED_IDS['SOL/USD']), ...Object.fromEntries(tokens.map(b => [b.label, new PublicKey(b.oracle_feed!)])) };
  const swap = createSwap(payer, rpc, { assets, price: oraclePrices(rpc, oracles),
    minUsdMicro: usd('SWAP_MIN_USD', '0.05'), maxUsdMicro: usd('SWAP_MAX_USD', '100') });
  const server = createFaucetServer(createFaucet(payer, rpc, grants, dailyLimit(process.env.FAUCET_DAILY_MAX)), swap);
  server.on('error', () => { console.error('faucet server failed'); process.exitCode = 1; });
  const host = hostAddress();
  server.listen(portNumber(process.env.FAUCET_PORT ?? '8788'), host, () => console.log(`faucet listening on http://${host}:${process.env.FAUCET_PORT ?? '8788'}`));
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => server.close());
}
void main().catch(() => { console.error('faucet startup failed; check configuration'); process.exitCode = 1; });
