import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { completionEdit, parseCompletionMessage, shellPoint } from './shellCompletionProtocol.ts';

const token = 'a'.repeat(64);
const hex = (value: string) => Buffer.from(value).toString('hex');
test('Shell 补全只接受当前会话且编码完整的快照', () => {
  const packet = `termquay;${token};S;1;bash;3;${hex('ls ')};${hex('/tmp')};${hex('/home/user')}`;
  assert.equal(parseCompletionMessage(packet, 'b'.repeat(64)), null);
  assert.equal(parseCompletionMessage(packet.replace(hex('ls '), 'ff'), token), null);
  assert.equal(parseCompletionMessage(packet, token)?.kind, 'snapshot');
  assert.equal(parseCompletionMessage(packet.replace(';bash;3;', ';bash;99;'), token), null);
});
test('UTF-8 字节、Zsh 字符与前端光标可往返，补全帧不包含回车', () => {
  const line = 'cat 中文😀.txt';
  for (const shell of ['bash', 'zsh'] as const) {
    const data = parseCompletionMessage(`termquay;${token};S;2;${shell};${shellPoint(line, line.length, shell)};${hex(line)};${hex('/tmp')};${hex('/home/user')}`, token);
    assert.equal(data?.kind, 'snapshot');
    if (data?.kind !== 'snapshot') return;
    assert.equal(data.snapshot.cursor, line.length);
    const edit = completionEdit(token, data.snapshot, 4, line.length, "'中文😀 新.txt'");
    assert.equal(/[\r\n]/.test(edit), false);
    assert.equal(edit.endsWith('\x07'), true);
    assert.match(edit, new RegExp(`${hex("cat '中文😀 新.txt'")}\\x07$`));
  }
});
