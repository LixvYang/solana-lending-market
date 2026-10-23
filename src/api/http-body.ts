/** INPUT: IncomingMessage 字节流。 OUTPUT: 64KB 内 JSON。 POSITION: M7 POST 边界。 SYNC: folder.md。 */
import type { IncomingMessage } from 'node:http';
import { ApiError } from './errors';
export async function readJson(req: IncomingMessage): Promise<unknown> {
  const length = req.headers?.['content-length'];
  if (length && Number(length) > 65536) throw new ApiError(413, 'request body exceeds 64KB');
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > 65536) throw new ApiError(413, 'request body exceeds 64KB');
    chunks.push(bytes);
  }
  if (!/^application\/json(?:\s*;|$)/i.test(String(req.headers?.['content-type'] ?? ''))) throw new ApiError(400, 'JSON content-type required');
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new ApiError(400, 'invalid JSON'); }
}
export const corsHeaders = { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': 'http://localhost:5173',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };

/**
 * 跨域放行名单:浏览器页面来自哪个 Origin,就只在它属于名单时才回显它。
 * 为什么不写死 localhost:同一台机器上 `localhost` 与 `127.0.0.1` 是两个不同的 Origin,
 * 用后者打开页面时跨域请求(水龙头在另一个端口)会被浏览器拦下,而 `/api` 走同源代理看不出问题。
 * 部署时用 ALLOWED_ORIGINS(逗号分隔)指定 Vercel 域名;配置按请求读取,便于测试和单进程部署。
 */
const DEFAULT_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];
export const allowOrigin = (origin: string | string[] | undefined): string =>
  typeof origin === 'string' && new Set([...DEFAULT_ORIGINS,
    ...(process.env.ALLOWED_ORIGINS?.split(',').map(o => o.trim()).filter(Boolean) ?? [])]).has(origin)
    ? origin : 'http://localhost:5173';
