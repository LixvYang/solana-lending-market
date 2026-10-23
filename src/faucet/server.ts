/** INPUT: JSON 请求与专用水龙头服务。 OUTPUT: /faucet HTTP。 POSITION: 独立 EP8 服务边界。 SYNC: folder.md。 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readJson, corsHeaders, allowOrigin } from '../api/http-body';
import { ApiError } from '../api/errors';
import { FaucetLimit } from './service';
import type { Swap } from './swap';
import type { FaucetResponse } from '../api/types';
export type FaucetHandler = (input: unknown, ip: string) => Promise<FaucetResponse>;
export async function faucetRoute(method: string, url: string, input: unknown, ip: string, grant: FaucetHandler, swap?: Swap, checkDb?: () => Promise<void>) {
  try {
    if (method === 'OPTIONS') return { status: 204, headers: corsHeaders, body: '' };
    if (method === 'GET' && (url === '/healthz' || url === '/health')) {
      if (url === '/healthz' && checkDb) await checkDb();
      return { status: 200, headers: corsHeaders, body: '{"ok":true}' };
    }
    if (swap && method === 'GET' && url === '/swap/rates') return { status: 200, headers: corsHeaders, body: JSON.stringify(await swap.rates()) };
    if (swap && method === 'POST' && url === '/swap/quote') return { status: 200, headers: corsHeaders, body: JSON.stringify(await swap.quote(input)) };
    if (swap && method === 'POST' && url === '/swap/send') return { status: 200, headers: corsHeaders, body: JSON.stringify(await swap.submit(input)) };
    if (method !== 'POST' || url !== '/faucet') throw new ApiError(404, 'not found');
    return { status: 200, headers: corsHeaders, body: JSON.stringify(await grant(input, ip)) };
  } catch (error) { return faucetFailure(error); }
}
function faucetFailure(error: unknown) {
  return { status: error instanceof ApiError ? error.status : 503, headers: corsHeaders,
    body: JSON.stringify({ error: error instanceof ApiError ? error.message : 'faucet unavailable',
      ...(error instanceof FaucetLimit ? { next_allowed_at: error.next_allowed_at } : {}) }) };
}
export async function handleFaucet(req: IncomingMessage, res: ServerResponse, grant: FaucetHandler, swap?: Swap, checkDb?: () => Promise<void>) {
  let result;
  try { result = await faucetRoute(req.method ?? 'GET', req.url ?? '/', req.method === 'POST' ? await readJson(req) : undefined,
    // 只信 socket IP，任意客户端都能伪造 X-Forwarded-For。代理部署需另行配置可信代理。
    req.socket?.remoteAddress ?? 'unknown', grant, swap, checkDb); }
  catch (error) { result = faucetFailure(error); }
  for (const [key, value] of Object.entries(result.headers)) res.setHeader(key, value);
  res.setHeader('Access-Control-Allow-Origin', allowOrigin(req.headers?.origin)); res.setHeader('Vary', 'Origin');
  res.statusCode = result.status; res.end(result.body);
}
export const createFaucetServer = (grant: FaucetHandler, swap?: Swap, checkDb?: () => Promise<void>) => createServer((req, res) => { void handleFaucet(req, res, grant, swap, checkDb); });
