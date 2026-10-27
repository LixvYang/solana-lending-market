import { useState } from 'react';
import type { AccountView, PoolView } from '@contract';
import { fmtToken, fmtUsd, short } from './format';
import { TokenIcon } from './tokens';
import { riskMetrics } from './risk';
import { explorerAccounts, explorerSummary } from './explorer';
import { useT } from './i18n';

type RiskStatus = 'no_debt' | 'healthy' | 'risk' | 'danger' | 'liquidatable' | 'unknown';
const ICON = {
  no_debt: <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="6" cy="6" r="4.5" /><path d="M3.5 6h5" /></svg>,
  healthy: <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 6.5l2.5 2.5 4.5-5.5" /></svg>,
  risk: <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M6 1.8l4.6 8H1.4z" /><path d="M6 5v2.2M6 8.8v.1" /></svg>,
  unknown: <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="6" cy="6" r="4.5" /><path d="M4.8 4.8a1.3 1.3 0 112 1.1c-.5.3-.8.6-.8 1.2M6 8.7v.1" /></svg>,
};

function riskStatus(percent: number | null, debt: boolean): RiskStatus {
  if (!debt) return 'no_debt';
  if (percent === null) return 'unknown';
  // 只有健康度 ≤ 0 才真的能被清算;0–10% 是高风险，但还不能清算，不能标成"可清算"。
  if (percent <= 0) return 'liquidatable';
  if (percent < 10) return 'danger';
  if (percent < 30) return 'risk';
  return 'healthy';
}

function StatusBadge({ status }: { status: RiskStatus }) {
  const { t } = useT();
  const text: Record<RiskStatus, string> = { no_debt: t.noDebt, healthy: t.healthy, risk: t.risk, danger: t.highRisk, liquidatable: t.liquidatable, unknown: t.missingPrice };
  const icon = status === 'liquidatable' || status === 'danger' || status === 'risk' ? ICON.risk : status === 'no_debt' ? ICON.no_debt : status === 'healthy' ? ICON.healthy : ICON.unknown;
  return <span className={`badge ${status}`}>{icon}{text[status]}</span>;
}

// API 没有标签时会用缩写地址填 label;这种"标签"只是地址本身，不能当名字再显示一遍。
const named = (a: AccountView) => Boolean(a.label) && a.label !== `${a.address.slice(0, 4)}…${a.address.slice(-4)}`;

/** 链上数据页顶部概览(参考 Solscan 的 Overview 卡),放在活动表之前。 */
export function ExplorerOverview({ accounts, pool }: { accounts: AccountView[]; pool: PoolView }) {
  const { t } = useT();
  const summary = explorerSummary(accounts, pool.banks);
  return <div className="grid kpis explorer-kpis">
      <div className="card"><div className="label">{t.accountsWithPosition}</div><div className="stat">{summary.positions}</div></div>
      <div className="card"><div className="label">{t.debtAccounts}</div><div className="stat">{summary.debtAccounts}</div></div>
      <div className="card"><div className="label">{t.totalDebt}</div><div className="stat">{fmtUsd(summary.debtUsd)}</div></div>
      <div className="card"><div className="label">{t.lowestHealth}</div><div className="stat">{summary.lowest ? `${summary.lowest.health.toFixed(1)}%` : '—'}</div>{summary.lowest && <div className="muted">{named(summary.lowest.account) ? summary.lowest.account.label : short(summary.lowest.account.address)}</div>}</div>
    </div>;
}

export function Accounts({ accounts, pool }: { accounts: AccountView[]; pool: PoolView }) {
  const { t } = useT();
  const [showEmpty, setShowEmpty] = useState(false);
  const decimals = Object.fromEntries(pool.banks.map((b) => [b.address, b.decimals]));
  const { active, empty } = explorerAccounts(accounts, pool.banks);
  const list = (items: { bank: string; label: string; amount: string }[]) => items.length
    ? <div className="account-tokens">{items.map((i) => <div key={i.bank} className="amt"><TokenIcon symbol={i.label} size={16} />{fmtToken(i.amount, decimals[i.bank] ?? 0, 4)} <span className="muted">{i.label}</span></div>)}</div>
    : <span className="muted">—</span>;
  const row = (a: AccountView) => {
    const metrics = riskMetrics(pool.banks, a.balances);
    const healthPercent = metrics.healthPercent;
    const debt = a.balances.some(b => b.borrow !== '0');
    const status = riskStatus(healthPercent, debt);
    const tone = status === 'liquidatable' || status === 'danger' ? 'crit' : status === 'risk' ? 'warn' : status === 'healthy' ? 'good' : '';
    const fill = healthPercent == null ? 0 : Math.max(0, Math.min(100, 100 - healthPercent));
    return <tr key={a.address}>
      <td>{named(a) ? <><b>{a.label}</b><div className="muted mono">{short(a.address)}</div></> : <span className="mono">{short(a.address)}</span>}</td>
      <td>{list(a.balances.filter((b) => b.deposit !== '0').map((b) => ({ bank: b.bank, label: b.label, amount: b.deposit })))}</td>
      <td>{list(a.balances.filter((b) => b.borrow !== '0').map((b) => ({ bank: b.bank, label: b.label, amount: b.borrow })))}</td>
      <td className={`n health-cell ${tone}`}>{healthPercent == null ? '—' : `${healthPercent.toFixed(1)}%`}<div className={`meter health-meter ${tone}`} role="img" aria-label={healthPercent == null ? t.missingPrice : `${t.healthFactor} ${healthPercent.toFixed(1)}%`}><i style={{ width: `${fill}%` }} /></div></td>
      <td className="n">{fmtUsd(a.health.init)}</td>
      <td><StatusBadge status={status} /></td>
    </tr>;
  };
  return <>
    <div className="card">
      <h2>{t.liquidationMonitor}</h2>
      <div className="tablewrap"><table>
        <thead><tr><th>{t.account}</th><th>{t.deposits}</th><th>{t.borrows}</th><th className="n">{t.healthFactor}</th><th className="n">{t.availableBorrow}</th><th>{t.status}</th></tr></thead>
        <tbody>{active.map(row)}{showEmpty && empty.map(row)}{empty.length > 0 && <tr><td className="empty-accounts" colSpan={6}><button className="linkish muted" type="button" aria-expanded={showEmpty} onClick={() => setShowEmpty(value => !value)}>{t.emptyAccounts(empty.length)}</button></td></tr>}</tbody>
      </table></div>
    </div>
  </>;
}
