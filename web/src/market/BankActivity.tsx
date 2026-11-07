/** INPUT: bank、银行目录、分页活动与清算 API。 OUTPUT: 资产流水和专用清算表。 POSITION: 市场详情数据区块。 SYNC: 同步 market folder.md。 */
import { useEffect, useState } from 'react';
import type { ActivityItem, BankView, LiquidationItem } from '@contract';
import { api } from '../api';
import { fmtToken, short } from '../format';
import { ixLabel } from '../instructions';
import { errorText, useT } from '../i18n';

function compactTime(value: string | null) {
  if (!value) return '—';
  const d = new Date(value);
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function timeTitle(value: string | null, slot: string, locale: 'zh' | 'en', t: ReturnType<typeof useT>['t']) { return t.timeSlot(value ? new Date(value).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US', { hour12: false }) : t.unknownTime, slot); }
function nativeFloat(value: number, decimals: number) {
  return (value / 10 ** decimals).toLocaleString('en-US', { maximumFractionDigits: 4 });
}

function ActivityRows({ items, bank, onOpen, t, locale }: { items: ActivityItem[]; bank: BankView; onOpen: (signature: string) => void; t: ReturnType<typeof useT>['t']; locale: 'zh' | 'en' }) {
  return <div className="tablewrap asset-tablewrap"><table className="activity asset-compact-table">
    <thead><tr><th>{t.time}</th><th>{t.operation}</th><th>{t.account}</th><th className="n">{t.amount}</th><th>{t.result}</th><th /></tr></thead>
    <tbody>{items.map((item) => { const ix = ixLabel(item.instruction, t); return <tr key={`${item.signature}:${item.ix_index}`} className="pick" tabIndex={0}
      onClick={() => onOpen(item.signature)} onKeyDown={(e) => e.key === 'Enter' && onOpen(item.signature)}>
      <td className="muted" title={timeTitle(item.block_time, item.slot, locale, t)}>{compactTime(item.block_time)}</td>
      <td><span className={`ix ${ix.kind}`}>{ix.label}</span></td>
      <td>{item.account_label ?? <span className="mono">{short(item.account)}</span>}</td>
      <td className="n">{item.amount != null ? `${fmtToken(item.amount, bank.decimals)} ${bank.label}` : <span className="muted">—</span>}</td>
      <td><span className={`chip ${item.ok ? 'ok' : 'bad'}`}>{item.ok ? t.success : t.failed}</span></td>
      <td className="go">{t.breakdown}</td>
    </tr>; })}</tbody>
  </table></div>;
}

function LiquidationRows({ rows, banks, onOpen, t, locale }: { rows: LiquidationItem[]; banks: BankView[]; onOpen: (signature: string) => void; t: ReturnType<typeof useT>['t']; locale: 'zh' | 'en' }) {
  const byAddress = new Map(banks.map((b) => [b.address, b]));
  return <div className="tablewrap asset-tablewrap"><table className="activity asset-compact-table liquidation-table">
    <thead><tr><th>{t.time}</th><th>{t.liquidatedAccount}</th><th>{t.seizedCollateral}</th><th>{t.repaidDebt}</th><th>{t.healthFactor} (USD) {t.beforeAfter}</th><th /></tr></thead>
    <tbody>{rows.map((row) => {
      const asset = byAddress.get(row.asset_bank), liability = byAddress.get(row.liability_bank);
      return <tr key={`${row.signature}:${row.ix_index}`} className="pick" tabIndex={0}
        onClick={() => onOpen(row.signature)} onKeyDown={(e) => e.key === 'Enter' && onOpen(row.signature)}>
        <td className="muted" title={timeTitle(row.block_time, row.slot, locale, t)}>{compactTime(row.block_time)}</td>
        <td>{row.liquidatee_label ?? <span className="mono">{short(row.liquidatee_account)}</span>}</td>
        <td>{nativeFloat(row.seized_asset, asset?.decimals ?? 0)} {asset?.label ?? row.asset_label ?? short(row.asset_bank)}</td>
        <td>{nativeFloat(row.repaid_liability, liability?.decimals ?? 0)} {liability?.label ?? row.liability_label ?? short(row.liability_bank)}</td>
        <td className="n">{row.pre_health.toFixed(2)} → {row.post_health.toFixed(2)}</td>
        <td className="go">{t.breakdown}</td>
      </tr>;
    })}</tbody>
  </table></div>;
}

export function BankActivity({ bank, banks, refreshVersion, onOpen }: { bank: BankView; banks: BankView[]; refreshVersion: number; onOpen: (signature: string) => void }) {
  const { t, locale } = useT();
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [liquidations, setLiquidations] = useState<LiquidationItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [retryVersion, setRetryVersion] = useState(0);
  useEffect(() => {
    let active = true;
    setItems([]); setCursor(null); setError(null); setLoading(true);
    Promise.all([api.activity(undefined, bank.address, 10), api.liquidations(bank.address)]).then(([page, liquidations]) => {
      if (active) { setItems(page.items.filter((item) => item.instruction !== 'lending_account_liquidate')); setCursor(page.next_before); setLiquidations(liquidations); }
    }).catch((e: unknown) => { if (active) setError(e); })
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
    catch (e) { setError(e); }
    finally { setLoading(false); }
  };
  return <div className="asset-activity">
    {Boolean(error) && <div className="err">{t.readActivityFailed(errorText(error, t))}</div>}
    <section className="card"><h2>{bank.label} {t.bankActivity}</h2>
      {items.length ? <ActivityRows items={items} bank={bank} onOpen={onOpen} t={t} locale={locale} /> : <p className="muted">{loading ? t.readActivity : t.noAssetActivity}</p>}
      {cursor && <p className="activity-more"><button className="btn sm" disabled={loading} onClick={loadMore}>{loading ? t.loading : t.loadMore}</button></p>}
    </section>
    <section className="card"><h2>{bank.label} {t.liquidationHistory}</h2>
      {liquidations.length ? <LiquidationRows rows={liquidations} banks={banks} onOpen={onOpen} t={t} locale={locale} /> : <p className="muted">{loading ? t.readActivity : t.noLiquidations}</p>}
    </section>
  </div>;
}
