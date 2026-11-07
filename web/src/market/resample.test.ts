import assert from 'node:assert/strict';
import test from 'node:test';
import { resampleSteps } from './resample.js';

// 2026-10-24 作者反馈：悬停只能停在"有过行为的点"上，两次交易之间的时段看不到数值。
// 银行状态在两次交易之间不变(阶梯),所以任意时刻的值 = 该时刻之前最后一个变化点的值。
test('均匀补点并沿用之前的值，保留原始变化点，延伸到结束时刻', () => {
  const points = [{ time: 0, v: 0.1 }, { time: 100, v: 0.5 }];
  const out = resampleSteps(points, 200, 5);
  assert.deepEqual(out.map(p => [p.time, p.v]), [[0, 0.1], [50, 0.1], [100, 0.5], [150, 0.5], [200, 0.5]]);
  assert.deepEqual(out.filter(p => p.change).map(p => p.time), [0, 100]);
});

test('变化点不在网格上时也精确保留，且时间严格递增、不重复', () => {
  const out = resampleSteps([{ time: 0, v: 1 }, { time: 33, v: 2 }, { time: 34, v: 3 }], 100, 3);
  assert.deepEqual(out.map(p => p.time), [0, 33, 34, 50, 100]);
  assert.deepEqual(out.map(p => p.v), [1, 2, 3, 3, 3]);
});

test('少于 1 个点或结束时刻早于最后一点时不补点', () => {
  assert.deepEqual(resampleSteps([], 10, 5), []);
  assert.deepEqual(resampleSteps([{ time: 5, v: 1 }], 3, 5).map(p => p.time), [5]);
});
