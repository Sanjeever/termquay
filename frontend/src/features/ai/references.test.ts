import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import { addAIReference } from './references.ts';

test('引用保存原工作区和终端快照，后续切换和源对象修改不改变引用', () => {
  const source = { workspace: 'ssh-a', terminal: 'terminal-2', text: '原选文\n第二行' };
  const first = addAIReference([], source, 'ssh-a');
  source.terminal = 'terminal-3';
  source.text = '新选区';
  assert.equal(first[0].terminal, 'terminal-2');
  assert.equal(first[0].text, '原选文\n第二行');
  const second = addAIReference(first, source, 'ssh-a');
  assert.equal(first.length, 1);
  assert.equal(second.length, 2);
});

test('跨工作区、空来源、引用数量和 UTF-8 字节超限均明确拒绝', () => {
  const r = { workspace: 'ssh-a', terminal: 'terminal-1', text: '选文' };
  assert.throws(() => addAIReference([], r, 'ssh-b'));
  assert.throws(() => addAIReference([], { ...r, terminal: '' }, 'ssh-a'));
  assert.throws(() => addAIReference(Array(4).fill(r), r, 'ssh-a'));
  assert.throws(() => addAIReference([], { ...r, text: '中'.repeat(5462) }, 'ssh-a'));
  assert.equal(
    addAIReference([], { ...r, text: 'x'.repeat(16384) }, 'ssh-a')[0].text.length,
    16384,
  );
});
