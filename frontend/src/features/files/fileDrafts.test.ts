import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import { isDirty, savedEncoding, withSavedDocument, fileErrorAction, type Draft } from './fileDrafts.ts';
import { formatKey } from './editorFormat.ts';

const draft = (): Draft => ({ path: '/tmp/test-config', content: 'original', revision: 'before', encoding: 'UTF-8', line_ending: 'LF', bom: false, saved: 'original', error: '', saving: false });

test('保存完成更新基线并保留保存期间继续输入的正文与格式', () => {
  const submitted = { ...draft(), content: 'submitted', encoding: 'GBK', line_ending: 'CRLF' };
  const current = { ...submitted, content: 'newer input', encoding: 'UTF-8', saving: true };
  const saved = withSavedDocument(current, { ...submitted, revision: 'after' });
  assert.equal(saved.content, 'newer input');
  assert.equal(saved.encoding, 'UTF-8');
  assert.equal(saved.revision, 'after');
  assert.equal(saved.saving, false);
  assert.equal(savedEncoding(saved), 'GBK');
  assert.equal(isDirty(saved), true);
  assert.equal(isDirty(withSavedDocument(submitted, { ...submitted, revision: 'after' })), false);
});

test('正文相同但格式改变或带恢复标记的草稿仍需保存', () => {
  const original = draft();
  original.savedFormat = formatKey(original);
  assert.equal(isDirty(original), false);
  assert.equal(isDirty({ ...original, encoding: 'GBK' }), true);
  assert.equal(isDirty({ ...original, bom: true }), true);
  assert.equal(isDirty({ ...original, recovery: true }), true);
});

test('file recovery actions follow the failed operation and structured remote error', () => {
  const conflict = { cause: { causes: [{ messageCode: 'backend:remoteFileChangedReadItAgainAndCompare' }, { message: 'cleanup failure' }] } };
  assert.equal(fileErrorAction({ error: conflict, errorOperation: 'save' }, true), 'compare');
  assert.equal(fileErrorAction({ error: conflict }, false), 'reconnect');
  assert.equal(fileErrorAction({ error: '', needsReview: true }, true), 'compare');
  assert.equal(fileErrorAction({ error: { cause: { messageCode: 'backend:cannotRepresentTheCurrentContentUseUTF8' } } }, true), 'encoding');
  assert.equal(fileErrorAction({ error: 'Permission denied', errorOperation: 'save' }, true), 'save');
  assert.equal(fileErrorAction({ error: 'Permission denied', errorOperation: 'read' }, true), 'reload');
});
