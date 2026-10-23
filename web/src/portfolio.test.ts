import assert from 'node:assert/strict';
import test from 'node:test';
import type { AccountView, BankView } from '@contract';
import { portfolioSummary } from './portfolio';

const bank = { address: 'bank', lending_apr: 0.1, borrowing_apr: 0.2, weights: {
  asset_init: 0.8, asset_maint: 0.9, liability_init: 1.1, liability_maint: 1.05,
}, decimals: 0, price: 10 } as BankView;
const account = (deposit: number, borrow: number): AccountView => ({
  address: 'account', label: 'me', authority: 'wallet',
  balances: [{ bank: bank.address, label: 'T', deposit: String(deposit / 10), borrow: String(borrow / 10), deposit_usd: deposit, borrow_usd: borrow }],
  health: { init: 0, maint: 0, assets_usd: deposit, liabilities_usd: borrow }, status: borrow ? 'healthy' : 'no_debt',
});

test('portfolio summary reports net value, estimated net APY, health percent and used capacity', () => {
  const result = portfolioSummary(account(100, 20), [bank]);
  assert.equal(result.netAssetsUsd, 80);
  assert.equal(result.netApy, 0.075);
  assert.ok(Math.abs(result.healthPercent! - (90 - 21) / 90 * 100) < 1e-12);
  assert.equal(result.borrowCapacityUsed, 22 / 80);
});

test('no debt has 100 percent health and unknown balance prices stay hidden', () => {
  assert.equal(portfolioSummary(account(100, 0), [bank]).healthPercent, 100);
  assert.equal(portfolioSummary({ ...account(10, 0), balances: [{ ...account(10, 0).balances[0], deposit_usd: null }] }, [bank]).netAssetsUsd, null);
});
