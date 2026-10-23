import type { AccountStatus, AccountView, PoolView } from '@contract';
import { fmtToken, fmtUsd, short } from './format';
import { TokenIcon } from './tokens';
import { riskMetrics } from './risk';

const ICON = {
  no_debt: <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="6" cy="6" r="4.5" /><path d="M3.5 6h5" /></svg>,
  healthy: <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 6.5l2.5 2.5 4.5-5.5" /></svg>,
  unknown: <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="6" cy="6" r="4.5" /><path d="M4.8 4.8a1.3 1.3 0 112 1.1c-.5.3-.8.6-.8 1.2M6 8.7v.1" /></svg>,
  liquidatable: <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M6 1.8l4.6 8H1.4z" /><path d="M6 5v2.2M6 8.8v.1" /></svg>,
};
const TEXT: Record<AccountStatus, string> = { no_debt: '无债务', healthy: '健康', liquidatable: '可清算', unknown: '价格缺失' };
// 状态色是保留色，永远配图标 + 文字，不单靠颜色传达。
const KIND: Record<AccountStatus, string> = { no_debt: '', healthy: 'good', liquidatable: 'crit', unknown: '' };

export function StatusBadge({ status }: { status: AccountStatus }) {
  return <span className={`badge ${KIND[status]}`}>{ICON[status]}{TEXT[status]}</span>;
}

export function Accounts({ accounts, pool }: { accounts: AccountView[]; pool: PoolView }) {
  const decimals = Object.fromEntries(pool.banks.map((b) => [b.address, b.decimals]));
  const list = (items: { bank: string; label: string; amount: string }[]) => items.length
    ? items.map((i) => <div key={i.bank} className="amt"><TokenIcon symbol={i.label} size={16} />{fmtToken(i.amount, decimals[i.bank] ?? 0, 4)} <span className="muted">{i.label}</span></div>)
    : <span className="muted">—</span>;
  return (
    <div className="card">
      <h2>清算监控</h2>
      <div className="tablewrap"><table>
        <thead><tr><th>账户</th><th>存款</th><th>借款</th><th className="n">健康度</th><th className="n">可借余量</th><th>状态</th></tr></thead>
        <tbody>{accounts.map((a) => {
          const healthPercent = riskMetrics(pool.banks, a.balances).healthPercent;
          const healthClass = healthPercent == null ? '' : healthPercent <= 0 || healthPercent < 10 ? 'bad-text' : healthPercent < 30 ? 'risk-warn' : 'good-text';
          return <tr key={a.address}>
            <td><b>{a.label}</b><div className="muted mono">{short(a.address)}</div></td>
            <td>{list(a.balances.filter((b) => b.deposit !== '0').map((b) => ({ bank: b.bank, label: b.label, amount: b.deposit })))}</td>
            <td>{list(a.balances.filter((b) => b.borrow !== '0').map((b) => ({ bank: b.bank, label: b.label, amount: b.borrow })))}</td>
            <td className={`n ${healthClass}`}>{healthPercent == null ? '—' : `${healthPercent.toFixed(1)}%${healthPercent <= 0 ? ' 可清算' : ''}`}</td>
            <td className="n">{fmtUsd(a.health.init)}</td>
            <td><StatusBadge status={a.status} /></td>
          </tr>;
        })}</tbody>
      </table></div>
    </div>
  );
}
