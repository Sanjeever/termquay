import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import type { Sample } from '../../../bindings/github.com/Sanjeever/termquay/internal/monitor/models.ts';
import { chartSeries, nearestSample, seriesCeiling } from './chartData.ts';
import { createHistory, historyLimit, historyPoints, recordSample } from './history.ts';

function sample(time: number, cpu: number | null): Sample {
  return {
    time: new Date(time).toISOString(),
    system: 'Linux',
    cpu,
    memory_total: 1000,
    memory_available: 250,
    network: [{ name: 'eth0', read: 0, write: 0, read_rate: cpu, write_rate: cpu }],
    disks: [],
    file_systems: null,
  };
}

test('环形历史保持固定容量与时间顺序，拒绝旧样本', () => {
  const history = createHistory();
  for (let time = 1; time <= historyLimit + 10; time++)
    recordSample(history, sample(time, time), time);
  recordSample(history, sample(1, 1), 1);
  const points = historyPoints(history);
  assert.equal(history.buffer.length, historyLimit);
  assert.equal(points.length, historyLimit);
  assert.equal(points[0].time, 11);
  assert.equal(points[points.length - 1].time, 130);
  assert.equal(points[0].memory, 75);
});

test('首次未知、错误与计数重置保持断线，不补零', () => {
  const history = createHistory();
  for (const [time, value] of [
    [1000, null],
    [4000, 20],
    [7000, 0],
    [10000, null],
    [13000, 30],
  ] as const)
    recordSample(history, sample(time, value), time);
  recordSample(history, null, 16000);
  recordSample(history, sample(19000, 40), 19000);
  const points = historyPoints(history);
  assert.deepEqual(chartSeries(points, 'cpu'), [
    [1000, null],
    [4000, 20],
    [7000, 0],
    [10000, null],
    [13000, 30],
    [16000, null],
    [19000, 40],
  ]);
  assert.equal(points[0].networkRead, null);
  assert.equal(points[0].diskRead, null);
});

test('隐藏后恢复在真实时间轴上留出断点，光标不吸附到缺口远端', () => {
  const history = createHistory();
  recordSample(history, sample(1000, 10), 1000);
  recordSample(history, sample(20000, 20), 20000);
  const points = historyPoints(history);
  assert.deepEqual(chartSeries(points, 'cpu'), [
    [1000, 10],
    [11000, null],
    [20000, 20],
  ]);
  assert.equal(nearestSample(points, 9900), undefined);
  assert.equal(nearestSample(points, 19500)?.time, 20000);
});

test('读写共用速率刻度，旧峰值离开观察范围后不再影响刻度', () => {
  const history = createHistory();
  recordSample(history, sample(1000, 667), 1000);
  recordSample(history, sample(20000, 23), 20000);
  const points = historyPoints(history);
  assert.equal(seriesCeiling(points, ['networkRead', 'networkWrite'], 0, 20000), 1000);
  assert.equal(seriesCeiling(points, ['networkRead', 'networkWrite'], 5000, 20000), 50);
});
