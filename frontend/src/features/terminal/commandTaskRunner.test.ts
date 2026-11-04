import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { runCommandTask } from './commandTaskRunner.ts';

test('首台完成并确认后才启动剩余批次，每台主机按步骤顺序执行', async () => {
  const calls: string[] = [];
  let approve!: (value: boolean) => void;
  let waiting!: () => void;
  const approvalRequested = new Promise<void>(resolve => { waiting = resolve; });
  const run = runCommandTask(['a', 'b', 'c'], [1, 2], { stop_on_failure: true, first_host_approval: true, concurrency: 2, batch_size: 1 }, {
    cancelled: () => false,
    async execute(target, step) { calls.push(`${target}:${step}`); return false; },
    approveFirstHost() { waiting(); return new Promise(resolve => { approve = resolve; }); },
  });
  await approvalRequested;
  assert.deepEqual(calls, ['a:1', 'a:2']);
  approve(true);
  await run;
  assert.deepEqual(calls, ['a:1', 'a:2', 'b:1', 'b:2', 'c:1', 'c:2']);
});

test('并发数受策略限制，当前批次结束后才启动下一批', async () => {
  const calls: string[] = [];
  const releases = new Map<string, () => void>();
  let batchStarted!: () => void;
  const started = new Promise<void>(resolve => { batchStarted = resolve; });
  const run = runCommandTask(['a', 'b', 'c'], [1], { stop_on_failure: true, concurrency: 2, batch_size: 2 }, {
    cancelled: () => false,
    async execute(target) {
      calls.push(target);
      if (target === 'c') return false;
      await new Promise<void>(resolve => { releases.set(target, resolve); if (releases.size === 2) batchStarted(); });
      return false;
    },
    async approveFirstHost() { assert.fail('未开启首台确认'); },
  });
  await started;
  assert.deepEqual(calls, ['a', 'b']);
  releases.get('a')!();
  await Promise.resolve();
  assert.deepEqual(calls, ['a', 'b']);
  releases.get('b')!();
  await run;
  assert.deepEqual(calls, ['a', 'b', 'c']);
});

test('单主机失败停止后续步骤，全局失败策略决定是否继续下一主机', async () => {
  for (const stopAll of [false, true]) {
    const calls: string[] = [];
    await runCommandTask(['a', 'b'], [1, 2], { stop_on_failure: true, stop_all_on_failure: stopAll, concurrency: 1 }, {
      cancelled: () => false,
      async execute(target, step) { calls.push(`${target}:${step}`); return target === 'a'; },
      async approveFirstHost() { assert.fail('未开启首台确认'); },
    });
    assert.deepEqual(calls, stopAll ? ['a:1'] : ['a:1', 'b:1', 'b:2']);
  }
});

test('全局停止保留已运行主机自己的步骤策略', async () => {
  const calls: string[] = [];
  await runCommandTask(['a', 'b', 'c'], [1, 2], { stop_on_failure: false, stop_all_on_failure: true, concurrency: 2 }, {
    cancelled: () => false,
    async execute(target, step) { calls.push(`${target}:${step}`); return target === 'a'; },
    async approveFirstHost() { assert.fail('未开启首台确认'); },
  });
  assert.deepEqual(calls, ['a:1', 'b:1', 'a:2', 'b:2']);
});

test('拒绝首台确认或在等待确认时取消均不启动后续主机', async () => {
  for (const cancel of [false, true]) {
    const calls: string[] = [];
    let cancelled = false;
    await runCommandTask(['a', 'b'], [1], { stop_on_failure: true, first_host_approval: true }, {
      cancelled: () => cancelled,
      async execute(target) { calls.push(target); return false; },
      async approveFirstHost() { cancelled = cancel; return cancel; },
    });
    assert.deepEqual(calls, ['a']);
  }
});

test('取消后不再派发下一步与下一主机', async () => {
  const calls: string[] = [];
  let cancelled = false;
  await runCommandTask(['a', 'b'], [1, 2], { stop_on_failure: false, concurrency: 1 }, {
    cancelled: () => cancelled,
    async execute(target, step) { calls.push(`${target}:${step}`); cancelled = true; return false; },
    async approveFirstHost() { assert.fail('未开启首台确认'); },
  });
  assert.deepEqual(calls, ['a:1']);
});
