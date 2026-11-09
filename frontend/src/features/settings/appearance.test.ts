import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import { defaultAppearance, monoFonts, monospaceFont, parseAppearance, terminalPalettes, terminalTheme } from './appearance.ts';

test('外观设置缺省跟随系统，非法值明确拒绝', () => {
  assert.deepEqual(parseAppearance(null), defaultAppearance);
  assert.throws(() => parseAppearance('{'));
  assert.throws(() => parseAppearance(JSON.stringify({ ...defaultAppearance, monoFont: '__proto__' })));
  assert.throws(() => parseAppearance(JSON.stringify({ ...defaultAppearance, theme: 'unknown' })));
  assert.throws(() => parseAppearance(JSON.stringify({ ...defaultAppearance, terminalPalette: '__proto__' })));
  assert.throws(() => parseAppearance(JSON.stringify({ ...defaultAppearance, terminalLogHighlight: 'false' })));
  assert.throws(() => parseAppearance(JSON.stringify({ ...defaultAppearance, uiZoom: 0 })));
  assert.throws(() => parseAppearance(JSON.stringify({ ...defaultAppearance, uiZoom: '1' })));
  assert.throws(() => parseAppearance(JSON.stringify({ ...defaultAppearance, terminalRenderer: 'unknown' })));
  const settings = { ...defaultAppearance, theme: 'system' as const, terminalPalette: 'light' as const };
  assert.deepEqual(parseAppearance(JSON.stringify(settings)), settings);
});

test('legacy appearance defaults to auto and explicit language survives portable serialization', () => {
  const { language, ...legacy } = defaultAppearance;
  assert.equal(parseAppearance(JSON.stringify(legacy)).language, 'auto');
  for (const language of ['auto', 'en', 'zh-CN'] as const) assert.equal(parseAppearance(JSON.stringify({ ...legacy, language })).language, language);
  for (const language of ['zh-TW', '', null, 42]) assert.throws(() => parseAppearance(JSON.stringify({ ...legacy, language })));
});

test('旧外观设置补全日志高亮偏好，关闭后保留选择', () => {
  const { terminalLogHighlight, uiZoom, terminalRenderer, customMonoFont, ...legacy } = defaultAppearance;
  assert.deepEqual(parseAppearance(JSON.stringify(legacy)), defaultAppearance);
  const disabled = { ...defaultAppearance, terminalLogHighlight: false };
  assert.deepEqual(parseAppearance(JSON.stringify(disabled)), disabled);
});

test('custom local font families survive serialization and retain monospace fallbacks', () => {
  const custom = { ...defaultAppearance, monoFont: 'custom' as const, customMonoFont: 'JetBrainsMono Nerd Font Mono' };
  assert.deepEqual(parseAppearance(JSON.stringify(custom)), custom);
  assert.equal(monospaceFont(custom), `"JetBrainsMono Nerd Font Mono", ${monoFonts.system}`);
  assert.equal(monospaceFont({ ...custom, customMonoFont: '  FiraCode Nerd Font Mono  ' }), `"FiraCode Nerd Font Mono", ${monoFonts.system}`);
  assert.equal(monospaceFont({ ...custom, customMonoFont: '  ' }), monoFonts.system);
  assert.equal(monospaceFont({ ...custom, customMonoFont: 'Font "Mono"' }), `"Font \\"Mono\\"", ${monoFonts.system}`);
  for (const monoFont of Object.keys(monoFonts) as (keyof typeof monoFonts)[]) {
    assert.equal(monospaceFont({ ...custom, monoFont }), monoFonts[monoFont]);
  }
  for (const customMonoFont of [null, 42, [], {}]) assert.throws(() => parseAppearance(JSON.stringify({ ...custom, customMonoFont })));
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
