/** INPUT: indexed accounts and bank prices. OUTPUT: explorer summaries, risk ordering, and localized relative time. POSITION: chain data page calculations. */
import type { AccountView, BankView } from '@contract';
import type { Translation } from './i18n';
import { fmtTime } from './format';
import { riskMetrics } from './risk';

const hasDebt = (account: AccountView) => account.balances.some(balance => balance.borrow !== '0');
const hasPosition = (account: AccountView) => account.balances.some(balance => balance.deposit !== '0' || balance.borrow !== '0');
const depositUsd = (account: AccountView) => account.balances.reduce((sum, balance) => sum + (balance.deposit_usd ?? 0), 0);

export function explorerAccounts(accounts: AccountView[], banks: BankView[]) {
  const empty = accounts.filter(account => !hasPosition(account));
  const active = accounts.filter(hasPosition).sort((a, b) => {
    const aDebt = hasDebt(a), bDebt = hasDebt(b);
    if (aDebt !== bDebt) return aDebt ? -1 : 1;
    const aHealth = aDebt ? riskMetrics(banks, a.balances).healthPercent : null;
    const bHealth = bDebt ? riskMetrics(banks, b.balances).healthPercent : null;
    // 与状态标签一致：只有健康度 ≤ 0 才算可清算。
    const aLiquidatable = aHealth !== null && aHealth <= 0;
    const bLiquidatable = bHealth !== null && bHealth <= 0;
    if (aLiquidatable !== bLiquidatable) return aLiquidatable ? -1 : 1;
    if (aLiquidatable && bLiquidatable) return depositUsd(b) - depositUsd(a);
    if (aHealth !== null && bHealth !== null && aHealth !== bHealth) return aHealth - bHealth;
    if (aHealth === null && bHealth !== null) return 1;
    if (aHealth !== null && bHealth === null) return -1;
    return depositUsd(b) - depositUsd(a);
  });
  return { active, empty };
}

export function explorerSummary(accounts: AccountView[], banks: BankView[]) {
  const positioned = accounts.filter(hasPosition);
  const indebted = positioned.filter(hasDebt);
  const debts = indebted.map(account => ({ account, health: riskMetrics(banks, account.balances).healthPercent }))
    .filter((row): row is { account: AccountView; health: number } => row.health !== null && Number.isFinite(row.health))
    .sort((a, b) => a.health - b.health);
  return {
    positions: positioned.length,
    debtAccounts: indebted.length,
    debtUsd: indebted.some(account => account.health.liabilities_usd === null)
      ? null : indebted.reduce((sum, account) => sum + account.health.liabilities_usd!, 0),
    lowest: debts[0] ?? null,
  };
}

export function relativeTime(value: string | null, now: number, locale: 'zh' | 'en', t: Pick<Translation, 'justNow' | 'minutesAgo' | 'hoursAgo' | 'daysAgo'>) {
  if (!value) return '—';
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '—';
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 60) return t.justNow;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t.minutesAgo(minutes);
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t.hoursAgo(hours);
  const days = Math.floor(hours / 24);
  if (days <= 7) return t.daysAgo(days);
  return fmtTime(new Date(timestamp).toISOString(), locale).split(locale === 'zh' ? ' ' : ',')[0];
}
