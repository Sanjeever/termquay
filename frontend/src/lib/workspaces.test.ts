import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import { nextWorkspaceAfterClose } from './workspaces.ts';

test('关闭活动工作区选择有效最近项，后台关闭不切换', () => {
  const items = ['a', 'b', 'c'].map(id => ({ id }));
  assert.equal(nextWorkspaceAfterClose(items, 'c', 'c', ['c', 'removed', 'b', 'a']), 'b');
  assert.equal(nextWorkspaceAfterClose(items, 'c', 'b', ['a']), 'c');
  assert.equal(nextWorkspaceAfterClose(items, 'b', 'b', []), 'c');
  assert.equal(nextWorkspaceAfterClose(items, 'c', 'c', []), 'b');
  assert.equal(nextWorkspaceAfterClose([{ id: 'a' }], 'a', 'a', []), '');
  assert.equal(nextWorkspaceAfterClose(items, '', 'a', []), '');
});
