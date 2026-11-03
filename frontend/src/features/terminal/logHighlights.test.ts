import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { logLevelMatches } from './logHighlights.ts';

test('日志级别按完整单词匹配，支持大小写及常见别名', () => {
  const text = '[ERROR] fatal WARN Warning INFO debug trace';
  const matches = logLevelMatches(text);
  assert.deepEqual(matches.map(match => text.slice(match.index, match.index + match.length)), ['ERROR', 'fatal', 'WARN', 'Warning', 'INFO', 'debug', 'trace']);
  assert.deepEqual(matches.map(match => match.color), ['red', 'red', 'yellow', 'yellow', 'cyan', 'brightBlack', 'brightBlack']);
  assert.deepEqual(logLevelMatches('ERROR_COUNT information debugger warningly'), []);
});

test('保留中文及组合字符后的文本位置，不改写日志内容', () => {
  const text = '中文🔐 e\u0301 [ERROR] 连接失败；WARN 响应超时';
  const matches = logLevelMatches(text);
  assert.deepEqual(matches.map(match => match.index), [text.indexOf('ERROR'), text.indexOf('WARN')]);
  assert.deepEqual(matches.map(match => match.length), [5, 4]);
});
