import test from 'node:test';
import assert from 'node:assert/strict';
import { getWalletHistory } from './wallet-history';
import { route } from './server';
import { insertDeskEvent } from '../store/desk-events';
import { seedApi } from './test-utils';
import { addresses as a } from './wallet-test-utils';

test('wallet history merges desk records, paginates, and isolates records by wallet', async () => {
  const db = await seedApi();
  try {
    const signature = '5mockDeskSwap11111111111111111111111111111111111111111111111111111111111111111111';
    await insertDeskEvent(db, { signature, wallet: a.actors.bob, kind: 'swap',
      from: { symbol: 'SOL', amount: '10000000', decimals: 9 }, to: { symbol: 'pSOL', amount: '100000000', decimals: 9 }, status: 'confirmed' });
    await insertDeskEvent(db, { signature: `${signature}2`, wallet: a.actors.alice, kind: 'faucet',
      details: [{ symbol: 'tUSDC', amount: '1000000', decimals: 6 }], status: 'confirmed' });
    const all = await getWalletHistory(db, a.actors.bob, { limit: 100 });
    assert.ok(all.items.some(row => row.kind === 'swap' && row.assets[0].symbol === 'SOL' && row.assets[1].symbol === 'pSOL'));
    // 兑换两侧要带上各自的小数位(曾因 SQL 漏选 from_decimals/to_decimals,0.005 SOL 显示成 5,000,000 SOL)。
    const swap = all.items.find(row => row.kind === 'swap')!;
    assert.deepEqual(swap.assets.map(leg => leg.decimals), [9, 9]);
    assert.equal(swap.result, 'success');
    assert.ok(all.items.some(row => row.kind === 'liquidated'), 'victim sees their liquidation');
    assert.equal(all.items.find(row => row.kind === 'liquidated')?.result, 'success');
    const liquidator = await getWalletHistory(db, a.actors.carol, { limit: 100 });
    assert.ok(liquidator.items.some(row => row.kind === 'liquidator'), 'liquidator sees their action');
    assert.ok(!all.items.some(row => row.signature === `${signature}2`), 'another wallet desk row is private');

    const first = await getWalletHistory(db, a.actors.bob, { limit: 1 });
    assert.equal(first.items.length, 1); assert.ok(first.next_before);
    const second = await getWalletHistory(db, a.actors.bob, { limit: 1, before: first.next_before! });
    assert.equal(second.items.length, 1); assert.notEqual(first.items[0].signature, second.items[0].signature);
    const response = await route(db, 'GET', `/api/wallet/${a.actors.bob}/history?limit=1`);
    assert.equal(response.status, 200); assert.equal(JSON.parse(response.body).items.length, 1);
    assert.equal((await route(db, 'GET', '/api/wallet/invalid/history')).status, 400);
    assert.equal((await route(db, 'GET', `/api/wallet/${a.actors.bob}/history?before=bad`)).status, 400);
  } finally { await db.close(); }
});

// 2026-10-23 真实数据发现：清算事件的余额是 f64,差值如 475000000.00000095;前端按整数原生单位格式化会出错。
test('清算的数量是整数原生单位', async () => {
  const db = await seedApi();
  try {
    const rows = (await getWalletHistory(db, a.actors.bob, { limit: 100 })).items.filter(r => r.kind === 'liquidated');
    assert.ok(rows.length > 0);
    for (const row of rows) for (const leg of row.assets) assert.match(leg.amount, /^\d+$/, `${leg.symbol} ${leg.amount}`);
  } finally { await db.close(); }
});

// 剧本账户由固定种子派生，每次重跑剧本都在新池子里留下记录;设置 POOL_GROUP 时只看当前池子(与 /api/activity 一致)。
test('设置 POOL_GROUP 时只返回该池子的借贷记录', async () => {
  const db = await seedApi();
  const before = process.env.POOL_GROUP;
  try {
    process.env.POOL_GROUP = 'Other1111111111111111111111111111111111111';
    const other = await getWalletHistory(db, a.actors.bob, { limit: 100 });
    assert.equal(other.items.filter(r => r.kind !== 'swap' && r.kind !== 'faucet').length, 0);
    process.env.POOL_GROUP = a.group;
    assert.ok((await getWalletHistory(db, a.actors.bob, { limit: 100 })).items.length > 0);
  } finally {
    if (before === undefined) delete process.env.POOL_GROUP; else process.env.POOL_GROUP = before;
    await db.close();
  }
});
