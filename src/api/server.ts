/** INPUT: Db、HTTP/JSON、可选钱包 RPC。 OUTPUT: 只读(含银行历史)与钱包路由。 POSITION: EP7/8 HTTP 边界。 SYNC: 同步 folder.md。 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Db } from '../store/db';
import { toJson } from '../store/json';
import { decodeBase58 } from '../core/base58';
import { getPool, getAccounts, getRateCurve, getBankHistory, getActivity, getXray } from './queries';
import { getLiquidations } from './liquidations';
import { ApiError } from './errors';
import { readJson, corsHeaders, allowOrigin } from './http-body';
import { buildTransaction, PriceStale } from './builder';
import { sendTransaction } from './send';
import { getWallet } from './wallet';
import { indexConfirmed } from './confirmed';
import { getWalletHistory } from './wallet-history';
import type { ClientConfig } from './types';
import type { WalletServices } from './wallet-rpc';
export function portNumber(value: string | undefined): number {
  if (value === undefined)
    return 8787;
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535)
    throw new Error('invalid PORT');
  return Number(value);
}
export const hostAddress = (value = process.env.HOST, port = process.env.PORT): string => value || (port ? '0.0.0.0' : '127.0.0.1');
function address(value: string | null, width: number): string {
  try {
    if (!value || decodeBase58(value).length !== width)
      throw Error();
    return value;
  }
  catch {
    throw new ApiError(400, width === 32 ? 'invalid bank address' : 'invalid transaction signature');
  }
}
export async function route(db: Db, method: string, requestUrl: string, input?: unknown, services?: WalletServices) {
  const headers = corsHeaders;
  try {
    let url: URL;
    try {
      url = new URL(requestUrl, 'http://localhost');
    }
    catch {
      throw new ApiError(400, 'invalid URL');
    }
    if (method === 'OPTIONS')
      return { status: 204, headers, body: '' };
    let body: unknown;
    const history = /^\/api\/wallet\/([^/]+)\/history$/.exec(url.pathname);
    if (method === 'GET' && history) {
      let wallet: string;
      try { wallet = decodeURIComponent(history[1]); } catch { throw new ApiError(400, 'invalid public key'); }
      const key = address(wallet, 32), rawLimit = url.searchParams.get('limit');
      if (rawLimit !== null && !/^\d+$/.test(rawLimit)) throw new ApiError(400, 'invalid limit');
      body = await getWalletHistory(db, key, { before: url.searchParams.get('before') ?? undefined, limit: rawLimit === null ? undefined : Number(rawLimit) });
      return { status: 200, headers, body: toJson(body) };
    }
    const walletRoute = method === 'POST' && ['/api/build', '/api/send'].includes(url.pathname) || method === 'GET' && /^\/api\/wallet\/[^/]+$/.test(url.pathname);
    if (walletRoute) {
      if (!services) throw new ApiError(503, 'wallet RPC unavailable');
      let body;
      if (url.pathname === '/api/build') body = await buildTransaction(db, services, input);
      else if (url.pathname === '/api/send') body = await sendTransaction(input, services.rpc, services.clock,
        signature => indexConfirmed(db, services.rpc, signature, services.oracleOwners));
      else {
        let wallet;
        try { wallet = decodeURIComponent(url.pathname.split('/').at(-1)!); }
        catch { throw new ApiError(400, 'invalid public key'); }
        body = await getWallet(db, services, wallet);
      }
      return { status: 200, headers, body: toJson(body) };
    }
    if (method !== 'GET')
      throw new ApiError(404, 'not found');
    switch (url.pathname) {
      case '/healthz':
      case '/api/healthz':
      case '/api/health':
        try { await db.query('SELECT 1'); }
        catch { throw new ApiError(503, 'database unavailable'); }
        body = { ok: true };
        break;
      case '/api/pool':
        body = await getPool(db);
        break;
      case '/api/config': // 前端在连钱包之前就要知道兑换台在哪(水龙头与兑换台是同一个独立进程)
        body = { faucet_url: services?.faucetUrl ?? null } satisfies ClientConfig;
        break;
      case '/api/accounts':
        body = await getAccounts(db);
        break;
      case '/api/activity': {
        const value = url.searchParams.get('limit');
        if (value !== null && !/^\d+$/.test(value))
          throw new ApiError(400, 'invalid limit');
        const bank = url.searchParams.has('bank') ? address(url.searchParams.get('bank'), 32) : undefined;
        body = await getActivity(db, { limit: value === null ? undefined : Number(value), before: url.searchParams.get('before') ?? undefined, bank });
        break;
      }
      case '/api/liquidations': {
        const bank = url.searchParams.has('bank') ? address(url.searchParams.get('bank'), 32) : undefined;
        body = await getLiquidations(db, { bank });
        break;
      }
      case '/api/rate-curve':
        body = await getRateCurve(db, address(url.searchParams.get('bank'), 32));
        break;
      case '/api/bank-history':
        body = await getBankHistory(db, address(url.searchParams.get('bank'), 32));
        break;
      default: {
        const match = /^\/api\/tx\/([^/]+)$/.exec(url.pathname);
        if (!match)
          throw new ApiError(404, 'not found');
        let signature: string;
        try {
          signature = decodeURIComponent(match[1]);
        }
        catch {
          throw new ApiError(400, 'invalid transaction signature');
        }
        body = await getXray(db, address(signature, 64));
      }
    }
    if (body === null)
      throw new ApiError(404, 'not found');
    return { status: 200, headers, body: toJson(body) };
  }
  catch (error) {
    // 驱动异常可包含带凭据的 URL；只返回固定消息，不记录异常对象或请求 URL。
    return { status: error instanceof ApiError ? error.status : 500, headers,
      body: toJson({ error: error instanceof PriceStale ? error.view : error instanceof ApiError ? error.message : 'internal server error' }) };
  }
}
export async function handle(db: Db, req: IncomingMessage, res: ServerResponse, services?: WalletServices): Promise<void> {
  let result;
  try {
    const input = req.method === 'POST' ? await readJson(req) : undefined;
    result = await route(db, req.method ?? 'GET', req.url ?? '/', input, services);
  } catch (error) {
    result = { status: error instanceof ApiError ? error.status : 500, headers: corsHeaders, body: toJson({ error: error instanceof ApiError ? error.message : 'internal server error' }) };
  }
  for (const [key, value] of Object.entries(result.headers))
    res.setHeader(key, value);
  res.setHeader('Access-Control-Allow-Origin', allowOrigin(req.headers?.origin));
  res.setHeader('Vary', 'Origin');
  res.statusCode = result.status;
  res.end(result.body);
}
export const createApiServer = (db: Db, services?: WalletServices) => createServer((req, res) => { void handle(db, req, res, services); });
