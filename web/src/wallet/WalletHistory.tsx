import { useEffect, useState } from 'react';
import type { WalletHistoryItem, WalletHistoryPage } from '@contract';
import { api } from '../api';
import { fmtToken } from '../format';
import { TokenIcon } from '../tokens';
import { explorer } from './chain';
import { errorText, useT } from '../i18n';

export function WalletHistory({ wallet, reload, onOpenTx }: { wallet: string; reload: number; onOpenTx: (signature: string) => void }) {
  const { t, locale } = useT();
  const names: Record<WalletHistoryItem['kind'], string> = { deposit: t.operationSupply, borrow: t.operationBorrow, repay: t.operationRepay, withdraw: t.operationWithdraw, liquidated: t.operationLiquidated, liquidator: t.operationLiquidator, swap: t.operationSwap, faucet: t.operationFaucet };
  const timeText = (time: string | null) => time ? new Date(time).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '—';
  const [page, setPage] = useState<WalletHistoryPage | null>(null), [error, setError] = useState<string | null>(null), [loading, setLoading] = useState(false);
  useEffect(() => {
    let active = true;
    setPage(null); setLoading(true); setError(null);
    void api.walletHistory(wallet).then((next) => { if (active) setPage(next); })
      .catch((e: unknown) => { if (active) setError(errorText(e, t)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [wallet, reload]);
  const more = async () => {
    if (!page?.next_before || loading) return;
    setLoading(true); setError(null);
    try {
      const next = await api.walletHistory(wallet, page.next_before);
      setPage({ items: [...page.items, ...next.items], next_before: next.next_before });
    } catch (e) { setError(errorText(e, t)); }
    finally { setLoading(false); }
  };
  return <section className="card wallet-history">
    <h2>{t.historyRecords}</h2>
    {error && <p className="muted" role="status">{t.retryLater}</p>}
    {!page && !error && <p className="muted">{loading ? t.loading : t.noRecords}</p>}
    {page?.items.length === 0 && <p className="muted">{t.noRecords}</p>}
    {page && page.items.length > 0 && <div className="wallet-history-list">{page.items.map((item, i) => <div className="wallet-history-row" key={`${item.signature}:${i}`}>
      <time className="muted" dateTime={item.time ?? undefined}>{timeText(item.time)}</time>
      <b>{names[item.kind]}</b>
      <div className="wallet-history-assets">{item.assets.map((asset, n) => <span key={`${asset.symbol}:${n}`}>
        <TokenIcon symbol={asset.symbol} size={16} />{fmtToken(asset.amount, asset.decimals, 4)} {asset.symbol}
        {item.kind === 'swap' && n === 0 && <span className="muted"> → </span>}
      </span>)}</div>
      <span>{item.result === 'success' ? t.success : item.result === 'failed' ? t.failed : item.result}</span>
      {item.detail ? <button className="linkish" onClick={() => onOpenTx(item.signature)}>{t.transactionDetails}</button>
        : <a href={explorer(item.signature)} target="_blank" rel="noreferrer">{t.explorerLink}</a>}
    </div>)}</div>}
    {page?.next_before && <button className="btn sm" disabled={loading} onClick={() => void more()}>{loading ? t.loading : t.loadMore}</button>}
  </section>;
}
