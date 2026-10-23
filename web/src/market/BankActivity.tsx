/** INPUT: bank、银行目录、分页活动与清算 API。 OUTPUT: 资产流水和专用清算表。 POSITION: 市场详情数据区块。 SYNC: 同步 market folder.md。 */
import { useEffect, useState } from 'react';
import type { ActivityItem, BankView, LiquidationItem } from '@contract';
import { api } from '../api';
import { fmtToken, short } from '../format';
import { ixLabel } from '../instructions';

function compactTime(value: string | null) {
  if (!value) return '—';
  const d = new Date(value);
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function timeTitle(value: string | null, slot: string) { return `${value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '时间未知'}，slot ${slot}`; }
function nativeFloat(value: number, decimals: number) {
  return (value / 10 ** decimals).toLocaleString('en-US', { maximumFractionDigits: 4 });
}

function ActivityRows({ items, bank, onOpen }: { items: ActivityItem[]; bank: BankView; onOpen: (signature: string) => void }) {
  return <div className="tablewrap asset-tablewrap"><table className="activity asset-compact-table">
    <thead><tr><th>时间</th><th>操作</th><th>账户</th><th className="n">数量</th><th>结果</th><th /></tr></thead>
    <tbody>{items.map((item) => { const ix = ixLabel(item.instruction); return <tr key={`${item.signature}:${item.ix_index}`} className="pick" tabIndex={0}
      onClick={() => onOpen(item.signature)} onKeyDown={(e) => e.key === 'Enter' && onOpen(item.signature)}>
      <td className="muted" title={timeTitle(item.block_time, item.slot)}>{compactTime(item.block_time)}</td>
      <td><span className={`ix ${ix.kind}`}>{ix.label}</span></td>
      <td>{item.account_label ?? <span className="mono">{short(item.account)}</span>}</td>
      <td className="n">{item.amount != null ? `${fmtToken(item.amount, bank.decimals)} ${bank.label}` : <span className="muted">—</span>}</td>
      <td><span className={`chip ${item.ok ? 'ok' : 'bad'}`}>{item.ok ? '成功' : '失败'}</span></td>
      <td className="go">拆解 ›</td>
    </tr>; })}</tbody>
  </table></div>;
}

function LiquidationRows({ rows, banks, onOpen }: { rows: LiquidationItem[]; banks: BankView[]; onOpen: (signature: string) => void }) {
  const byAddress = new Map(banks.map((b) => [b.address, b]));
  return <div className="tablewrap asset-tablewrap"><table className="activity asset-compact-table liquidation-table">
    <thead><tr><th>时间</th><th>被清算账户</th><th>没收抵押</th><th>偿还债务</th><th>健康度 (USD) 前 → 后</th><th /></tr></thead>
    <tbody>{rows.map((row) => {
      const asset = byAddress.get(row.asset_bank), liability = byAddress.get(row.liability_bank);
      return <tr key={`${row.signature}:${row.ix_index}`} className="pick" tabIndex={0}
        onClick={() => onOpen(row.signature)} onKeyDown={(e) => e.key === 'Enter' && onOpen(row.signature)}>
        <td className="muted" title={timeTitle(row.block_time, row.slot)}>{compactTime(row.block_time)}</td>
        <td>{row.liquidatee_label ?? <span className="mono">{short(row.liquidatee_account)}</span>}</td>
        <td>{nativeFloat(row.seized_asset, asset?.decimals ?? 0)} {asset?.label ?? row.asset_label ?? short(row.asset_bank)}</td>
        <td>{nativeFloat(row.repaid_liability, liability?.decimals ?? 0)} {liability?.label ?? row.liability_label ?? short(row.liability_bank)}</td>
        <td className="n">{row.pre_health.toFixed(2)} → {row.post_health.toFixed(2)}</td>
        <td className="go">拆解 ›</td>
      </tr>;
    })}</tbody>
  </table></div>;
}

export function BankActivity({ bank, banks, refreshVersion, onOpen }: { bank: BankView; banks: BankView[]; refreshVersion: number; onOpen: (signature: string) => void }) {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [liquidations, setLiquidations] = useState<LiquidationItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryVersion, setRetryVersion] = useState(0);
  useEffect(() => {
    let active = true;
    setItems([]); setCursor(null); setError(null); setLoading(true);
    Promise.all([api.activity(undefined, bank.address, 10), api.liquidations(bank.address)]).then(([page, liquidations]) => {
      if (active) { setItems(page.items.filter((item) => item.instruction !== 'lending_account_liquidate')); setCursor(page.next_before); setLiquidations(liquidations); }
    }).catch((e: unknown) => { if (active) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [bank.address, refreshVersion, retryVersion]);
  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setRetryVersion((version) => version + 1), 5000);
    return () => window.clearTimeout(timer);
  }, [error]);
  const loadMore = async () => {
    if (!cursor) return;
    setLoading(true);
    try { const page = await api.activity(cursor, bank.address, 10); setItems((current) => [...current, ...page.items.filter((item) => item.instruction !== 'lending_account_liquidate')]); setCursor(page.next_before); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  };
  return <div className="asset-activity">
    {error && <div className="err">读取活动失败：{error}</div>}
    <section className="card"><h2>{bank.label} 交易流水</h2>
      {items.length ? <ActivityRows items={items} bank={bank} onOpen={onOpen} /> : <p className="muted">{loading ? '正在读取…' : '还没有这项资产的交易。'}</p>}
      {cursor && <p className="activity-more"><button className="btn sm" disabled={loading} onClick={loadMore}>{loading ? '读取中…' : '加载更多'}</button></p>}
    </section>
    <section className="card"><h2>{bank.label} 清算记录</h2>
      {liquidations.length ? <LiquidationRows rows={liquidations} banks={banks} onOpen={onOpen} /> : <p className="muted">{loading ? '正在读取…' : '还没有涉及这项资产的清算。'}</p>}
    </section>
  </div>;
}
