import { CartesianGrid, Line, LineChart, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { RateCurveView, RatePoint } from '@contract';
import { fmtPct } from './format';
import { useT } from './i18n';

const STEPS = [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2];
function niceScale(max: number) {
  const step = STEPS.find((size) => max / size <= 5) ?? 2;
  const top = Math.max(step, Math.ceil(max / step) * step);
  return { top, ticks: Array.from({ length: Math.round(top / step) + 1 }, (_, index) => index * step) };
}

function RateTooltip({ active, payload }: { active?: boolean; payload?: { payload?: RatePoint }[] }) {
  const { t } = useT();
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  return <div className="tip">
    <div className="muted">{t.utilization} {fmtPct(point.utilization, 2)}</div>
    <div className="row"><i className="key" style={{ background: 'var(--chart-borrow)' }} /><b>{fmtPct(point.borrowing_apr, 2)}</b><span>{t.borrowApr}</span></div>
    <div className="row"><i className="key" style={{ background: 'var(--chart-deposit)' }} /><b>{fmtPct(point.lending_apr, 2)}</b><span>{t.supplyApr}</span></div>
  </div>;
}

export function RateCurve({ curve, optimalUtilization }: { curve: RateCurveView; optimalUtilization?: number }) {
  const { t } = useT();
  const { top: yMax } = niceScale(Math.max(...curve.points.map((point) => Math.max(point.borrowing_apr, point.lending_apr)), 0.01));
  return <div>
    <div className="label rate-legend">
      <span><i className="key" style={{ background: 'var(--chart-borrow)' }} />{t.borrowApr}</span>
      <span><i className="key" style={{ background: 'var(--chart-deposit)' }} />{t.supplyApr}</span>
      <span className="muted">{t.utilization} {fmtPct(curve.current.utilization)} → {t.borrow} {fmtPct(curve.current.borrowing_apr)}, {t.supply} {fmtPct(curve.current.lending_apr)}</span>
    </div>
    <div className="rate-plot chart"><ResponsiveContainer width="100%" height={280}>
      <LineChart data={curve.points} margin={{ top: 12, right: 16, bottom: 8, left: 8 }}>
        <CartesianGrid vertical={false} stroke="var(--slate-6)" />
        <XAxis dataKey="utilization" type="number" domain={[0, 1]} ticks={[0, 0.25, 0.5, 0.75, 1]} tickFormatter={(value: number) => fmtPct(value, 0)} tick={{ fill: 'var(--slate-11)', fontSize: 12 }} />
        <YAxis axisLine={false} tickLine={false} domain={[0, yMax]} tickFormatter={(value: number) => fmtPct(value, 0)} tick={{ fill: 'var(--slate-11)', fontSize: 12 }} width={48} />
        <Tooltip content={<RateTooltip />} cursor={{ stroke: 'var(--slate-8)', strokeDasharray: '3 3' }} />
        {optimalUtilization != null && <ReferenceLine x={optimalUtilization} stroke="var(--slate-8)" strokeDasharray="4 3" label={{ value: t.optimal, fill: 'var(--slate-11)', fontSize: 12, position: 'insideTop' }} />}
        <ReferenceLine x={curve.current.utilization} stroke="var(--slate-8)" strokeDasharray="2 3" />
        <Line dataKey="borrowing_apr" name={t.borrowApr} type="linear" stroke="var(--chart-borrow)" strokeWidth={2} dot={false} activeDot={{ r: 5, fill: 'var(--chart-borrow)', stroke: 'var(--surface)', strokeWidth: 2 }} isAnimationActive={false} />
        <Line dataKey="lending_apr" name={t.supplyApr} type="linear" stroke="var(--chart-deposit)" strokeWidth={2} dot={false} activeDot={{ r: 5, fill: 'var(--chart-deposit)', stroke: 'var(--surface)', strokeWidth: 2 }} isAnimationActive={false} />
        <ReferenceDot x={curve.current.utilization} y={curve.current.borrowing_apr} r={5} fill="var(--chart-borrow)" stroke="var(--surface)" strokeWidth={2} />
        <ReferenceDot x={curve.current.utilization} y={curve.current.lending_apr} r={5} fill="var(--chart-deposit)" stroke="var(--surface)" strokeWidth={2} />
      </LineChart>
    </ResponsiveContainer></div>
    <details className="data"><summary>{t.showDataTable}</summary><div className="tablewrap"><table><thead><tr><th>{t.utilization}</th><th className="n">{t.borrowApr}</th><th className="n">{t.supplyApr}</th></tr></thead>
      <tbody>{curve.points.map((point) => <tr key={point.utilization}><td>{fmtPct(point.utilization, 0)}</td><td className="n">{fmtPct(point.borrowing_apr, 2)}</td><td className="n">{fmtPct(point.lending_apr, 2)}</td></tr>)}</tbody></table></div></details>
  </div>;
}
