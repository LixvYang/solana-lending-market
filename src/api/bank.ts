/** INPUT: 解码 Bank / Group / PullFeed 与链下标签。 OUTPUT: BankView 与汇总。 POSITION: EP7 池子组装。 SYNC: 同步 folder.md。 */
import { toDecimal } from '../core/fixed';
import { rates, shareQuantity, floor, usd, displayNumber, fixedRational, utilization } from './math';
import { label, unixIso, type BankData, type GroupData, type State } from './state';
import type { BankView, InterestCurve, PoolView } from './types';
import { marginfiIdl } from '../decoder/idl';
import { oracleAccountOf } from '../oracle/pyth';
import { riskPrice } from './oracle-price';
const number = (v: Parameters<typeof fixedRational>[0]) => displayNumber(fixedRational(v));
export function interestCurve(bank: BankData, group: GroupData): InterestCurve {
  const c = bank.config.interest_rate_config, cache = group.fee_state_cache;
  // marginfi_group.rs:99-102 / 223-239 / 320-321 / 375-388：insurance + group + program（flag == 1 才启用）。
  // origination fee 是一次性开仓费，不进入 APR；读 group 的缓存，不能拿 FeeState 的最新值代替。
  const enabled = group.group_flags === 1n;
  return { optimal_utilization: number(c.optimal_utilization_rate), plateau_rate: number(c.plateau_interest_rate), max_rate: number(c.max_interest_rate),
    fee_rate: number(c.insurance_ir_fee) + number(c.protocol_ir_fee) + (enabled ? number(cache.program_fee_rate) : 0),
    fee_fixed_apr: number(c.insurance_fee_fixed_apr) + number(c.protocol_fixed_fee_apr) + (enabled ? number(cache.program_fee_fixed) : 0) };
}
/** 银行当前价格账户的快照(Pyth 银行先由 feed id 换算出账户地址)。 */
export function bankFeed(bank: BankData, state: State) {
  const account = oracleAccountOf(bank.config);
  return account ? state.feeds[account] : undefined;
}
export function bankView(address: string, bank: BankData, state: State): BankView {
  const group = state.groups[bank.group];
  if (!group)
    throw new Error('missing group snapshot for interest fees');
  const oracle_feed = oracleAccountOf(bank.config), feed = bankFeed(bank, state);
  // 未 crank(Switchboard sample_size=0)或 Pyth 非 Full 校验不提供有效价格;解码器仍忠实返回原值。不预测价格新鲜度。
  const price = feed && feed.valid && Number.isFinite(feed.price.number) ? feed.price.number : null;
  const deposit = shareQuantity(bank.total_asset_shares, bank.asset_share_value), borrow = shareQuantity(bank.total_liability_shares, bank.liability_share_value);
  const u = deposit.numerator === 0n ? 0 : utilization(displayNumber({ numerator: borrow.numerator * deposit.denominator, denominator: borrow.denominator * deposit.numerator }));
  const curve = interestCurve(bank, group), c = bank.config, decimals = Number(bank.mint_decimals);
  return { address, mint: bank.mint, label: state.labels[bank.mint] ?? label(state.labels, address), decimals, price,
    price_updated_at: price === null ? null : unixIso(feed!.last_update_timestamp), oracle_feed, oracle_source: feed?.source ?? null,
    total_deposits: String(floor(deposit)), total_borrows: String(floor(borrow)),
    total_deposits_usd: usd(deposit, decimals, price), total_borrows_usd: usd(borrow, decimals, price), utilization: u, ...rates(u, curve),
    // 前端风险预览要与程序同价(资产取下沿、债务取上沿),否则 Pyth 资产多时会以为还能借(D-019、2026-10-23)。
    risk_price: price === null ? null : { init: riskPrice(feed!, 'init'), maint: riskPrice(feed!, 'maint') },
    weights: { asset_init: number(c.asset_weight_init), asset_maint: number(c.asset_weight_maint), liability_init: number(c.liability_weight_init), liability_maint: number(c.liability_weight_maint) }, curve,
    asset_share_value: toDecimal(Uint8Array.from(bank.asset_share_value.value)), liability_share_value: toDecimal(Uint8Array.from(bank.liability_share_value.value)), last_accrual_at: unixIso(bank.last_update) };
}
export function poolView(state: State): PoolView {
  const banks = Object.entries(state.banks).map(([address, bank]) => bankView(address, bank, state));
  const sum = (field: 'total_deposits_usd' | 'total_borrows_usd') => banks.some(b => b[field] === null) ? null : banks.reduce((n, b) => n + b[field]!, 0);
  const deposits_usd = sum('total_deposits_usd'), borrows_usd = sum('total_borrows_usd');
  const slots = state.rows.map(r => BigInt(String(r.slot))), maximum = slots.length ? slots.reduce((a, b) => a > b ? a : b) : null;
  const groups = [...new Set(Object.values(state.banks).map(b => b.group))];
  return { program: marginfiIdl.address, group: groups.length === 1 ? groups[0] : null,
    as_of_slot: state.sampledSlot ?? (maximum === null ? null : String(maximum)), banks,
    totals: { deposits_usd, borrows_usd, utilization: deposits_usd === null || borrows_usd === null ? null : deposits_usd === 0 ? 0 : utilization(borrows_usd / deposits_usd) } };
}
