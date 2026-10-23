/** INPUT: Risk preview contracts and representative bank balances. OUTPUT: Offline checks for T2 risk math. POSITION: Frontend risk calculation tests. SYNC: Keep aligned with risk.ts and root test script. */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { AccountView, BankView, BalanceView, PoolView } from '@contract';
import { installMock } from './mock.js';
import { previewRisk } from './risk.js';

const bank = (address: string, label: string, price: number, weights: BankView['weights']): BankView => ({
  address, label, price, decimals: 0, mint: address, price_updated_at: null, oracle_feed: null, oracle_source: 'mock',
  total_deposits: '0', total_borrows: '0', total_deposits_usd: 0, total_borrows_usd: 0, utilization: 0,
  lending_apr: 0, borrowing_apr: 0, weights, risk_price: null,
  curve: { optimal_utilization: 0.5, plateau_rate: 0.6, max_rate: 3, fee_rate: 0.06, fee_fixed_apr: 0.04 },
  asset_share_value: '1', liability_share_value: '1', last_accrual_at: '',
});
const collateral = bank('sol', 'tSOL', 50, { asset_init: 0.8, asset_maint: 0.9, liability_init: 1.1, liability_maint: 1.05 });
const debt = bank('usd', 'tUSDC', 1, { asset_init: 1, asset_maint: 1, liability_init: 1.1, liability_maint: 1.05 });
const balance = (b: BankView, deposit: string, borrow: string): BalanceView => ({
  bank: b.address, label: b.label, deposit, borrow,
  deposit_usd: Number(deposit) * (b.price ?? 0), borrow_usd: Number(borrow) * (b.price ?? 0),
});

test('deposit without debt has weighted assets and no health factor', () => {
  const result = previewRisk([debt], [], { action: 'deposit', bank: debt.address, amount: '100' });
  assert.equal(result.before.healthFactor, null);
  assert.equal(result.after.weightedAssetsInitUsd, 100);
  assert.equal(result.after.weightedAssetsMaintUsd, 100);
  assert.equal(result.after.healthFactor, null);
  assert.equal(result.after.borrowCapacityUsed, 0);
});

test('borrowing lowers health factor and reports remaining opening capacity', () => {
  const result = previewRisk([collateral, debt], [balance(collateral, '2', '0')], { action: 'borrow', bank: debt.address, amount: '50' });
  assert.equal(result.before.healthFactor, null);
  assert.ok(Math.abs(result.after.healthFactor! - 90 / 52.5) < 1e-12);
  assert.equal(Number(result.maxBorrow), Math.floor(80 / 1.1));
  assert.ok(Math.abs(result.after.borrowCapacityUsed! - 55 / 80) < 1e-12);
});

test('borrowing beyond opening health is blocked', () => {
  const result = previewRisk([collateral, debt], [balance(collateral, '2', '0')], { action: 'borrow', bank: debt.address, amount: '100' });
  assert.equal(result.blocked, '超过可借额度');
});

test('single collateral reports the maintenance liquidation price', () => {
  const result = previewRisk([collateral, debt], [balance(collateral, '2', '0')], { action: 'borrow', bank: debt.address, amount: '50' });
  assert.ok(Math.abs(result.liquidationPrice! - 52.5 / (2 * 0.9)) < 1e-12);
});

test('borrowing first consumes the same asset deposit', () => {
  const result = previewRisk([debt], [balance(debt, '100', '0')], { action: 'borrow', bank: debt.address, amount: '40' });
  assert.equal(result.after.weightedAssetsInitUsd, 60);
  assert.equal(result.after.weightedLiabilitiesInitUsd, 0);
});

test('depositing first repays the same asset debt', () => {
  const result = previewRisk([collateral, debt], [balance(collateral, '2', '0'), balance(debt, '0', '50')], { action: 'deposit', bank: debt.address, amount: '80' });
  assert.equal(result.after.weightedLiabilitiesInitUsd, 0);
  assert.equal(result.after.weightedAssetsInitUsd, 80 + 30);
});

test('deposits and repays are never blocked, even for an underwater account', () => {
  const underwater = [balance(collateral, '1', '0'), balance(debt, '0', '60')];
  for (const action of ['deposit', 'repay'] as const) {
    assert.equal(previewRisk([collateral, debt], underwater, { action, bank: debt.address, amount: '1' }).blocked, null);
  }
  assert.equal(previewRisk([collateral, debt], underwater, { action: 'withdraw', bank: collateral.address, amount: '1' }).blocked, '超过可借额度');
});

test('repaying the full debt returns to the no-debt state', () => {
  const result = previewRisk([collateral, debt], [balance(collateral, '2', '0'), balance(debt, '0', '50')], { action: 'repay', bank: debt.address, amount: '50' });
  assert.equal(result.after.weightedLiabilitiesMaintUsd, 0);
  assert.equal(result.after.healthFactor, null);
  assert.equal(result.blocked, null);
});

test('mock liquidation Bob agrees with the maintained USD health gap', async () => {
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const oldLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { href: 'http://localhost/?mock=liquidation', search: '?mock=liquidation' } });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { fetch: globalThis.fetch } });
  try {
    installMock();
    const browser = globalThis as unknown as { window: { fetch: typeof fetch } };
    const [pool, accounts] = await Promise.all([
      browser.window.fetch('/api/pool').then((r) => r.json() as Promise<PoolView>),
      browser.window.fetch('/api/accounts').then((r) => r.json() as Promise<AccountView[]>),
    ]);
    const bob = accounts.find((a) => a.label === 'bob')!;
    const tUSDC = pool.banks.find((b) => b.label === 'tUSDC')!;
    const result = previewRisk(pool.banks, bob.balances, { action: 'repay', bank: tUSDC.address, amount: '0' });
    const previewGap = result.before.weightedAssetsMaintUsd! - result.before.weightedLiabilitiesMaintUsd!;
    assert.ok(Math.abs(previewGap - bob.health.maint!) < 0.001);
  } finally {
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    if (oldLocation) Object.defineProperty(globalThis, 'location', oldLocation);
    else Reflect.deleteProperty(globalThis, 'location');
  }
});

// 2026-10-23 作者账户 J6ND…:按中间价还剩约 $2.3 开仓额度，程序按保守价(开仓 EMA、资产取下沿、债务取上沿)只剩 $0.34。
// 前端显示"最多可借 2.1189",链上模拟失败。预览必须用与程序相同的价格区间。
test('有价格区间时按程序的保守价计算：资产取下沿、债务取上沿，开仓与维持各用各的区间', () => {
  const pyth = { ...collateral, address: 'pyth', price: 100,
    risk_price: { init: { low: 98, high: 102 }, maint: { low: 99, high: 101 } } };
  const usd = { ...debt, risk_price: { init: { low: 1, high: 1 }, maint: { low: 1, high: 1 } } };
  // 存 10 pyth、借 780 tUSDC:中间价开仓额度 10×100×0.8 − 780×1.1 = 800 − 858 < 0 不行;改小:借 720
  const balances = [balance(pyth, '10', '0'), balance(usd, '0', '720')];
  const result = previewRisk([pyth, usd], balances, { action: 'borrow', bank: usd.address, amount: '0' });
  // 开仓：资产 10×98×0.8 = 784,债务 720×1×1.1 = 792 → 已超额，最多可借 0
  assert.equal(result.before.weightedAssetsInitUsd, 784);
  assert.ok(Math.abs(result.before.weightedLiabilitiesInitUsd! - 792) < 1e-9);
  assert.equal(result.maxBorrow, '0');
  // 按中间价(800 − 792 = 8)本会以为还能借 7;现在借 7 必须被拦下
  assert.equal(previewRisk([pyth, usd], balances, { action: 'borrow', bank: usd.address, amount: '7' }).blocked, '超过可借额度');
  // 维持口径(健康因子):资产 10×99×0.9 = 891,债务 720×1×1.05 = 756
  assert.ok(Math.abs(result.before.healthFactor! - 891 / 756) < 1e-12);
});
