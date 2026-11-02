import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { defaultAppearance, parseAppearance, terminalTheme } from './appearance.ts';

test('外观设置缺省保留深色，非法值明确拒绝', () => {
  assert.deepEqual(parseAppearance(null), defaultAppearance);
  assert.throws(() => parseAppearance('{'));
  assert.throws(() => parseAppearance(JSON.stringify({ ...defaultAppearance, monoFont: '__proto__' })));
  assert.throws(() => parseAppearance(JSON.stringify({ ...defaultAppearance, theme: 'unknown' })));
  const settings = { ...defaultAppearance, theme: 'system' as const, terminalPalette: 'light' as const };
  assert.deepEqual(parseAppearance(JSON.stringify(settings)), settings);
});

test('终端跟随主题与独立配色都提供完整 ANSI 颜色', () => {
  assert.deepEqual(terminalTheme('theme', false), terminalTheme('light', true));
  assert.deepEqual(terminalTheme('theme', true), terminalTheme('dark', false));
  assert.notEqual(terminalTheme('theme', true).background, terminalTheme('theme', false).background);
  for (const dark of [true, false]) assert.equal(Object.keys(terminalTheme('theme', dark)).length, 20);
});
