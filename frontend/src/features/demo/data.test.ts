import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import {
  demoConnections,
  demoDirectories,
  demoFiles,
  demoGroups,
  demoLatency,
  demoPreferences,
  demoSamples,
  demoTime,
} from './data.ts';
import { createHistory, historyPoints, recordSample, trendSegments } from '../monitor/history.ts';

test('演示目录独立使用示例域名与空凭据，分组和偏好引用完整', () => {
  const groups = new Set(demoGroups.map((group) => group.id));
  assert.equal(
    new Set(demoConnections.map((connection) => connection.id)).size,
    demoConnections.length,
  );
  for (const connection of demoConnections) {
    assert.ok(connection.id.startsWith('demo-'));
    assert.ok(connection.host.endsWith('.example.com'));
    assert.equal(connection.credential_id, '');
    assert.ok(groups.has(connection.group_id));
    assert.ok(demoPreferences[connection.id]);
    assert.ok(demoLatency[connection.id]?.result);
    assert.ok(!connection.certificate && !connection.proxy_address && !connection.jump_id);
  }
});

test('演示目录树的全部文件都来自内存，元数据与正文一致', () => {
  const files = new Set<string>();
  for (const [parent, entries] of Object.entries(demoDirectories))
    for (const entry of entries) {
      assert.equal(entry.path, parent === '/' ? `/${entry.name}` : `${parent}/${entry.name}`);
      assert.equal(entry.symlink, false);
      if (entry.directory) assert.ok(demoDirectories[entry.path]);
      else {
        assert.ok(Object.prototype.hasOwnProperty.call(demoFiles, entry.path));
        assert.equal(entry.size, new TextEncoder().encode(demoFiles[entry.path]).length);
        files.add(entry.path);
      }
    }
  assert.deepEqual([...files].sort(), Object.keys(demoFiles).sort());
});

test('固定监控样本在演示时钟下形成连续趋势，运行时间不会使其过期', () => {
  const history = createHistory();
  for (const sample of demoSamples) {
    assert.ok(sample.cpu !== null && sample.cpu >= 0 && sample.cpu <= 100);
    assert.ok(sample.memory_available >= 0 && sample.memory_available <= sample.memory_total);
    recordSample(history, sample, Date.parse(sample.time));
  }
  const points = historyPoints(history);
  assert.equal(points.length, demoSamples.length);
  assert.equal(points[points.length - 1].time, demoTime);
  for (const metric of ['cpu', 'memory', 'networkRead', 'networkWrite'] as const)
    assert.equal(trendSegments(points, metric, demoTime)[0].length, demoSamples.length);
});
