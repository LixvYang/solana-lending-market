import type { IncomingMessage, ServerResponse } from 'node:http';
import { waitUntil } from '@vercel/functions';
import { Pool } from 'pg';
import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import deployment from '../program/devnet.json';
import { pgDb, poolMax } from '../src/store/db';
import { assertMigrated } from '../src/store/migrate';
import { getPool } from '../src/api/queries';
import { rpcConnection } from '../src/api/wallet-rpc';
import { oracleOwners } from '../src/store/accounts';
import { createFaucetReservations } from '../src/store/faucet-reservations';
import { insertDeskEvent } from '../src/store/desk-events';
import { createFaucet } from '../src/faucet/service';
import { faucetGrants, minimumSol, nativeAmount, windowHours, windowMax } from '../src/faucet/config';
import { createSwap, type SwapAssetConfig } from '../src/faucet/swap';
import { oraclePrices } from '../src/faucet/prices';
import { FEED_IDS, pythPushAccount } from '../src/oracle/pyth';
import { serviceKeypair } from '../scripts/admin-runtime';
import { Rpc } from '../src/ingest/rpc';
import { maybeSync } from '../src/ingest/vercel-sync';
import { createVercelHandler } from '../src/vercel/handler';

// Vercel isolates retain module state across invocations. A small pool avoids exhausting Supabase connections.
const db = pgDb(new Pool({ connectionString: process.env.DATABASE_URL, max: poolMax(process.env.PG_POOL_MAX ?? '1') }));
const walletRpc = process.env.RPC_URL ? rpcConnection(process.env.RPC_URL) : undefined;
const ingestRpc = process.env.RPC_URL ? new Rpc(process.env.RPC_URL, { commitment: 'confirmed' }) : undefined;
const allowedOracleOwners = oracleOwners();
allowedOracleOwners.add(deployment.mocks);
const services = walletRpc ? { rpc: walletRpc, faucetUrl: process.env.FAUCET_URL ?? '/api/desk/faucet', readUserFromChain: true, oracleOwners: allowedOracleOwners } : undefined;
let desk: Promise<Awaited<ReturnType<typeof createDesk>>> | undefined;
let migrationCheck: Promise<void> | undefined;

async function createDesk() {
  if (!walletRpc) throw new Error('RPC unavailable');
  const payer = serviceKeypair(process.env.FAUCET_SECRET_KEY, process.env.FAUCET_KEYPAIR, 'FAUCET');
  const banks = (await getPool(db)).banks, grants = faucetGrants(banks);
  const tokens = banks.filter(bank => ['tSOL', 'tUSDC', 'tHYPE', 'pSOL', 'pBTC', 'pETH'].includes(bank.label) && bank.oracle_feed);
  const assets: SwapAssetConfig[] = [{ symbol: 'SOL', decimals: 9 },
    ...tokens.map(bank => ({ symbol: bank.label as SwapAssetConfig['symbol'], decimals: bank.decimals, mint: new PublicKey(bank.mint) }))];
  const deskAccounts = Object.fromEntries(assets.map(asset => [asset.symbol, asset.mint ? getAssociatedTokenAddressSync(asset.mint, payer.publicKey) : payer.publicKey]));
  const oracles = { SOL: pythPushAccount(FEED_IDS['SOL/USD']), ...Object.fromEntries(tokens.map(bank => [bank.label, new PublicKey(bank.oracle_feed!)])) };
  const usd = (name: string, fallback: string) => nativeAmount(process.env[name] ?? fallback, 6);
  const swap = createSwap(payer, walletRpc, { assets, deskAccounts, price: oraclePrices(walletRpc, oracles, undefined, Object.values(deskAccounts)),
    minUsdMicro: usd('SWAP_MIN_USD', '0.05'), maxUsdMicro: usd('SWAP_MAX_USD', '100') }, undefined,
    (signature, wallet, from, to) => insertDeskEvent(db, { signature, wallet, kind: 'swap', from, to, status: 'confirmed' }));
  const grant = createFaucet(payer, walletRpc, grants, windowHours(process.env.FAUCET_WINDOW_HOURS), windowMax(process.env.FAUCET_WINDOW_MAX), minimumSol(process.env.FAUCET_MIN_SOL), undefined,
    (signature, wallet, details) => insertDeskEvent(db, { signature, wallet, kind: 'faucet', details, status: 'confirmed' }), createFaucetReservations(db));
  return { grant, swap };
}

const handler = createVercelHandler({ db, services, cronSecret: process.env.CRON_SECRET,
  trustProxyHops: proxyHops(process.env.TRUST_PROXY_HOPS), checkDb: async () => { await db.query('SELECT 1'); },
  waitUntil: work => waitUntil(work), maybeSync: () => ingestRpc ? maybeSync(db, ingestRpc) : Promise.resolve(false),
  getFaucet: getDesk });

export default async function api(req: IncomingMessage, res: ServerResponse) {
  try {
    await (migrationCheck ??= assertMigrated(db).catch(error => { migrationCheck = undefined; throw error; }));
    await handler(req, res);
  } catch {
    res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.statusCode = 503;
    res.end('{"error":"服务暂时不可用，请稍后重试。","code":"SERVICE_UNAVAILABLE"}');
  }
}

function getDesk() {
  if (!desk) desk = createDesk().catch(error => { desk = undefined; throw error; });
  return desk;
}

function proxyHops(value: string | undefined) {
  if (value === undefined) return 0;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error('invalid TRUST_PROXY_HOPS');
  return Number(value);
}
