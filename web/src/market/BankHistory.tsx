/** INPUT: 银行变化点 API。 OUTPUT: 可切换指标的阶梯历史图。 POSITION: 资产页历史数据可视化。 SYNC: 同步 market folder.md。 */
import { useState } from 'react';
import type { BankHistoryView } from '@contract';
import { fmtPct, fmtTime, fmtUsd } from '../format';

type Mode = 'utilization' | 'apr' | 'total';
const W = 560, H = 230, M = { l: 52, r: 16, t: 12, b: 34 };
const SERIES = {
  utilization: [{ name: '利用率', color: 'var(--s1)', value: (p: BankHistoryView['points'][number]) => p.utilization }],
  apr: [{ name: '借款 APR', color: 'var(--s1)', value: (p: BankHistoryView['points'][number]) => p.borrowing_apr },
    { name: '存款 APR', color: 'var(--s2)', value: (p: BankHistoryView['points'][number]) => p.lending_apr }],
  total: [{ name: '总存款', color: 'var(--s1)', value: (p: BankHistoryView['points'][number]) => p.total_deposits_usd },
    { name: '总借款', color: 'var(--s2)', value: (p: BankHistoryView['points'][number]) => p.total_borrows_usd }],
};
const labels: Record<Mode, string> = { utilization: '利用率', apr: 'APR', total: '总量' };

const niceTop = (value: number, cap: number) => {
  if (!(value > 0)) return Math.min(0.01, cap);
  const step = 10 ** Math.floor(Math.log10(value)), nice = [1, 2, 5, 10].map(m => m * step).find(n => n >= value)!;
  return Math.min(nice, cap);
};

export function BankHistory({ history }: { history: BankHistoryView }) {
  const [mode, setMode] = useState<Mode>('utilization'), points = history.points;
  const series = SERIES[mode], values = series.flatMap(s => points.map(s.value).filter((v): v is number => typeof v === 'number' && Number.isFinite(v)));
  const firstSlot = BigInt(points[0]?.slot ?? '0'), lastSlot = BigInt(points.at(-1)?.slot ?? '0');
  // 纵轴按数据取整到"好读"的上限：测试池利用率常年 1–2%,固定画到 100% 会让整条线贴在 0 上。
  const top = niceTop(Math.max(...values, 0) * 1.2, mode === 'utilization' ? 1 : Infinity), x = (i: number) => {
    const span = Number(lastSlot - firstSlot), position = span > 0 ? Number(BigInt(points[i].slot) - firstSlot) / span : i / Math.max(points.length - 1, 1);
    return M.l + position * (W - M.l - M.r);
  };
  const y = (v: number) => M.t + (1 - v / top) * (H - M.t - M.b);
  const path = (pick: (p: BankHistoryView['points'][number]) => number | null) => {
    let d = '', prev: number | null = null;
    points.forEach((point, i) => { const value = pick(point); if (value == null || !Number.isFinite(value)) { prev = null; return; }
      d += prev == null ? `M${x(i)} ${y(value)}` : `H${x(i)}V${y(value)}`; prev = value;
    });
    return d;
  };
  const fmt = (value: number) => mode === 'utilization' || mode === 'apr' ? fmtPct(value) : fmtUsd(value);
  return <section className="card bank-history"><h2>历史曲线</h2>
    <div className="seg" role="group" aria-label="历史曲线指标">{(Object.keys(labels) as Mode[]).map(key =>
      <button key={key} className={mode === key ? 'on' : ''} aria-pressed={mode === key} onClick={() => setMode(key)}>{labels[key]}</button>)}</div>
    {!points.length ? <p className="muted">还没有银行状态历史。</p>
      : points.length === 1 ? <p className="muted">目前只有 1 个状态记录（slot {points[0].slot}{points[0].block_time ? ` · ${fmtTime(points[0].block_time)}` : ''}），后续状态变化后会形成曲线。</p>
        : mode === 'total' && values.length === 0 ? <p className="muted">这些历史时刻没有可用的价格快照，暂时无法显示美元总量。</p>
          : <><div className="history-legend">{series.map(item => <span key={item.name}><i style={{ background: item.color }} />{item.name}</span>)}</div>
            <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${history.label}历史${labels[mode]}阶梯曲线`}>
              {[0, .5, 1].map(r => <g key={r}><line className="grid-line" x1={M.l} x2={W - M.r} y1={y(top * r)} y2={y(top * r)} />
                <text x={M.l - 7} y={y(top * r) + 4} textAnchor="end">{fmt(top * r)}</text></g>)}
              {series.map(item => <path key={item.name} d={path(item.value)} fill="none" stroke={item.color} strokeWidth="2" strokeLinejoin="round" />)}
              <text x={M.l} y={H - 8}>{points[0].block_time ? fmtTime(points[0].block_time) : `slot ${points[0].slot}`}</text>
              <text x={W - M.r} y={H - 8} textAnchor="end">{points.at(-1)!.block_time ? fmtTime(points.at(-1)!.block_time!) : `slot ${points.at(-1)!.slot}`}</text>
            </svg><div className="muted history-note">阶梯表示状态在相邻交易间保持不变；数据点 {points.length} 个</div></>}
  </section>;
}
