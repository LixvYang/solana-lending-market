import { useState } from 'react';
import type { ActivityItem, PoolView } from '@contract';
import { api } from './api';
import { fmtTime, fmtToken, short } from './format';
import { ixLabel } from './instructions';
import { TokenIcon } from './tokens';
import { useT } from './i18n';

function compactTime(value: string | null) {
  if (!value) return '—';
  const time = new Date(value);
  return `${String(time.getMonth() + 1).padStart(2, '0')}/${String(time.getDate()).padStart(2, '0')} ${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`;
}

export function Activity({ first, next, pool, onOpen }: { first: ActivityItem[]; next: string | null; pool: PoolView; onOpen: (signature: string) => void }) {
  const { t, locale } = useT();
  const [more, setMore] = useState<ActivityItem[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const decimals = Object.fromEntries(pool.banks.map((b) => [b.address, b.decimals]));
  const seen = new Set<string>();
  const rows = [...first, ...more].filter((i) => { const k = `${i.signature}:${i.ix_index}`; return seen.has(k) ? false : (seen.add(k), true); });
  const before = cursor === undefined ? next : cursor;
  const load = async () => { if (!before) return; const page = await api.activity(before); setMore((m) => [...m, ...page.items]); setCursor(page.next_before); };
  return (
    <div className="card">
      <h2>{t.explorerActivity}</h2>
      <div className="tablewrap"><table className="activity activity-compact-table">
        <thead><tr><th>{t.time}</th><th>{t.operation}</th><th>{t.account}</th><th>{t.token}</th><th className="n">{t.amount}</th><th>{t.result}</th><th /></tr></thead>
        <tbody>{rows.map((i) => { const ix = ixLabel(i.instruction, t); return (
          <tr key={`${i.signature}:${i.ix_index}`} className="pick" tabIndex={0} onClick={() => onOpen(i.signature)} onKeyDown={(e) => e.key === 'Enter' && onOpen(i.signature)}>
            <td className="muted" title={t.timeSlot(i.block_time ? fmtTime(i.block_time, locale) : '', i.slot)}>{compactTime(i.block_time)}</td>
            <td><span className={`ix ${ix.kind}`}>{ix.label}</span></td>
            <td>{i.account_label ?? <span className="mono">{short(i.account)}</span>}</td>
            <td>{i.bank_label ? <span className="amt"><TokenIcon symbol={i.bank_label} size={18} />{i.bank_label}</span> : <span className="muted">{i.bank ? short(i.bank) : '—'}</span>}</td>
            <td className="n">{i.amount != null && i.bank ? fmtToken(i.amount, decimals[i.bank] ?? 0) : <span className="muted">—</span>}</td>
            <td><span className={`chip ${i.ok ? 'ok' : 'bad'}`}>{i.ok ? t.success : t.failed}</span></td>
            <td className="go" aria-hidden>{t.breakdown}</td>
          </tr>); })}</tbody>
      </table></div>
      {rows.length === 0 && <p className="muted">{t.noActivity}</p>}
      {before && <p style={{ textAlign: 'center' }}><button className="btn sm" onClick={load}>{t.loadMore}</button></p>}
    </div>
  );
}
