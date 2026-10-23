import { useEffect, useState } from 'react';
import type { WalletHistoryItem, WalletHistoryPage } from '@contract';
import { api } from '../api';
import { fmtToken } from '../format';
import { TokenIcon } from '../tokens';
import { explorer } from './chain';

const names: Record<WalletHistoryItem['kind'], string> = {
  deposit: '存入', borrow: '借出', repay: '还款', withdraw: '取出', liquidated: '被清算',
  liquidator: '清算', swap: '兑换', faucet: '领取',
};
const timeText = (time: string | null) => time ? new Date(time).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

export function WalletHistory({ wallet, reload, onOpenTx }: { wallet: string; reload: number; onOpenTx: (signature: string) => void }) {
  const [page, setPage] = useState<WalletHistoryPage | null>(null), [error, setError] = useState<string | null>(null), [loading, setLoading] = useState(false);
  useEffect(() => {
    let active = true;
    setPage(null); setLoading(true); setError(null);
    void api.walletHistory(wallet).then((next) => { if (active) setPage(next); })
      .catch((e: unknown) => { if (active) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [wallet, reload]);
  const more = async () => {
    if (!page?.next_before || loading) return;
    setLoading(true); setError(null);
    try {
      const next = await api.walletHistory(wallet, page.next_before);
      setPage({ items: [...page.items, ...next.items], next_before: next.next_before });
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  };
  return <section className="card wallet-history">
    <h2>历史记录</h2>
    {error && <p className="muted" role="status">读取失败，稍后重试</p>}
    {!page && !error && <p className="muted">{loading ? '读取中…' : '还没有记录'}</p>}
    {page?.items.length === 0 && <p className="muted">还没有记录</p>}
    {page && page.items.length > 0 && <div className="wallet-history-list">{page.items.map((item, i) => <div className="wallet-history-row" key={`${item.signature}:${i}`}>
      <time className="muted" dateTime={item.time ?? undefined}>{timeText(item.time)}</time>
      <b>{names[item.kind]}</b>
      <div className="wallet-history-assets">{item.assets.map((asset, n) => <span key={`${asset.symbol}:${n}`}>
        <TokenIcon symbol={asset.symbol} size={16} />{fmtToken(asset.amount, asset.decimals, 4)} {asset.symbol}
        {item.kind === 'swap' && n === 0 && <span className="muted"> → </span>}
      </span>)}</div>
      <span>{item.result}</span>
      {item.detail ? <button className="linkish" onClick={() => onOpenTx(item.signature)}>交易详情</button>
        : <a href={explorer(item.signature)} target="_blank" rel="noreferrer">Explorer ↗</a>}
    </div>)}</div>}
    {page?.next_before && <button className="btn sm" disabled={loading} onClick={() => void more()}>{loading ? '读取中…' : '加载更多'}</button>}
  </section>;
}
