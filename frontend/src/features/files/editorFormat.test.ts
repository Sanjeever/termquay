import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import { documentFormat, formatKey } from './editorFormat.ts';

test('旧草稿从正文识别换行符，新草稿保留显式格式与 BOM', () => {
  assert.equal(documentFormat({ content: 'one\r\ntwo\r\n' }).line_ending, 'CRLF');
  assert.equal(documentFormat({ content: 'one\r\ntwo\n' }).line_ending, 'mixed');
  assert.deepEqual(
    documentFormat({ content: '', encoding: 'GB18030', line_ending: 'CRLF', bom: false }),
    { encoding: 'GB18030', line_ending: 'CRLF', bom: false },
  );
  assert.equal(documentFormat({ content: 'one', bom: true }).bom, true);
});

test('正文不变时编码、换行与 BOM 变化仍改变保存基线', () => {
  const document = { content: 'one', encoding: 'UTF-8', line_ending: 'LF', bom: false };
  for (const changed of [{ encoding: 'GBK' }, { line_ending: 'CRLF' }, { bom: true }])
    assert.notEqual(formatKey(document), formatKey({ ...document, ...changed }));
  assert.equal(formatKey(document), formatKey({ content: 'one' }));
});
