/** INPUT: JSON 请求与专用水龙头服务。 OUTPUT: /faucet HTTP。 POSITION: 独立 EP8 服务边界。 SYNC: folder.md。 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { isIP } from 'node:net';
import { readJson, corsHeaders, allowOrigin } from '../api/http-body';
import { ApiError } from '../api/errors';
import { FaucetLimit } from './service';
import type { Swap } from './swap';
import type { FaucetResponse } from '../api/types';
export type FaucetHandler = ((input: unknown, ip: string) => Promise<FaucetResponse>) & { quota?: () => unknown };
export async function faucetRoute(method: string, url: string, input: unknown, ip: string, grant: FaucetHandler, swap?: Swap, checkDb?: () => Promise<void>) {
  try {
    if (method === 'OPTIONS') return { status: 204, headers: corsHeaders, body: '' };
    if (method === 'GET' && (url === '/healthz' || url === '/health')) {
      if (url === '/healthz' && checkDb) await checkDb();
      return { status: 200, headers: corsHeaders, body: '{"ok":true}' };
    }
    if (swap && method === 'GET' && url === '/swap/rates') return { status: 200, headers: corsHeaders, body: JSON.stringify(await swap.rates()) };
    if (method === 'GET' && url === '/faucet/config' && grant.quota) return { status: 200, headers: corsHeaders, body: JSON.stringify({ quota: grant.quota() }) };
    if (swap && method === 'POST' && url === '/swap/quote') return { status: 200, headers: corsHeaders, body: JSON.stringify(await swap.quote(input)) };
    if (swap && method === 'POST' && url === '/swap/send') return { status: 200, headers: corsHeaders, body: JSON.stringify(await swap.submit(input)) };
    if (method !== 'POST' || url !== '/faucet') throw new ApiError(404, 'not found');
    return { status: 200, headers: corsHeaders, body: JSON.stringify(await grant(input, ip)) };
  } catch (error) { return faucetFailure(error); }
}
function faucetFailure(error: unknown) {
  return { status: error instanceof ApiError ? error.status : 503, headers: corsHeaders,
    body: JSON.stringify({ error: error instanceof ApiError ? error.message : '水龙头服务暂时不可用，请稍后重试。', code: error instanceof ApiError ? error.code : 'INTERNAL_ERROR', ...(error instanceof ApiError && error.params ? { params: error.params } : {}),
      ...(error instanceof FaucetLimit ? { next_allowed_at: error.next_allowed_at } : {}) }) };
}
export async function handleFaucet(req: IncomingMessage, res: ServerResponse, grant: FaucetHandler, swap?: Swap, checkDb?: () => Promise<void>, trustProxyHops = 0) {
  let result;
  try { result = await faucetRoute(req.method ?? 'GET', req.url ?? '/', req.method === 'POST' ? await readJson(req) : undefined,
    requestIp(req, trustProxyHops), grant, swap, checkDb); }
  catch (error) { result = faucetFailure(error); }
  for (const [key, value] of Object.entries(result.headers)) res.setHeader(key, value);
  res.setHeader('Access-Control-Allow-Origin', allowOrigin(req.headers?.origin)); res.setHeader('Vary', 'Origin');
  res.statusCode = result.status; res.end(result.body);
}
export function forwardedIp(header: string | string[] | undefined, hops: number, socketIp: string): string {
  if (!Number.isSafeInteger(hops) || hops < 1) return socketIp;
  const chain = (Array.isArray(header) ? header.join(',') : header ?? '').split(',').map(value => value.trim());
  const candidate = chain[chain.length - hops];
  // XFF 左侧可由客户端伪造；只选代理追加的跳数，并验证选中的地址。
  return candidate && isIP(candidate) ? candidate : socketIp;
}
function requestIp(req: IncomingMessage, hops: number) {
  const socketIp = req.socket?.remoteAddress ?? 'unknown';
  return forwardedIp(req.headers?.['x-forwarded-for'], hops, socketIp);
}
export const createFaucetServer = (grant: FaucetHandler, swap?: Swap, checkDb?: () => Promise<void>, trustProxyHops = 0) => createServer((req, res) => { void handleFaucet(req, res, grant, swap, checkDb, trustProxyHops); });
