import { CartesianGrid, Line, LineChart, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { RateCurveView, RatePoint } from '@contract';
import { fmtPct } from './format';

const STEPS = [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2];
function niceScale(max: number) {
  const step = STEPS.find((size) => max / size <= 5) ?? 2;
  const top = Math.max(step, Math.ceil(max / step) * step);
  return { top, ticks: Array.from({ length: Math.round(top / step) + 1 }, (_, index) => index * step) };
}

function RateTooltip({ active, payload }: { active?: boolean; payload?: { payload?: RatePoint }[] }) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  return <div className="tip">
    <div className="muted">利用率 {fmtPct(point.utilization, 2)}</div>
    <div className="row"><i className="key" style={{ background: 'var(--chart-borrow)' }} /><b>{fmtPct(point.borrowing_apr, 2)}</b><span>借款 APR</span></div>
    <div className="row"><i className="key" style={{ background: 'var(--chart-deposit)' }} /><b>{fmtPct(point.lending_apr, 2)}</b><span>存款 APR</span></div>
  </div>;
}

export function RateCurve({ curve, optimalUtilization }: { curve: RateCurveView; optimalUtilization?: number }) {
  const { top: yMax } = niceScale(Math.max(...curve.points.map((point) => Math.max(point.borrowing_apr, point.lending_apr)), 0.01));
  return <div>
    <div className="label rate-legend">
      <span><i className="key" style={{ background: 'var(--chart-borrow)' }} />借款 APR</span>
      <span><i className="key" style={{ background: 'var(--chart-deposit)' }} />存款 APR</span>
      <span className="muted">当前利用率 {fmtPct(curve.current.utilization)} → 借款 {fmtPct(curve.current.borrowing_apr)}，存款 {fmtPct(curve.current.lending_apr)}</span>
    </div>
    <div className="rate-plot chart"><ResponsiveContainer width="100%" height={280}>
      <LineChart data={curve.points} margin={{ top: 12, right: 16, bottom: 8, left: 8 }}>
        <CartesianGrid vertical={false} stroke="var(--slate-6)" />
        <XAxis dataKey="utilization" type="number" domain={[0, 1]} ticks={[0, 0.25, 0.5, 0.75, 1]} tickFormatter={(value: number) => fmtPct(value, 0)} tick={{ fill: 'var(--slate-11)', fontSize: 12 }} />
        <YAxis axisLine={false} tickLine={false} domain={[0, yMax]} tickFormatter={(value: number) => fmtPct(value, 0)} tick={{ fill: 'var(--slate-11)', fontSize: 12 }} width={48} />
        <Tooltip content={<RateTooltip />} cursor={{ stroke: 'var(--slate-8)', strokeDasharray: '3 3' }} />
        {optimalUtilization != null && <ReferenceLine x={optimalUtilization} stroke="var(--slate-8)" strokeDasharray="4 3" label={{ value: '最优', fill: 'var(--slate-11)', fontSize: 12, position: 'insideTop' }} />}
        <ReferenceLine x={curve.current.utilization} stroke="var(--slate-8)" strokeDasharray="2 3" />
        <Line dataKey="borrowing_apr" name="借款 APR" type="linear" stroke="var(--chart-borrow)" strokeWidth={2} dot={false} activeDot={{ r: 5, fill: 'var(--chart-borrow)', stroke: 'var(--surface)', strokeWidth: 2 }} isAnimationActive={false} />
        <Line dataKey="lending_apr" name="存款 APR" type="linear" stroke="var(--chart-deposit)" strokeWidth={2} dot={false} activeDot={{ r: 5, fill: 'var(--chart-deposit)', stroke: 'var(--surface)', strokeWidth: 2 }} isAnimationActive={false} />
        <ReferenceDot x={curve.current.utilization} y={curve.current.borrowing_apr} r={5} fill="var(--chart-borrow)" stroke="var(--surface)" strokeWidth={2} />
        <ReferenceDot x={curve.current.utilization} y={curve.current.lending_apr} r={5} fill="var(--chart-deposit)" stroke="var(--surface)" strokeWidth={2} />
      </LineChart>
    </ResponsiveContainer></div>
    <details className="data"><summary>查看数据表</summary><div className="tablewrap"><table><thead><tr><th>利用率</th><th className="n">借款 APR</th><th className="n">存款 APR</th></tr></thead>
      <tbody>{curve.points.map((point) => <tr key={point.utilization}><td>{fmtPct(point.utilization, 0)}</td><td className="n">{fmtPct(point.borrowing_apr, 2)}</td><td className="n">{fmtPct(point.lending_apr, 2)}</td></tr>)}</tbody></table></div></details>
  </div>;
}
