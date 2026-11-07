import type { AccountView, BankView, BalanceView } from '@contract';
import { riskMetrics } from './risk';

export interface PortfolioSummary {
  netAssetsUsd: number | null;
  netApy: number | null;
  healthPercent: number | null;
  borrowCapacityUsed: number | null;
}

export function positionSummary(balances: BalanceView[], banks: BankView[], kind: 'deposit' | 'borrow') {
  const byAddress = new Map(banks.map((bank) => [bank.address, bank]));
  let usd = 0, weightedApr = 0, count = 0;
  for (const balance of balances) {
    const value = kind === 'deposit' ? balance.deposit_usd : balance.borrow_usd;
    const amount = kind === 'deposit' ? balance.deposit : balance.borrow;
    if (amount === '0') continue;
    const bank = byAddress.get(balance.bank);
    if (value == null || !bank) return { usd: null, apr: null };
    usd += value;
    weightedApr += value * (kind === 'deposit' ? bank.lending_apr : bank.borrowing_apr);
    count++;
  }
  return count ? { usd, apr: usd > 0 ? weightedApr / usd : null } : null;
}

export function shouldShowGettingStarted(connected: boolean, hasDeposit: boolean) {
  return !connected || !hasDeposit;
}

export function sortByUsdDesc<T>(items: T[], usd: (item: T) => number | null) {
  return [...items].sort((a, b) => {
    const left = usd(a), right = usd(b);
    if (left == null) return right == null ? 0 : 1;
    return right == null ? -1 : right - left;
  });
}

/** Dashboard adds net value and APY; risk metrics come from the shared preview calculation. */
export function portfolioSummary(account: AccountView | null, banks: BankView[]): PortfolioSummary {
  if (!account) return { netAssetsUsd: 0, netApy: null, healthPercent: null, borrowCapacityUsed: null };
  let deposits = 0, borrows = 0, income = 0;
  let priced = true;
  const byAddress = new Map(banks.map((bank) => [bank.address, bank]));
  for (const balance of account.balances) {
    if (balance.deposit === '0' && balance.borrow === '0') continue;
    if (balance.deposit_usd == null || balance.borrow_usd == null) { priced = false; continue; }
    deposits += balance.deposit_usd;
    borrows += balance.borrow_usd;
    const bank = byAddress.get(balance.bank);
    income += balance.deposit_usd * (bank?.lending_apr ?? 0) - balance.borrow_usd * (bank?.borrowing_apr ?? 0);
  }
  const risk = riskMetrics(banks, account.balances);
  return {
    netAssetsUsd: priced ? deposits - borrows : null,
    netApy: priced && deposits > borrows ? income / (deposits - borrows) : null,
    healthPercent: risk.healthPercent,
    borrowCapacityUsed: risk.borrowCapacityUsed,
  };
}
