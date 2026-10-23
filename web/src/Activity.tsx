import { useState } from 'react';
import type { ActivityItem, PoolView } from '@contract';
import { api } from './api';
import { fmtTime, fmtToken, short } from './format';
import { ixLabel } from './instructions';
import { TokenIcon } from './tokens';

function compactTime(value: string | null) {
  if (!value) return '—';
  const time = new Date(value);
  return `${String(time.getMonth() + 1).padStart(2, '0')}/${String(time.getDate()).padStart(2, '0')} ${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`;
}

export function Activity({ first, next, pool, onOpen }: { first: ActivityItem[]; next: string | null; pool: PoolView; onOpen: (signature: string) => void }) {
  const [more, setMore] = useState<ActivityItem[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const decimals = Object.fromEntries(pool.banks.map((b) => [b.address, b.decimals]));
  const seen = new Set<string>();
  const rows = [...first, ...more].filter((i) => { const k = `${i.signature}:${i.ix_index}`; return seen.has(k) ? false : (seen.add(k), true); });
  const before = cursor === undefined ? next : cursor;
  const load = async () => { if (!before) return; const page = await api.activity(before); setMore((m) => [...m, ...page.items]); setCursor(page.next_before); };
  return (
    <div className="card">
      <h2>链上活动</h2>
      <div className="tablewrap"><table className="activity activity-compact-table">
        <thead><tr><th>时间</th><th>操作</th><th>账户</th><th>代币</th><th className="n">数量</th><th>结果</th><th /></tr></thead>
        <tbody>{rows.map((i) => { const ix = ixLabel(i.instruction); return (
          <tr key={`${i.signature}:${i.ix_index}`} className="pick" tabIndex={0} onClick={() => onOpen(i.signature)} onKeyDown={(e) => e.key === 'Enter' && onOpen(i.signature)}>
            <td className="muted" title={`${i.block_time ? `${fmtTime(i.block_time)}，` : ''}slot ${i.slot}`}>{compactTime(i.block_time)}</td>
            <td><span className={`ix ${ix.kind}`}>{ix.label}</span></td>
            <td>{i.account_label ?? <span className="mono">{short(i.account)}</span>}</td>
            <td>{i.bank_label ? <span className="amt"><TokenIcon symbol={i.bank_label} size={18} />{i.bank_label}</span> : <span className="muted">{i.bank ? short(i.bank) : '—'}</span>}</td>
            <td className="n">{i.amount != null && i.bank ? fmtToken(i.amount, decimals[i.bank] ?? 0) : <span className="muted">—</span>}</td>
            <td><span className={`chip ${i.ok ? 'ok' : 'bad'}`}>{i.ok ? '成功' : '失败'}</span></td>
            <td className="go" aria-hidden>拆解 ›</td>
          </tr>); })}</tbody>
      </table></div>
      {rows.length === 0 && <p className="muted">还没有活动。进入市场中的资产详情页完成一笔交易，几秒后就会出现在这里。</p>}
      {before && <p style={{ textAlign: 'center' }}><button className="btn sm" onClick={load}>加载更多</button></p>}
    </div>
  );
}
