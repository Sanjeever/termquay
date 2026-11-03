import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { defaultAppearance, parseAppearance, terminalPalettes, terminalTheme } from './appearance.ts';

test('外观设置缺省保留深色，非法值明确拒绝', () => {
  assert.deepEqual(parseAppearance(null), defaultAppearance);
  assert.throws(() => parseAppearance('{'));
  assert.throws(() => parseAppearance(JSON.stringify({ ...defaultAppearance, monoFont: '__proto__' })));
  assert.throws(() => parseAppearance(JSON.stringify({ ...defaultAppearance, theme: 'unknown' })));
  assert.throws(() => parseAppearance(JSON.stringify({ ...defaultAppearance, terminalPalette: '__proto__' })));
  assert.throws(() => parseAppearance(JSON.stringify({ ...defaultAppearance, terminalLogHighlight: 'false' })));
  const settings = { ...defaultAppearance, theme: 'system' as const, terminalPalette: 'light' as const };
  assert.deepEqual(parseAppearance(JSON.stringify(settings)), settings);
});

test('旧外观设置补全日志高亮偏好，关闭后保留选择', () => {
  const { terminalLogHighlight, ...legacy } = defaultAppearance;
  assert.deepEqual(parseAppearance(JSON.stringify(legacy)), defaultAppearance);
  const disabled = { ...defaultAppearance, terminalLogHighlight: false };
  assert.deepEqual(parseAppearance(JSON.stringify(disabled)), disabled);
});

test('终端跟随主题与独立配色都提供完整 ANSI 颜色', () => {
  assert.deepEqual(terminalTheme('theme', false), terminalTheme('light', true));
  assert.deepEqual(terminalTheme('theme', true), terminalTheme('dark', false));
  assert.notEqual(terminalTheme('theme', true).background, terminalTheme('theme', false).background);
  for (const dark of [true, false]) assert.equal(Object.keys(terminalTheme('theme', dark)).length, 20);
  for (const palette of Object.keys(terminalPalettes) as (keyof typeof terminalPalettes)[]) {
    const colors = terminalTheme(palette, true);
    assert.equal(Object.keys(colors).length, 20);
    for (const color of Object.values(colors)) assert.match(color, /^#[0-9a-f]{6}$/i);
  }
  assert.notEqual(terminalTheme('one-dark', true).background, terminalTheme('tokyo-night', true).background);
});
