import type { AccountView, BankView } from '@contract';
import { riskMetrics } from './risk';

export interface PortfolioSummary {
  netAssetsUsd: number | null;
  netApy: number | null;
  healthPercent: number | null;
  borrowCapacityUsed: number | null;
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
