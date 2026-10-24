/** INPUT: Vercel Node HTTP request and cached runtime services. OUTPUT: routed API, desk, cron responses. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Db } from '../store/db';
import type { WalletServices } from '../api/wallet-rpc';
import type { FaucetHandler } from '../faucet/server';
import type { Swap } from '../faucet/swap';
import { handle } from '../api/server';
import { handleFaucet } from '../faucet/server';

const CACHE = 'public, s-maxage=5, stale-while-revalidate=10';
const PUBLIC_READS = new Set(['/api/pool', '/api/accounts', '/api/activity', '/api/liquidations', '/api/config',
  '/api/rate-curve', '/api/bank-history', '/api/desk/swap/rates', '/api/desk/faucet/config']);
const cacheable = (method: string, url: string, status: number) => {
  if (method !== 'GET' || status < 200 || status >= 300) return false;
  const path = new URL(url, 'http://localhost').pathname;
  return PUBLIC_READS.has(path);
};

interface Options {
  db: Db;
  services?: WalletServices;
  faucet?: FaucetHandler;
  getFaucet?: () => Promise<{ grant: FaucetHandler; swap?: Swap }>;
  checkDb?: () => Promise<void>;
  trustProxyHops?: number;
  cronSecret: string | undefined;
  waitUntil(work: Promise<unknown>): void;
  maybeSync(): Promise<unknown>;
}

// 非 Next.js 项目里 api/[...path].ts 只匹配一段路径(/api/wallet/<key> 会 404),所以 vercel.json 把 /api/* 改写到
// /api/main?__path=<原路径>。这里还原成原始 URL,保留其余查询参数;没有 __path 时(本地/测试)原样返回。
export function restoreRewrittenUrl(url: string): string {
  const parsed = new URL(url, 'http://localhost'), path = parsed.searchParams.get('__path');
  if (path === null) return url;
  parsed.searchParams.delete('__path');
  return `/api/${path.replace(/^\/+/, '')}${parsed.search}`;
}

export function createVercelHandler(options: Options) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    req.url = restoreRewrittenUrl(req.url ?? '/');
    const method = req.method ?? 'GET', originalUrl = req.url ?? '/', url = new URL(originalUrl, 'http://localhost');
    const output = cachedResponse(res, method, originalUrl);
    if (url.pathname === '/api/cron/sync') {
      if (method !== 'GET' || !options.cronSecret || req.headers.authorization !== `Bearer ${options.cronSecret}`) {
        send(output, 401, { error: 'unauthorized', code: 'UNAUTHORIZED' }); return;
      }
      await options.maybeSync();
      send(output, 200, { ok: true }); return;
    }

    // 背景任务注册在响应结束前，失败只会进入同步模块的安全日志，不影响 API 响应。
    options.waitUntil(Promise.resolve().then(options.maybeSync).catch(() => undefined));
    if (url.pathname.startsWith('/api/desk/')) {
      try {
        const { grant, swap } = options.getFaucet ? await options.getFaucet() : { grant: options.faucet, swap: undefined };
        if (!grant) { send(output, 503, { error: 'desk service unavailable', code: 'SERVICE_UNAVAILABLE' }); return; }
        req.url = originalUrl.slice('/api/desk'.length);
        await handleFaucet(req, output, grant, swap, options.checkDb, options.trustProxyHops);
      } catch { send(output, 503, { error: 'desk service unavailable', code: 'SERVICE_UNAVAILABLE' }); }
      finally { req.url = originalUrl; }
      return;
    }
    await handle(options.db, req, output, options.services);
  };
}

function cachedResponse(res: ServerResponse, method: string, url: string): ServerResponse {
  let status = 200;
  return {
    setHeader: (name: string, value: string | number | readonly string[]) => res.setHeader(name, value),
    get statusCode() { return status; }, set statusCode(value: number) { status = value; res.statusCode = value; },
    end: (body?: string | Uint8Array) => {
      if (cacheable(method, url, status)) res.setHeader('Cache-Control', CACHE);
      res.end(body);
      return res;
    },
  } as ServerResponse;
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.statusCode = status;
  res.end(JSON.stringify(body));
}
