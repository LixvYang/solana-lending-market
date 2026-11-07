import test from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { pgliteDb } from '../store/db';
import { seedApi } from '../api/test-utils';
import { createVercelHandler, restoreRewrittenUrl } from './handler';

function response() {
  const headers: Record<string, string> = {}; let status = 0, body = '';
  const res = { setHeader: (key: string, value: string) => { headers[key] = value; }, set statusCode(value: number) { status = value; }, end: (value = '') => { body = value; } };
  return { res: res as unknown as ServerResponse, headers, status: () => status, body: () => body };
}

test('Vercel routes desk and API requests, caches only successful public reads, and checks cron secret', async () => {
  const db = await seedApi(); const deferred: Promise<unknown>[] = []; let syncs = 0;
  try {
    const faucet = Object.assign(async () => ({ signatures: [], granted: [], next_allowed_at: '' }), { quota: () => ({ max: 30, remaining: 4, window_hours: 5, resets_at: null }) });
    const handler = createVercelHandler({ db, faucet, cronSecret: 'cron-test', waitUntil: work => deferred.push(work), maybeSync: async () => { syncs++; } });
    const publicResponse = response();
    await handler({ method: 'GET', url: '/api/pool' } as IncomingMessage, publicResponse.res);
    assert.equal(publicResponse.status(), 200);
    assert.equal(publicResponse.headers['Cache-Control'], 'public, s-maxage=5, stale-while-revalidate=10');
    assert.equal(syncs, 1); await Promise.all(deferred.splice(0)); assert.equal(syncs, 1);

    const deskResponse = response();
    await handler({ method: 'GET', url: '/api/desk/faucet/config' } as IncomingMessage, deskResponse.res);
    assert.equal(JSON.parse(deskResponse.body()).quota.remaining, 4);
    assert.equal(deskResponse.headers['Cache-Control'], 'public, s-maxage=5, stale-while-revalidate=10');

    const walletResponse = response();
    await handler({ method: 'GET', url: '/api/wallet/not-a-key' } as IncomingMessage, walletResponse.res);
    assert.equal(walletResponse.headers['Cache-Control'], undefined);

    const denied = response();
    await handler({ method: 'GET', url: '/api/cron/sync', headers: {} } as IncomingMessage, denied.res);
    assert.equal(denied.status(), 401);
    const accepted = response();
    await handler({ method: 'GET', url: '/api/cron/sync', headers: { authorization: 'Bearer cron-test' } } as IncomingMessage, accepted.res);
    assert.equal(accepted.status(), 200);
    assert.equal(JSON.parse(accepted.body()).ok, true);
  } finally { await db.close(); }
});

test('Vercel handler leaves POST and failed responses uncached', async () => {
  const db = pgliteDb(); await db.query('CREATE TABLE schema_migrations(name text primary key)');
  const h = createVercelHandler({ db, cronSecret: 'x', waitUntil: () => {}, maybeSync: async () => {} });
  try {
    const failed = response();
    await h({ method: 'GET', url: '/api/nope' } as IncomingMessage, failed.res);
    assert.equal(failed.status(), 404); assert.equal(failed.headers['Cache-Control'], undefined);
    const post = response();
    await h({ method: 'POST', url: '/api/nope', headers: {} } as IncomingMessage, post.res);
    assert.equal(post.headers['Cache-Control'], undefined);
  } finally { await db.close(); }
});

test('还原 vercel.json 改写前的多段路径与查询参数', () => {
  assert.equal(restoreRewrittenUrl('/api/main?__path=wallet%2FAbc&x=1'), '/api/wallet/Abc?x=1');
  assert.equal(restoreRewrittenUrl('/api/main?__path=desk/faucet/config'), '/api/desk/faucet/config');
  assert.equal(restoreRewrittenUrl('/api/pool?x=1'), '/api/pool?x=1');
});

test('兑换台路由忽略改写附带的查询参数', async () => {
  const db = await seedApi();
  try {
    const faucet = Object.assign(async () => ({ signatures: [], granted: [], next_allowed_at: '' }), { quota: () => ({ max: 30, remaining: 7, window_hours: 5, resets_at: null }) });
    const h = createVercelHandler({ db, faucet, cronSecret: 'x', waitUntil: () => {}, maybeSync: async () => {} });
    const out = response();
    await h({ method: 'GET', url: '/api/desk/faucet/config?__path=desk/faucet/config&path=desk', headers: {} } as unknown as IncomingMessage, out.res);
    assert.equal(out.status(), 200); assert.equal(JSON.parse(out.body()).quota.remaining, 7);
  } finally { await db.close(); }
});
