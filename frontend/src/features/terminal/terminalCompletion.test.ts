import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import { commandContext, pathCandidates } from './terminalCompletion.ts';
import { detailedCommandCount, posixCommands } from './posixCommands.ts';

function context(line: string, cursor = line.length) {
  return commandContext({
    line,
    cursor,
    shell: 'zsh',
    sequence: 1,
    directory: '/work dir',
    home: '/home/user',
  });
}
test('POSIX 索引与常用命令定义唯一且有实际用法', () => {
  assert.ok(posixCommands.length >= 160);
  assert.ok(detailedCommandCount >= 40);
  assert.equal(new Set(posixCommands.map((command) => command.name)).size, posixCommands.length);
  for (const command of posixCommands) {
    assert.equal(
      new Set(command.options.map((option) => option.name)).size,
      command.options.length,
    );
    if (command.examples.length) assert.ok(command.synopsis.length > command.name.length);
  }
});
test('补全区分命令、互斥选项、选项值与管道当前命令', () => {
  assert.ok(context('gr').candidates.some((item) => item.label === 'grep'));
  assert.ok(context('cat app.log | gr').candidates.some((item) => item.label === 'grep'));
  assert.equal(
    context('pwd -L -').candidates.some((item) => item.label === '-P'),
    false,
  );
  assert.ok(context('find . -type ').candidates.some((item) => item.label === 'd'));
  assert.equal(context('grep -e ERROR ').argument?.kind, 'file');
  assert.equal(context('grep -eERR ').argument?.kind, 'file');
  assert.equal(
    context('ls -').candidates.some((item) => item.label === '-h'),
    false,
  );
});
test('路径保留引号、空格、尾部内容和当前词替换范围', () => {
  const line = "cat 'file na' other.txt",
    value = context(line, 12);
  assert.equal(value.path?.prefix, 'file na');
  assert.equal(value.from, 4);
  assert.equal(value.to, 13);
  assert.equal(
    pathCandidates(value, [{ name: "file name's.txt", directory: false }])[0].text,
    "'file name'\\''s.txt' ",
  );
  assert.equal(
    pathCandidates(context('cat '), [{ name: '-danger', directory: false }])[0].text,
    './-danger ',
  );
  assert.equal(context('cd ~/lo').path?.directory, '/home/user/');
  assert.equal(
    pathCandidates(context('cd ~/lo'), [{ name: 'log dir', directory: true }])[0].text,
    "~/'log dir/'",
  );
});
test('命令替换、注释和未展开的变量不生成动态查询', () => {
  assert.ok(context('cat $(printf secret)').unsupported);
  assert.ok(context('ls # comment').unsupported);
  assert.equal(context('cat "$HOME/fi').path, undefined);
});
