/** INPUT: 当前银行、池子、钱包、利率/历史与活动回调。 OUTPUT: 资产详情和操作入口。 POSITION: 市场资产页组合视图。 SYNC: 同步 folder.md。 */
import { lazy, Suspense, useState } from 'react';
import { ChunkBoundary } from '../ChunkBoundary';
import type { BankHistoryView, BankView, RateCurveView } from '@contract';
import { fmtPct, fmtTime, fmtUsd } from '../format';
import { SourceChip, TokenIcon, tokenMeta } from '../tokens';
import type { AccountView, SendResponse, WalletView } from '@contract';
import { ActionForm } from '../wallet/ActionForm';
import { marketActionFromHash } from '../Tabs';
import { BankActivity } from './BankActivity';
import { errorText, useT } from '../i18n';

// 图表(Recharts)只在资产页用到，懒加载：首页不必先下载它(打包 gzip 约 +107 kB)。
const BankHistory = lazy(() => import('./BankHistory').then(m => ({ default: m.BankHistory })));
const RateCurve = lazy(() => import('../RateCurve').then(m => ({ default: m.RateCurve })));

export function AssetPage({ bank, banks, mine, wallet, curve, history, historyError, onTransaction, onOpenTx, onResult, syncStatus }: {
  bank: BankView; banks: BankView[]; mine: AccountView | null; wallet: WalletView | null; curve: RateCurveView | null; history: BankHistoryView | null; historyError: unknown; onTransaction: () => void; onOpenTx: (signature: string) => void;
  onResult: (result: SendResponse) => void;
  syncStatus?: string | null;
}) {
  const { t, locale } = useT();
  const [activityVersion, setActivityVersion] = useState(0);
  const transactionConfirmed = () => { setActivityVersion((version) => version + 1); onTransaction(); };
  const meta = tokenMeta(bank.label, t);
  const chunkFallback = <p className="muted">{t.chartLoadFailed} <button className="linkish" onClick={() => location.reload()}>{t.reload}</button></p>;
  return (
    <div className="asset-page">
      <a className="asset-back" href="#pool">{t.backToMarkets}</a>
      <header className="card asset-summary">
        <div className="asset-head">
          <TokenIcon symbol={bank.label} size={44} />
          <div><div className="asset-title">{bank.label} <SourceChip source={bank.oracle_source} /></div><div className="muted">{meta.name}</div></div>
          <div className="asset-price"><div className="stat">{fmtUsd(bank.price)}</div><div className="muted">{bank.price_updated_at ? t.updatedAt(fmtTime(bank.price_updated_at, locale)) : t.noPriceSnapshot}</div></div>
        </div>
        <div className="asset-kpis">
          <div><span className="label">{t.supplyApr}</span><b className="apr-supply">{fmtPct(bank.lending_apr, 2)}</b></div>
          <div><span className="label">{t.borrowApr}</span><b className="apr-borrow">{fmtPct(bank.borrowing_apr, 2)}</b></div>
          <div><span className="label">{t.totalSupplied}</span><b>{fmtUsd(bank.total_deposits_usd)}</b></div>
          <div><span className="label">{t.utilization}</span><b>{fmtPct(bank.utilization)}</b></div>
        </div>
      </header>
      <div className="asset-layout">
        <main className="asset-main">
          <section className="card"><h2>{t.parameters}</h2><table className="params"><tbody>
            <tr><td className="muted">{t.collateralRatio}</td><td className="n">{fmtPct(bank.weights.asset_init, 0)}</td></tr>
            <tr><td className="muted">{t.liquidationThreshold}</td><td className="n">{fmtPct(bank.weights.asset_maint, 0)}</td></tr>
            <tr><td className="muted">{t.borrowWeight}</td><td className="n">{fmtPct(bank.weights.liability_init, 0)}</td></tr>
          </tbody></table></section>
          {history ? <ChunkBoundary fallback={chunkFallback}><Suspense fallback={<section className="card"><h2>{t.history}</h2><p className="muted">{t.historyReadLoading}</p></section>}><BankHistory history={history} decimals={bank.decimals} symbol={bank.label} /></Suspense></ChunkBoundary> : <section className="card"><h2>{t.history}</h2><p className="muted">{historyError ? t.historyReadFailed(errorText(historyError, t)) : t.historyReadLoading}</p></section>}
          <section className="card"><h2>{t.rateModel}</h2>
            {curve ? <ChunkBoundary fallback={chunkFallback}><Suspense fallback={<div className="muted">{t.rateReadLoading}</div>}><RateCurve curve={curve} optimalUtilization={bank.curve.optimal_utilization} /></Suspense></ChunkBoundary> : <div className="muted">{t.rateReadLoading}</div>}
          </section>
          <section className="card"><h2>{t.about(bank.label)}</h2><p className="asset-desc">{meta.description}</p></section>
          <BankActivity bank={bank} banks={banks} refreshVersion={activityVersion} onOpen={onOpenTx} />
        </main>
        <aside className="asset-action-placeholder"><ActionForm banks={banks} bank={bank} mine={mine} wallet={wallet} initialAction={marketActionFromHash()} onTransaction={transactionConfirmed} onResult={onResult} syncStatus={syncStatus} /></aside>
      </div>
    </div>
  );
}
