import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { bytes, remaining, transferState, transferSummary } from './transferFormat.ts';

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
