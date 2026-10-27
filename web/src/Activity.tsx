import { useEffect, useState } from 'react';
import type { ActivityItem, ActivityPage, PoolView } from '@contract';
import { api } from './api';
import { fmtTime, fmtToken, fmtUsd, short } from './format';
import { ixLabel } from './instructions';
import { TokenIcon } from './tokens';
import { useT } from './i18n';
import { relativeTime } from './explorer';

type ActivityKind = 'all' | 'supply' | 'borrow' | 'liquidate';

function estimatedUsd(item: ActivityItem, pool: PoolView, decimals: Record<string, number>) {
  if (item.amount == null || item.bank == null) return null;
  const bank = pool.banks.find(value => value.address === item.bank);
  return bank?.price == null ? null : Number(item.amount) / 10 ** (decimals[item.bank] ?? 0) * bank.price;
}

export function Activity({ first, next, pool, onOpen }: { first: ActivityItem[]; next: string | null; pool: PoolView; onOpen: (signature: string) => void }) {
  const { t, locale } = useT();
  const [kind, setKind] = useState<ActivityKind>('all');
  const [filtered, setFiltered] = useState<ActivityPage | null>(null);
  const [more, setMore] = useState<ActivityItem[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (kind === 'all') { setFiltered(null); return; }
    let active = true;
    setFiltered(null);
    void api.activity(undefined, undefined, 20, kind).then(page => { if (active) setFiltered(page); });
    return () => { active = false; };
  }, [kind]);
  const decimals = Object.fromEntries(pool.banks.map((b) => [b.address, b.decimals]));
  const initial = kind === 'all' ? first : filtered?.items ?? [];
  const firstCursor = kind === 'all' ? next : filtered?.next_before ?? null;
  const seen = new Set<string>();
  const rows = [...initial, ...more].filter((i) => { const k = `${i.signature}:${i.ix_index}`; return seen.has(k) ? false : (seen.add(k), true); });
  const before = cursor === undefined ? firstCursor : cursor;
  const load = async () => { if (!before) return; const page = await api.activity(before, undefined, 20, kind === 'all' ? undefined : kind); setMore((m) => [...m, ...page.items]); setCursor(page.next_before); };
  const changeKind = (nextKind: ActivityKind) => { setKind(nextKind); setMore([]); setCursor(undefined); setFiltered(null); };
  const filters: [ActivityKind, string][] = [['all', t.allActivity], ['supply', t.supplyActivity], ['borrow', t.borrowActivity], ['liquidate', t.liquidateActivity]];
  return (
    <div className="card">
      <h2>{t.explorerActivity}</h2>
      <div className="seg activity-filters" role="group" aria-label={t.explorerActivity}>{filters.map(([value, label]) =>
        <button key={value} type="button" className={kind === value ? 'on' : ''} aria-pressed={kind === value} onClick={() => changeKind(value)}>{label}</button>)}</div>
      <div className="tablewrap"><table className="activity activity-compact-table">
        <thead><tr><th>{t.time}</th><th>{t.operation}</th><th>{t.account}</th><th>{t.token}</th><th className="n">{t.amount}</th><th /></tr></thead>
        <tbody>{rows.map((i) => { const ix = ixLabel(i.instruction, t), usd = estimatedUsd(i, pool, decimals); return (
          <tr key={`${i.signature}:${i.ix_index}`} className="pick" tabIndex={0} onClick={() => onOpen(i.signature)} onKeyDown={(e) => e.key === 'Enter' && onOpen(i.signature)}>
            <td className="muted" title={i.block_time ? fmtTime(i.block_time, locale) : undefined}>{relativeTime(i.block_time, Date.now(), locale, t)}</td>
            <td><span className={`ix ${ix.kind}`}>{ix.label}</span>{!i.ok && <span className="chip failed-result">{t.failed}</span>}</td>
            <td>{i.account_label ? <><b>{i.account_label}</b><div className="muted mono">{short(i.account)}</div></> : <span className="mono">{short(i.account)}</span>}</td>
            <td>{i.bank_label ? <span className="amt"><TokenIcon symbol={i.bank_label} size={18} />{i.bank_label}</span> : <span className="muted">{i.bank ? short(i.bank) : '—'}</span>}</td>
            <td className="n">{i.amount != null && i.bank ? <span className="activity-amount"><span>{fmtToken(i.amount, decimals[i.bank] ?? 0)}</span>{usd !== null && <span className="muted">≈ {fmtUsd(usd)}</span>}</span> : <span className="muted">—</span>}</td>
            <td className="go" aria-hidden>{t.breakdown}</td>
          </tr>); })}</tbody>
      </table></div>
      {rows.length === 0 && <p className="muted">{kind === 'all' ? t.noActivity : t.noFilteredActivity}</p>}
      {before && <p style={{ textAlign: 'center' }}><button className="btn sm" onClick={load}>{t.loadMore}</button></p>}
    </div>
  );
}
