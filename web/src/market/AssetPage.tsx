/** INPUT: 当前银行、池子、钱包、利率/历史与活动回调。 OUTPUT: 资产详情和操作入口。 POSITION: 市场资产页组合视图。 SYNC: 同步 folder.md。 */
import { useState } from 'react';
import type { BankHistoryView, BankView, RateCurveView } from '@contract';
import { fmtPct, fmtTime, fmtToken, fmtUsd, fmtWeight, short } from '../format';
import { RateCurve } from '../RateCurve';
import { SourceChip, TokenIcon, tokenMeta } from '../tokens';
import type { AccountView, SendResponse, WalletView } from '@contract';
import { ActionForm } from '../wallet/ActionForm';
import { marketActionFromHash } from '../Tabs';
import { BankActivity } from './BankActivity';
import { BankHistory } from './BankHistory';

export function AssetPage({ bank, banks, mine, wallet, curve, history, historyError, onTransaction, onOpenTx, onResult }: {
  bank: BankView; banks: BankView[]; mine: AccountView | null; wallet: WalletView | null; curve: RateCurveView | null; history: BankHistoryView | null; historyError: string | null; onTransaction: () => void; onOpenTx: (signature: string) => void;
  onResult: (result: SendResponse) => void;
}) {
  const [activityVersion, setActivityVersion] = useState(0);
  const transactionConfirmed = () => { setActivityVersion((version) => version + 1); onTransaction(); };
  const meta = tokenMeta(bank.label);
  const liquidity = (BigInt(bank.total_deposits) - BigInt(bank.total_borrows)).toString();
  const row = (label: string, value: string, hint?: string) => <tr title={hint}><td className="muted">{label}</td><td className="n">{value}</td></tr>;
  return (
    <div className="asset-page">
      <a className="asset-back" href="#pool">← 返回市场</a>
      <header className="card asset-summary">
        <div className="asset-head">
          <TokenIcon symbol={bank.label} size={44} />
          <div><div className="asset-title">{bank.label} <SourceChip source={bank.oracle_source} /></div><div className="muted">{meta.name}</div></div>
          <div className="asset-price"><div className="stat">{fmtUsd(bank.price)}</div><div className="muted">{bank.price_updated_at ? `更新于 ${fmtTime(bank.price_updated_at)}` : '没有价格快照'}</div></div>
        </div>
        <div className="asset-kpis">
          <div><span className="label">可借流动性</span><b>{fmtUsd((bank.total_deposits_usd ?? 0) - (bank.total_borrows_usd ?? 0))}</b></div>
          <div><span className="label">利用率</span><b>{fmtPct(bank.utilization)}</b></div>
          <div><span className="label">借款 APR</span><b>{fmtPct(bank.borrowing_apr, 2)}</b></div>
        </div>
      </header>
      <div className="asset-layout">
        <main className="asset-main">
          <section className="card"><h2>资产状况</h2><div className="asset-status">
            <div><span className="label">存款 APR</span><b className="good-text">{fmtPct(bank.lending_apr, 2)}</b><span className="muted">总存款 {fmtToken(bank.total_deposits, bank.decimals, 2)} {bank.label} · {fmtUsd(bank.total_deposits_usd)}</span></div>
            <div><span className="label">借款 APR</span><b>{fmtPct(bank.borrowing_apr, 2)}</b><span className="muted">总借款 {fmtToken(bank.total_borrows, bank.decimals, 2)} {bank.label} · 可借 {fmtToken(liquidity, bank.decimals, 2)} {bank.label}</span></div>
          </div><table className="params"><tbody>
            {row('抵押权重 · 开仓', fmtWeight(bank.weights.asset_init), '存款计入开仓健康度时乘的系数')}
            {row('抵押权重 · 维持', fmtWeight(bank.weights.asset_maint), '存款计入维持健康度时乘的系数')}
            {row('债务权重 · 开仓', fmtWeight(bank.weights.liability_init), '借款计入开仓健康度时乘的系数')}
            {row('债务权重 · 维持', fmtWeight(bank.weights.liability_maint), '借款计入维持健康度时乘的系数')}
            {row('价格账户', bank.oracle_feed ? short(bank.oracle_feed) : '—')}
          </tbody></table></section>
          {history ? <BankHistory history={history} /> : <section className="card"><h2>历史曲线</h2><p className="muted">{historyError ? `读取历史失败：${historyError}，正在重试…` : '正在读取历史数据…'}</p></section>}
          <section className="card"><h2>利率模型 <small>最优利用率 {fmtPct(bank.curve.optimal_utilization, 0)}</small></h2>
            {curve ? <RateCurve curve={curve} optimalUtilization={bank.curve.optimal_utilization} /> : <div className="muted">正在读取利率曲线…</div>}
          </section>
          <section className="card"><h2>关于 {bank.label}</h2><p className="asset-desc">{meta.description}</p></section>
          <BankActivity bank={bank} banks={banks} refreshVersion={activityVersion} onOpen={onOpenTx} />
        </main>
        <aside className="asset-action-placeholder"><ActionForm banks={banks} bank={bank} mine={mine} wallet={wallet} initialAction={marketActionFromHash()} onTransaction={transactionConfirmed} onResult={onResult} /></aside>
      </div>
    </div>
  );
}
