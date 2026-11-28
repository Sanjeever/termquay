import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import { commandResults } from './commands.ts';

test('大量连接不会挤走工作区与常用命令，结果有界', () => {
  const items = [
    ...Array.from({ length: 200 }, (_, i) => ({ label: `连接 ${i}`, kind: 'connection' as const })),
    { label: '设置', kind: 'command' as const },
    { label: '当前主机', kind: 'workspace' as const },
  ];
  const result = commandResults(items, '', 'all');
  assert.ok(result.some((c) => c.label === '设置'));
  assert.ok(result.some((c) => c.label === '当前主机'));
  assert.ok(result.length <= 50);
  assert.equal(commandResults(items, '', 'connection').length, 50);
});
test('检索多字段且可限制到工作区', () => {
  const items = [
    {
      label: '开发主机',
      detail: 'SSH',
      search: 'host.test admin 2222 研发',
      kind: 'connection' as const,
    },
    { label: '开发主机', kind: 'workspace' as const },
  ];
  assert.equal(commandResults(items, 'admin 2222 研发', 'all').length, 1);
  assert.equal(commandResults(items, '开发', 'workspace')[0].kind, 'workspace');
});

test('the workspace switcher includes every open workspace', () => {
  const items = Array.from({ length: 75 }, (_, index) => ({
    label: `Workspace ${index}`,
    kind: 'workspace' as const,
  }));
  assert.equal(commandResults(items, '', 'workspace').length, 75);
  assert.equal(commandResults(items, '74', 'workspace')[0].label, 'Workspace 74');
});

test('empty search puts active workspaces and saved connections before commands', () => {
  const items = [
    { label: 'New connection', kind: 'command' as const },
    { label: 'Demo: SSH', kind: 'command' as const, queryOnly: true },
    { label: 'Recent host', kind: 'connection' as const },
    { label: 'Other workspace', kind: 'workspace' as const },
    { label: 'Current workspace', kind: 'workspace' as const, priority: 2 },
  ];
  assert.deepEqual(
    commandResults(items, '', 'all').map(({ label }) => label),
    ['Current workspace', 'Other workspace', 'Recent host', 'New connection'],
  );
  assert.equal(commandResults(items, 'demo', 'all')[0].label, 'Demo: SSH');
});

test('name matches rank above connection details before the result limit is applied', () => {
  const items = [
    ...Array.from({ length: 20 }, (_, index) => ({
      label: `Host ${index}`,
      detail: 'deploy@server',
      kind: 'connection' as const,
    })),
    { label: 'Server staging', kind: 'connection' as const },
    { label: 'Server', kind: 'connection' as const },
  ];
  assert.deepEqual(
    commandResults(items, 'server', 'all')
      .slice(0, 2)
      .map(({ label }) => label),
    ['Server', 'Server staging'],
  );
});

test('exact names outrank other groups and renamed workspaces still match their saved host', () => {
  const items = [
    { label: 'Server staging', kind: 'workspace' as const, priority: 4 },
    { label: 'Database', kind: 'workspace' as const, alternateName: 'Server', priority: 1 },
    { label: 'Server', kind: 'connection' as const },
    { label: 'New workspace for Server', kind: 'connection' as const, queryOnly: true },
  ];
  assert.deepEqual(
    commandResults(items, 'server', 'all').map(({ label }) => label),
    ['Database', 'Server', 'Server staging', 'New workspace for Server'],
  );
});
