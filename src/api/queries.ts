/** INPUT: Db。 OUTPUT: 池子、利率曲线、账户、历史、活动与 X 光查询。 POSITION: EP7 只读视图入口，无 RPC。 SYNC: 同步 folder.md。 */
import type { Db } from '../store/db';
import type { AccountView, RateCurveView, PoolView } from './types';
import { readState, label } from './state';
import { poolView, bankFeed } from './bank';
import { riskPrice } from './oracle-price';
import { health, quantity, shareQuantity, floor, usd, rates, type HealthBalance } from './math';
export function getPool(db: Db): Promise<PoolView> { return readState(db).then(poolView); }
export { getBankHistory } from './bank-history';
export async function getRateCurve(db: Db, address: string): Promise<RateCurveView | null> {
  const bank = (await getPool(db)).banks.find(b => b.address === address);
  if (!bank)
    return null;
  const points = Array.from({ length: 101 }, (_, i) => ({ utilization: i / 100, ...rates(i / 100, bank.curve) }));
  return { bank: address, label: bank.label, points, current: { utilization: bank.utilization, lending_apr: bank.lending_apr, borrowing_apr: bank.borrowing_apr } };
}
export async function getAccounts(db: Db): Promise<AccountView[]> {
  const state = await readState(db), views = poolView(state).banks;
  const banks = Object.fromEntries(views.map(b => [b.address, b]));
  // 健康度按程序的方式取价:开仓/维持各用一套带置信区间的价格。没有有效价格的银行为 null。
  const prices = (mode: 'init' | 'maint') => Object.fromEntries(views.map(b => {
    const feed = bankFeed(state.banks[b.address], state);
    return [b.address, b.price !== null && feed ? riskPrice(feed, mode) : null];
  }));
  return Object.entries(state.users).map(([address, user]) => {
    const amounts: HealthBalance[] = user.lending_account.balances.filter(p => p.active).map(p => {
      const bank = state.banks[p.bank_pk];
      if (!bank)
        throw new Error('missing bank snapshot for account');
      return { bank: p.bank_pk, deposit: shareQuantity(p.asset_shares, bank.asset_share_value), borrow: shareQuantity(p.liability_shares, bank.liability_share_value) };
    });
    const balances = amounts.map(a => {
      const b = banks[a.bank];
      return { bank: a.bank, label: b.label, deposit: String(floor(quantity(a.deposit))), borrow: String(floor(quantity(a.borrow))),
        deposit_usd: usd(a.deposit, b.decimals, b.price), borrow_usd: usd(a.borrow, b.decimals, b.price) };
    });
    const init = health(amounts, banks, prices('init'), 'init'), maint = health(amounts, banks, prices('maint'), 'maint');
    const sum = (field: 'deposit_usd' | 'borrow_usd') => balances.some(b => b[field] === null) ? null : balances.reduce((n, b) => n + b[field]!, 0);
    // 用精确债务而非向下取整显示判断。有债务但缺价格时健康度为 null，状态是 unknown：
    // 既不能说健康，也不能说可清算(没有价格就没有清算资格的证据)。
    const debt = amounts.some(a => quantity(a.borrow).numerator > 0n);
    return { address, label: label(state.labels, address), authority: user.authority, balances,
      health: { init, maint, assets_usd: sum('deposit_usd'), liabilities_usd: sum('borrow_usd') },
      status: !debt ? 'no_debt' : maint === null ? 'unknown' : maint >= 0 ? 'healthy' : 'liquidatable' };
  });
}
export { getActivity } from './activity';
export { getXray } from './xray';
