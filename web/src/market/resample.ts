/** INPUT: 按时间排序的阶梯变化点、结束时刻、采样数。 OUTPUT: 均匀补点后的序列(change 标记原始变化点)。 POSITION: BankHistory 悬停取值。 SYNC: 同步 market folder.md。 */

// 图表只在数据点上响应悬停;变化点稀疏时,两点之间悬停会吸附到最近的变化点。
// 均匀补点并沿用前一个变化点的值(stepAfter 语义),悬停任意位置都能读到那一刻生效的值。
export function resampleSteps<T extends { time: number }>(points: T[], end: number, samples: number): (T & { change: boolean })[] {
  const changes = points.map((point) => ({ ...point, change: true }));
  if (!changes.length || samples < 2 || end <= changes[changes.length - 1].time) return changes;
  const start = changes[0].time, step = (end - start) / (samples - 1), out: (T & { change: boolean })[] = [];
  let next = 0;
  for (let i = 0; i < samples; i++) {
    const time = i === samples - 1 ? end : Math.round(start + i * step);
    while (next < changes.length && changes[next].time <= time) out.push(changes[next++]);
    if (out[out.length - 1].time < time) out.push({ ...out[out.length - 1], time, change: false });
  }
  return out;
}
