import { useRef, useState } from 'react';
import type { RateCurveView, RatePoint } from '@contract';
import { fmtPct } from './format';

const W = 560, H = 280, M = { l: 48, r: 16, t: 12, b: 30 };
// 刻度取整：从一组干净的步长里选一个，让 4–6 条刻度线都落在整百分比上(0 / 100% / 200%…，而不是 88% / 263%)。
const STEPS = [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2];
function niceScale(max: number) {
  const step = STEPS.find((s) => max / s <= 5) ?? 2;
  const top = Math.max(step, Math.ceil(max / step) * step);
  return { top, ticks: Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step) };
}

/** 手写 SVG 折线图：2px 线、≥8px 圆点带 2px 底色环、发丝网格、悬停十字线 + 单个 tooltip。 */
export function RateCurve({ curve, optimalUtilization }: { curve: RateCurveView; optimalUtilization?: number }) {
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<RatePoint | null>(null);
  const { top: yMax, ticks: yTicks } = niceScale(Math.max(...curve.points.map((p) => Math.max(p.borrowing_apr, p.lending_apr)), 0.01));
  const x = (u: number) => M.l + u * (W - M.l - M.r);
  const y = (v: number) => M.t + (1 - v / yMax) * (H - M.t - M.b);
  const line = (pick: (p: RatePoint) => number) => curve.points.map((p, i) => `${i ? 'L' : 'M'}${x(p.utilization).toFixed(1)} ${y(pick(p)).toFixed(1)}`).join('');
  const active = hover ?? curve.current;

  const onMove = (e: React.PointerEvent) => {
    const box = ref.current!.getBoundingClientRect();
    const u = Math.min(1, Math.max(0, ((e.clientX - box.left) / box.width * W - M.l) / (W - M.l - M.r)));
    // 十字线吸附最近的数据点：读者瞄的是利用率，不是一根 2px 的线。
    setHover(curve.points.reduce((best, p) => (Math.abs(p.utilization - u) < Math.abs(best.utilization - u) ? p : best)));
  };
  const tipLeft = active.utilization > 0.65 ? 2 : Math.min(65, Math.max(2, (x(active.utilization) / W) * 100 - 14));

  return (
    <div>
      <div className="label" style={{ marginBottom: 8, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <span><i className="key" style={{ background: 'var(--s1)' }} />借款 APR</span>
        <span><i className="key" style={{ background: 'var(--s2)' }} />存款 APR</span>
        <span className="muted">当前利用率 {fmtPct(curve.current.utilization)} → 借款 {fmtPct(curve.current.borrowing_apr)}，存款 {fmtPct(curve.current.lending_apr)}</span>
      </div>
      <div style={{ position: 'relative' }}>
        <svg ref={ref} className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${curve.label} 利率曲线`}
             onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)}>
          <g className="grid">{yTicks.map((t) => <line key={t} x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} />)}</g>
          {yTicks.map((t) => <text key={t} x={M.l - 8} y={y(t) + 4} textAnchor="end">{fmtPct(t, 0)}</text>)}
          {[0, 0.25, 0.5, 0.75, 1].map((u) => <text key={u} x={x(u)} y={H - 10} textAnchor="middle">{fmtPct(u, 0)}</text>)}
          <line className="axis" x1={M.l} x2={W - M.r} y1={y(0)} y2={y(0)} />
          <path d={line((p) => p.borrowing_apr)} fill="none" stroke="var(--s1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          <path d={line((p) => p.lending_apr)} fill="none" stroke="var(--s2)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {optimalUtilization != null && <g className="optimal-marker"><line x1={x(optimalUtilization)} x2={x(optimalUtilization)} y1={M.t} y2={y(0)} stroke="var(--warning)" strokeWidth={1.5} strokeDasharray="4 3" /><text x={x(optimalUtilization)} y={M.t + 12} textAnchor="middle">最优</text></g>}
          {/* 当前利用率的标记；悬停时十字线接管 */}
          <line x1={x(active.utilization)} x2={x(active.utilization)} y1={M.t} y2={y(0)} stroke="var(--ink-3)" strokeWidth={1} />
          <circle cx={x(active.utilization)} cy={y(active.borrowing_apr)} r={5} fill="var(--s1)" stroke="var(--surface)" strokeWidth={2} />
          <circle cx={x(active.utilization)} cy={y(active.lending_apr)} r={5} fill="var(--s2)" stroke="var(--surface)" strokeWidth={2} />
          <rect x={M.l} y={M.t} width={W - M.l - M.r} height={H - M.t - M.b} fill="transparent" />
        </svg>
        {hover && (
          <div className="tip" style={{ left: `${tipLeft}%`, top: 8 }}>
            <div className="muted">利用率 {fmtPct(hover.utilization, 0)}</div>
            <div className="row"><i className="key" style={{ background: 'var(--s1)' }} /><b>{fmtPct(hover.borrowing_apr)}</b><span>借款</span></div>
            <div className="row"><i className="key" style={{ background: 'var(--s2)' }} /><b>{fmtPct(hover.lending_apr)}</b><span>存款</span></div>
          </div>
        )}
      </div>
      <details className="data"><summary>查看数据表</summary>
        <div className="tablewrap"><table><thead><tr><th>利用率</th><th className="n">借款 APR</th><th className="n">存款 APR</th></tr></thead>
          <tbody>{curve.points.filter((_, i) => i % Math.max(1, Math.round(curve.points.length / 11)) === 0).map((p) => (
            <tr key={p.utilization}><td>{fmtPct(p.utilization, 0)}</td><td className="n">{fmtPct(p.borrowing_apr, 2)}</td><td className="n">{fmtPct(p.lending_apr, 2)}</td></tr>))}</tbody></table></div>
      </details>
    </div>
  );
}
