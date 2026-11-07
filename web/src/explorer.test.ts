import assert from 'node:assert/strict';
import test from 'node:test';
import type { AccountView, BankView } from '@contract';
import { explorerAccounts, explorerSummary, relativeTime } from './explorer';

const bank = { address: 'bank', label: 'USD', decimals: 0, price: 1, weights: { asset_init: 1, asset_maint: 1, liability_init: 1, liability_maint: 1 } } as BankView;
function account(address: string, deposit: number, borrow: number): AccountView {
  return { address, label: address, authority: address, balances: [{ bank: 'bank', label: 'USD', deposit: String(deposit), borrow: String(borrow), deposit_usd: deposit, borrow_usd: borrow }],
    health: { init: deposit - borrow, maint: deposit - borrow, assets_usd: deposit, liabilities_usd: borrow },
    status: borrow ? 'healthy' : 'no_debt' };
}

test('risk rows put liquidatable and lower health first, then no debt; empty accounts are hidden', () => {
  const rows = explorerAccounts([account('empty', 0, 0), account('no-debt-small', 90, 0), account('no-debt-large', 120, 0), account('safe', 100, 40), account('risk', 100, 95), account('critical', 150, 150), account('critical-large', 200, 200)], [bank]);
  assert.deepEqual(rows.active.map(row => row.address), ['critical-large', 'critical', 'risk', 'safe', 'no-debt-large', 'no-debt-small']);
  assert.deepEqual(rows.empty.map(row => row.address), ['empty']);
});

test('overview counts active and indebted accounts and reports lowest health with label', () => {
  const summary = explorerSummary([account('empty', 0, 0), account('alice', 100, 0), account('bob', 100, 95), account('carol', 100, 25)], [bank]);
  assert.equal(summary.positions, 3);
  assert.equal(summary.debtAccounts, 2);
  assert.equal(summary.debtUsd, 120);
  assert.equal(summary.lowest?.account.label, 'bob');
});

test('relative time covers seconds, minutes, hours, days, and dates after a week', () => {
  const now = Date.parse('2026-10-27T12:00:00Z');
  const t = { justNow: '刚刚', minutesAgo: (n: number) => `${n} 分钟前`, hoursAgo: (n: number) => `${n} 小时前`, daysAgo: (n: number) => `${n} 天前` };
  const ago = (seconds: number) => new Date(now - seconds * 1000).toISOString();
  assert.equal(relativeTime(ago(20), now, 'zh', t), '刚刚');
  assert.equal(relativeTime(ago(180), now, 'zh', t), '3 分钟前');
  assert.equal(relativeTime(ago(7200), now, 'zh', t), '2 小时前');
  assert.equal(relativeTime(ago(259200), now, 'zh', t), '3 天前');
  assert.match(relativeTime(ago(8 * 86400), now, 'en', t), /^10\/19/);
  assert.equal(relativeTime(null, now, 'en', t), '—');
});

test('只有健康度 ≤ 0 才算可清算：5% 的大账户排在 0% 的小账户之后', () => {
  const rows = explorerAccounts([account('danger-large', 1000, 950), account('liquidatable-small', 100, 100)], [bank]);
  assert.deepEqual(rows.active.map(row => row.address), ['liquidatable-small', 'danger-large']);
});
