import i18n from '../../i18n/index.ts';
await i18n.changeLanguage('zh-CN');
import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import { bytes, remaining, transferState, transferSummary, groupTransfers } from './transferFormat.ts';

test('传输字节与剩余时间保留未知和零值语义', () => {
  assert.equal(bytes(0), '0 B');
  assert.equal(bytes(1536), '1.5 KiB');
  assert.equal(remaining(-1), '—');
  assert.equal(remaining(10), '约剩余 10 秒');
  assert.equal(remaining(61), '约剩余 2 分钟');
});

test('复制完成与取消请求不提前显示结束', () => {
  assert.equal(transferState({ state: 'running', phase: 'finishing' }), '正在完成');
  assert.equal(transferState({ state: 'running', phase: 'cancelling' }), '正在取消');
  assert.equal(transferState({ state: 'done', phase: '' }), '已完成');
});

test('批次摘要分别统计完成、跳过、失败与取消', () => {
  assert.equal(transferSummary([{ state: 'done' }, { state: 'skipped' }, { state: 'failed' }, { state: 'cancelled' }]), '1 项完成 · 1 项跳过 · 1 项失败 · 1 项取消');
  assert.equal(transferSummary([{ state: 'queued' }]), '1 项等待');
});

test('transfer batches retain host and direction identity and use a path boundary', () => {
  const task = { id: '1', batch_id: 'batch', target: 'user@one:22', direction: 'upload', destination_path: '/srv/app/a.conf', directory: false };
  const groups = groupTransfers([task, { ...task, id: '2', destination_path: '/srv/application/b.conf' }, { ...task, id: '3', target: 'user@two:22' }, { ...task, id: '4', direction: 'download' }, { ...task, id: '5', batch_id: '' }, { ...task, id: '6', batch_id: '' }]);
  assert.equal(groups.length, 5);
  assert.equal(groups[0].directory, '/srv');
  assert.deepEqual(groups[0].items.map(item => item.id), ['1', '2']);
  assert.equal(groups[1].items[0].target, 'user@two:22');
  assert.equal(groups[2].items[0].direction, 'download');
});

test('download batches preserve Windows drives, UNC paths and unknown destinations', () => {
  const task = { id: 'one', batch_id: 'batch', target: 'user@one:22', direction: 'download', destination_path: 'C:\\Users\\test\\a.conf', directory: false };
  assert.equal(groupTransfers([task, { ...task, id: 'two', destination_path: 'C:\\Users\\other\\b.conf' }])[0].directory, 'C:\\Users');
  assert.equal(groupTransfers([{ ...task, destination_path: 'C:\\a.conf' }])[0].directory, 'C:\\');
  assert.equal(groupTransfers([{ ...task, destination_path: '\\\\server\\share\\a.conf' }])[0].directory, '\\\\server\\share');
  assert.equal(groupTransfers([{ ...task, destination_path: '' }])[0].directory, '');
});
