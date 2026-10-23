/** INPUT: Bank prices/weights and native-unit account balances. OUTPUT: Estimated before/after risk for one action. POSITION: Pure frontend lending-risk calculation. SYNC: Pyth prices are point estimates here; the program uses confidence bounds, so server simulation is authoritative. */
import type { BankView, BalanceView, WalletAction } from '@contract';

export interface RiskMetrics {
  weightedAssetsInitUsd: number | null;
  weightedLiabilitiesInitUsd: number | null;
  weightedAssetsMaintUsd: number | null;
  weightedLiabilitiesMaintUsd: number | null;
  healthPercent: number | null;
  borrowCapacityUsed: number | null;
}

export interface RiskAction { action: WalletAction; bank: string; amount: string }
export interface RiskPreview { before: RiskMetrics; after: RiskMetrics; maxBorrow: string | null; liquidationPrice: number | null; blocked: string | null }

type Position = { deposit: bigint; borrow: bigint };
const zero = (): Position => ({ deposit: 0n, borrow: 0n });

function positionsOf(balances: BalanceView[]) {
  const positions = new Map<string, Position>();
  for (const b of balances) {
    const p = positions.get(b.bank) ?? zero();
    p.deposit += BigInt(b.deposit);
    p.borrow += BigInt(b.borrow);
    positions.set(b.bank, p);
  }
  return positions;
}

function apply(positions: Map<string, Position>, action: RiskAction, bank: BankView) {
  if (!/^\d+$/.test(action.amount)) throw new RangeError('amount must be a non-negative native-unit integer');
  const amount = BigInt(action.amount), p = positions.get(bank.address) ?? zero();
  if (action.action === 'withdraw' && amount > p.deposit) throw new RangeError('withdraw exceeds deposit');
  if (action.action === 'repay' && amount > p.borrow) throw new RangeError('repay exceeds borrow');
  // mrgn-0.1.0 的 deposit/borrow 都是"Any"模式(marginfi_account.rs increase/decrease_balance_internal):
  // 存款先还同资产债务、余下才记存款;借款先取同资产存款、不够才记债务。
  if (action.action === 'deposit') {
    const offset = amount < p.borrow ? amount : p.borrow;
    p.borrow -= offset;
    p.deposit += amount - offset;
  }
  if (action.action === 'withdraw') p.deposit -= amount;
  if (action.action === 'repay') p.borrow -= amount;
  if (action.action === 'borrow') {
    const offset = amount < p.deposit ? amount : p.deposit;
    p.deposit -= offset;
    p.borrow += amount - offset;
  }
  positions.set(bank.address, p);
}

/**
 * 程序算健康度用的价格区间(mrgn-0.1.0;API 的 riskPrice 同一算法):开仓用 EMA、维持用实时价;
 * 资产取下沿、债务取上沿。没有区间(mock 价，std_dev 为 0)时退化为单一价格。
 * 曾只用中间价：持有约 $3k Pyth 资产的账户，预览以为还能借 $2.3,程序只认 $0.34,模拟失败。
 */
const band = (b: BankView, mode: 'init' | 'maint') => b.risk_price?.[mode] ?? { low: b.price!, high: b.price! };

function metrics(positions: Map<string, Position>, banks: Map<string, BankView>): RiskMetrics {
  const sums = { weightedAssetsInitUsd: 0, weightedLiabilitiesInitUsd: 0, weightedAssetsMaintUsd: 0, weightedLiabilitiesMaintUsd: 0 };
  for (const [address, p] of positions) {
    if (!p.deposit && !p.borrow) continue;
    const b = banks.get(address);
    if (!b || b.price == null || !Number.isFinite(b.price)) return { ...sums, weightedAssetsInitUsd: null, weightedLiabilitiesInitUsd: null, weightedAssetsMaintUsd: null, weightedLiabilitiesMaintUsd: null, healthPercent: null, borrowCapacityUsed: null };
    const deposited = Number(p.deposit) / 10 ** b.decimals, borrowed = Number(p.borrow) / 10 ** b.decimals;
    const init = band(b, 'init'), maint = band(b, 'maint');
    sums.weightedAssetsInitUsd += deposited * init.low * b.weights.asset_init;
    sums.weightedLiabilitiesInitUsd += borrowed * init.high * b.weights.liability_init;
    sums.weightedAssetsMaintUsd += deposited * maint.low * b.weights.asset_maint;
    sums.weightedLiabilitiesMaintUsd += borrowed * maint.high * b.weights.liability_maint;
  }
  return { ...sums,
    healthPercent: sums.weightedAssetsMaintUsd > 0
      ? (sums.weightedAssetsMaintUsd - sums.weightedLiabilitiesMaintUsd) / sums.weightedAssetsMaintUsd * 100
      : sums.weightedLiabilitiesMaintUsd > 0 ? 0 : null,
    borrowCapacityUsed: sums.weightedAssetsInitUsd ? sums.weightedLiabilitiesInitUsd / sums.weightedAssetsInitUsd : sums.weightedLiabilitiesInitUsd ? null : 0 };
}

export function riskMetrics(banks: BankView[], balances: BalanceView[]): RiskMetrics {
  return metrics(positionsOf(balances), new Map(banks.map((bank) => [bank.address, bank])));
}

function maxBorrow(positions: Map<string, Position>, banks: Map<string, BankView>, target: BankView): string | null {
  if (target.price == null || !(target.price > 0)) return null;
  let assets = 0, liabilities = 0;
  for (const [address, p] of positions) {
    if (address === target.address || (!p.deposit && !p.borrow)) continue;
    const b = banks.get(address);
    if (!b || b.price == null || !Number.isFinite(b.price)) return null;
    assets += Number(p.deposit) / 10 ** b.decimals * band(b, 'init').low * b.weights.asset_init;
    liabilities += Number(p.borrow) / 10 ** b.decimals * band(b, 'init').high * b.weights.liability_init;
  }
  const current = positions.get(target.address) ?? zero();
  const releasableDeposit = Number(current.deposit) / 10 ** target.decimals;
  const currentBorrow = Number(current.borrow) / 10 ** target.decimals;
  const extra = Math.max(0, releasableDeposit + (assets - liabilities) / (band(target, 'init').high * target.weights.liability_init) - currentBorrow);
  return BigInt(Math.floor(extra * 10 ** target.decimals)).toString();
}

function liquidationPrice(positions: Map<string, Position>, banks: Map<string, BankView>, after: RiskMetrics): number | null {
  const collateral = [...positions].filter(([, p]) => p.deposit > 0n);
  if (collateral.length !== 1 || after.weightedLiabilitiesMaintUsd == null) return null;
  const [address, p] = collateral[0], b = banks.get(address);
  if (!b || !b.weights.asset_maint || after.weightedLiabilitiesMaintUsd <= 0) return null;
  return after.weightedLiabilitiesMaintUsd / (Number(p.deposit) / 10 ** b.decimals * b.weights.asset_maint);
}

export function previewRisk(banks: BankView[], balances: BalanceView[], action: RiskAction): RiskPreview {
  const byAddress = new Map(banks.map((b) => [b.address, b]));
  const target = byAddress.get(action.bank);
  if (!target) throw new RangeError('unknown bank');
  const beforePositions = positionsOf(balances), afterPositions = positionsOf(balances);
  apply(afterPositions, action, target);
  const before = metrics(beforePositions, byAddress), after = metrics(afterPositions, byAddress);
  // 程序只在 borrow/withdraw 后检查开仓健康度;存款和还款不检查——资不抵债的账户正需要靠它们补救，不能拦。
  const checked = action.action === 'borrow' || action.action === 'withdraw';
  const initHealth = !checked || after.weightedAssetsInitUsd == null || after.weightedLiabilitiesInitUsd == null ? null : after.weightedAssetsInitUsd - after.weightedLiabilitiesInitUsd;
  return { before, after, maxBorrow: maxBorrow(beforePositions, byAddress, target), liquidationPrice: liquidationPrice(afterPositions, byAddress, after), blocked: initHealth != null && initHealth < 0 ? '超过可借额度' : null };
}
