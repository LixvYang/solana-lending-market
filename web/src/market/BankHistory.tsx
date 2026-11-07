/** INPUT: 银行变化点 API。 OUTPUT: 可切换指标的阶梯历史图。 POSITION: 资产页历史数据可视化。 SYNC: 同步 market folder.md。 */
import type { ReactNode } from 'react';
import { useState } from 'react';
import { CartesianGrid, Line, LineChart, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { BankHistoryPoint, BankHistoryView } from '@contract';
import { fmtPct, fmtTime, fmtToken, fmtUsd } from '../format';
import { resampleSteps } from './resample';
import { useT } from '../i18n';

type Mode = 'utilization' | 'apr' | 'total';
type ChartPoint = BankHistoryPoint & { time: number };
function seriesFor(t: ReturnType<typeof useT>['t']) {
  return {
    utilization: [{ key: 'utilization', name: t.utilization, color: 'var(--chart-util)' }],
    apr: [{ key: 'borrowing_apr', name: t.borrowApr, color: 'var(--borrow-line)' }, { key: 'lending_apr', name: t.supplyApr, color: 'var(--supply-line)' }],
    total: [{ key: 'total_deposits_usd', name: t.totalSupplied, color: 'var(--supply-line)' }, { key: 'total_borrows_usd', name: t.totalBorrowed, color: 'var(--borrow-line)' }],
  } as const;
}
const compactUsd = (value: number) => value >= 1e6 ? `$${+(value / 1e6).toFixed(1)}M` : value >= 1e3 ? `$${+(value / 1e3).toFixed(1)}K` : `$${+value.toFixed(2)}`;
const chartTime = (time: number) => {
  const date = new Date(time);
  return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};
const fullTime = (time: number) => {
  const date = new Date(time);
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};
const pointTime = (point: BankHistoryPoint) => point.block_time ? new Date(point.block_time).getTime() : Number(point.slot);

function niceTop(value: number, cap: number) {
  if (!(value > 0)) return Math.min(0.01, cap);
  const step = 10 ** Math.floor(Math.log10(value));
  return Math.min([1, 2, 5, 10].map((multiple) => multiple * step).find((tick) => tick >= value)!, cap);
}

function HistoryTooltip({ active, payload, decimals, symbol, mode, hasTimes }: { active?: boolean; payload?: { payload?: ChartPoint }[]; decimals: number; symbol: string; mode: Mode; hasTimes: boolean }) {
  const { t } = useT();
  const SERIES = seriesFor(t);
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  const rows: [string, number | null, string][] = mode === 'utilization' ? [[t.utilization, point.utilization, fmtPct(point.utilization, 2)]]
    : mode === 'apr' ? [[t.borrowApr, point.borrowing_apr, fmtPct(point.borrowing_apr, 2)], [t.supplyApr, point.lending_apr, fmtPct(point.lending_apr, 2)]]
      : [[t.totalSupplied, point.total_deposits_usd, `${fmtToken(point.total_deposits, decimals, 4)} ${symbol} / ${fmtUsd(point.total_deposits_usd)}`], [t.totalBorrowed, point.total_borrows_usd, `${fmtToken(point.total_borrows, decimals, 4)} ${symbol} / ${fmtUsd(point.total_borrows_usd)}`]];
  return <div className="tip">{hasTimes ? <div className="muted">{fullTime(point.time)}</div> : <div className="muted">slot {point.slot}</div>}
    {rows.map(([name, _value, display], index) => <div className="row" key={name}><i className="key" style={{ background: SERIES[mode][index]?.color ?? 'var(--chart-util)' }} /><b>{display}</b><span>{name}</span></div>)}
  </div>;
}

function DataTable({ points, mode, decimals, symbol }: { points: ChartPoint[]; mode: Mode; decimals: number; symbol: string }) {
  const { t, locale } = useT();
  const SERIES = seriesFor(t);
  const rows: { time: ReactNode; values: ReactNode[] }[] = points.map((point) => ({
    time: point.block_time ? fmtTime(point.block_time, locale) : `slot ${point.slot}`,
    values: mode === 'utilization' ? [fmtPct(point.utilization, 2)]
      : mode === 'apr' ? [fmtPct(point.borrowing_apr, 2), fmtPct(point.lending_apr, 2)]
        : [`${fmtToken(point.total_deposits, decimals, 4)} ${symbol} (${fmtUsd(point.total_deposits_usd)})`, `${fmtToken(point.total_borrows, decimals, 4)} ${symbol} (${fmtUsd(point.total_borrows_usd)})`],
  }));
  return <details className="data"><summary>{t.showDataTable}</summary><div className="tablewrap"><table><thead><tr><th>{t.time}</th>{SERIES[mode].map((item) => <th className="n" key={item.key}>{item.name}</th>)}</tr></thead>
    <tbody>{rows.map((row, index) => <tr key={points[index].slot}><td>{row.time}</td>{row.values.map((value, i) => <td className={`n ${mode === 'apr' ? i === 0 ? 'apr-borrow' : 'apr-supply' : ''}`} key={i}>{value}</td>)}</tr>)}</tbody></table></div></details>;
}

export function BankHistory({ history, decimals, symbol }: { history: BankHistoryView; decimals: number; symbol: string }) {
  const { t, locale } = useT();
  const LABELS: Record<Mode, string> = { utilization: t.utilization, apr: 'APR', total: t.total };
  const SERIES = seriesFor(t);
  const [mode, setMode] = useState<Mode>('utilization');
  const points: ChartPoint[] = history.points.map((point) => ({ ...point, time: pointTime(point) }));
  const series = SERIES[mode];
  const values = series.flatMap((item) => points.map((point) => point[item.key]).filter((value): value is number => typeof value === 'number' && Number.isFinite(value)));
  const top = niceTop(Math.max(...values, 0) * 1.2, mode === 'utilization' ? 1 : Infinity);
  const formatY = (value: number) => mode === 'total' ? compactUsd(value) : fmtPct(value);
  const hasTimes = points.every((point) => point.block_time != null);
  const formatX = (value: number) => hasTimes ? chartTime(value) : `slot ${value}`;
  // 只有真实时间轴才补点;slot 回退时没有"现在"对应的 slot。
  const chartPoints = hasTimes ? resampleSteps(points, Date.now(), 240) : points;
  return <section className="card bank-history"><h2>{t.history}</h2>
    <div className="seg" role="group" aria-label={t.historyMetrics}>{(Object.keys(LABELS) as Mode[]).map((key) => <button key={key} className={mode === key ? 'on' : ''} aria-pressed={mode === key} onClick={() => setMode(key)}>{LABELS[key]}</button>)}</div>
    {!points.length ? <p className="muted">{t.noHistory}</p>
      : points.length === 1 ? <p className="muted">{t.oneHistoryPoint(points[0].slot, points[0].block_time ? fmtTime(points[0].block_time, locale) : '')}</p>
        : mode === 'total' && values.length === 0 ? <p className="muted">{t.noPriceHistory}</p>
          : <div className="history-plot chart"><ResponsiveContainer width="100%" height={230}>
            <LineChart data={chartPoints} margin={{ top: 12, right: 16, bottom: 8, left: 8 }}>
              <CartesianGrid vertical={false} stroke="var(--slate-6)" />
              <XAxis dataKey="time" type="number" scale="time" domain={['dataMin', 'dataMax']} tickCount={5} tickFormatter={formatX} tick={{ fill: 'var(--slate-11)', fontSize: 12 }} minTickGap={28} />
              <YAxis axisLine={false} tickLine={false} domain={[0, top]} tickFormatter={formatY} tick={{ fill: 'var(--slate-11)', fontSize: 12 }} width={52} />
              <Tooltip content={<HistoryTooltip decimals={decimals} symbol={symbol} mode={mode} hasTimes={hasTimes} />} cursor={{ stroke: 'var(--slate-8)', strokeDasharray: '3 3' }} />
              {/* 图例文字用正文色，系列色只留在色块上(Recharts 默认把文字染成系列色)。 */}
              {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} formatter={(value) => <span style={{ color: 'var(--ink-2)' }}>{value}</span>} />}
              {series.map((item) => <Line key={item.key} dataKey={item.key} name={item.name} type="stepAfter" stroke={item.color} strokeWidth={2} dot={false} activeDot={{ r: 5, fill: item.color, stroke: 'var(--surface)', strokeWidth: 2 }} isAnimationActive={false} connectNulls={false} />)}
            </LineChart>
          </ResponsiveContainer><DataTable points={points} mode={mode} decimals={decimals} symbol={symbol} /></div>}
  </section>;
}
