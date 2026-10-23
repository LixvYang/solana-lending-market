/** INPUT: 银行变化点 API。 OUTPUT: 可切换指标的阶梯历史图。 POSITION: 资产页历史数据可视化。 SYNC: 同步 market folder.md。 */
import { useRef, useState } from 'react';
import type { BankHistoryView } from '@contract';
import { fmtPct, fmtTime, fmtToken, fmtUsd } from '../format';

type Mode = 'utilization' | 'apr' | 'total';
const W = 560, H = 230, M = { l: 52, r: 16, t: 12, b: 34 };
const SERIES = {
  utilization: [{ name: '利用率', color: 'var(--s1)', value: (p: BankHistoryView['points'][number]) => p.utilization }],
  apr: [{ name: '借款 APR', color: 'var(--s1)', value: (p: BankHistoryView['points'][number]) => p.borrowing_apr },
    { name: '存款 APR', color: 'var(--s2)', value: (p: BankHistoryView['points'][number]) => p.lending_apr }],
  total: [{ name: '总存款', color: 'var(--s2)', value: (p: BankHistoryView['points'][number]) => p.total_deposits_usd },
    { name: '总借款', color: 'var(--s1)', value: (p: BankHistoryView['points'][number]) => p.total_borrows_usd }],
};
const labels: Record<Mode, string> = { utilization: '利用率', apr: 'APR', total: '总量' };

const niceTop = (value: number, cap: number) => {
  if (!(value > 0)) return Math.min(0.01, cap);
  const step = 10 ** Math.floor(Math.log10(value)), nice = [1, 2, 5, 10].map(m => m * step).find(n => n >= value)!;
  return Math.min(nice, cap);
};

export function BankHistory({ history, decimals, symbol }: { history: BankHistoryView; decimals: number; symbol: string }) {
  const ref = useRef<SVGSVGElement>(null);
  const [mode, setMode] = useState<Mode>('utilization'), [hoverIndex, setHoverIndex] = useState<number | null>(null), points = history.points;
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
  // 纵轴只有 52 个单位宽，完整金额($20,000.00)会被截断;轴上用紧凑写法，提示框里仍是完整金额。
  const compactUsd = (v: number) => v >= 1e6 ? `$${+(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${+(v / 1e3).toFixed(1)}K` : `$${+v.toFixed(2)}`;
  const fmt = (value: number) => mode === 'utilization' || mode === 'apr' ? fmtPct(value) : compactUsd(value);
  const hoverPoint = hoverIndex == null ? null : points[hoverIndex];
  const pointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!ref.current) return;
    const bounds = ref.current.getBoundingClientRect(), position = (event.clientX - bounds.left) / bounds.width * W;
    const index = points.reduce((best, point, i) => Math.abs(x(i) - position) < Math.abs(x(best) - position) ? i : best, 0);
    setHoverIndex(index);
  };
  const dateLabel = (value: string | null, slot: string) => {
    if (!value) return `slot ${slot}`;
    const date = new Date(value);
    return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  };
  const timeTick = (step: number) => {
    const start = points[0], end = points.at(-1)!;
    if (start.block_time && end.block_time) {
      const time = new Date(start.block_time).getTime() + (new Date(end.block_time).getTime() - new Date(start.block_time).getTime()) * step / 3;
      const date = new Date(time);
      return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    }
    return `slot ${(BigInt(start.slot) * BigInt(3 - step) + BigInt(end.slot) * BigInt(step)) / 3n}`;
  };
  const total = (point: BankHistoryView['points'][number], kind: 'deposits' | 'borrows') => {
    const amount = kind === 'deposits' ? point.total_deposits : point.total_borrows;
    const usd = kind === 'deposits' ? point.total_deposits_usd : point.total_borrows_usd;
    return <div className="row" key={kind}><span>{kind === 'deposits' ? '总存款' : '总借款'}</span><b>{fmtToken(amount, decimals, 4)} {symbol}</b><span className="muted">{fmtUsd(usd)}</span></div>;
  };
  return <section className="card bank-history"><h2>历史曲线</h2>
    <div className="seg" role="group" aria-label="历史曲线指标">{(Object.keys(labels) as Mode[]).map(key =>
      <button key={key} className={mode === key ? 'on' : ''} aria-pressed={mode === key} onClick={() => setMode(key)}>{labels[key]}</button>)}</div>
    {!points.length ? <p className="muted">还没有银行状态历史。</p>
      : points.length === 1 ? <p className="muted">目前只有 1 个状态记录（slot {points[0].slot}{points[0].block_time ? `，${fmtTime(points[0].block_time)}` : ''}），后续状态变化后会形成曲线。</p>
        : mode === 'total' && values.length === 0 ? <p className="muted">这些历史时刻没有可用的价格快照，暂时无法显示美元总量。</p>
          : <><div className="history-legend">{series.map(item => <span key={item.name}><i style={{ background: item.color }} />{item.name}</span>)}</div>
            <div className="history-plot">
            <svg ref={ref} className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${history.label}历史${labels[mode]}阶梯曲线`}
                 onPointerMove={pointerMove} onPointerDown={pointerMove} onPointerLeave={() => setHoverIndex(null)}>
              {[0, .5, 1].map(r => <g key={r}><line className="grid-line" x1={M.l} x2={W - M.r} y1={y(top * r)} y2={y(top * r)} />
                <text x={M.l - 7} y={y(top * r) + 4} textAnchor="end">{fmt(top * r)}</text></g>)}
              {[0, 1, 2, 3].map((step) => {
                const fraction = step / 3;
                return <text key={step} x={M.l + fraction * (W - M.l - M.r)} y={H - 8} textAnchor={step === 0 ? 'start' : step === 3 ? 'end' : 'middle'}>{timeTick(step)}</text>;
              })}
              {series.map(item => <path key={item.name} d={path(item.value)} fill="none" stroke={item.color} strokeWidth="2" strokeLinejoin="round" />)}
              {hoverPoint && <><line className="history-hover-line" x1={x(hoverIndex!)} x2={x(hoverIndex!)} y1={M.t} y2={H - M.b} />
                {series.map((item) => { const value = item.value(hoverPoint); return value == null ? null : <circle key={item.name} cx={x(hoverIndex!)} cy={y(value)} r={4} fill={item.color} stroke="var(--surface)" strokeWidth={2} />; })}</>}
            </svg>
            {/* 提示框跟随悬停点：点在右侧 40% 时放到点的左边，避免越出卡片;原来固定在左上角，视线要来回跳。 */}
            {hoverPoint && <div className="tip history-tip" style={{ left: `${x(hoverIndex!) / W * 100}%`, top: 8,
              transform: x(hoverIndex!) / W > 0.6 ? 'translateX(calc(-100% - 12px))' : 'translateX(12px)' }}>
              <div className="muted">{dateLabel(hoverPoint.block_time, hoverPoint.slot)}</div>
              {mode === 'total' ? <>{total(hoverPoint, 'deposits')}{total(hoverPoint, 'borrows')}</> : series.map((item) => {
                const value = item.value(hoverPoint);
                return value == null ? null : <div className="row" key={item.name}><i className="key" style={{ background: item.color }} /><b>{fmtPct(value, 2)}</b><span>{item.name}</span></div>;
              })}
            </div>}
            </div></>}
  </section>;
}
