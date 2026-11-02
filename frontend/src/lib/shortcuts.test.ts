import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { defaultShortcuts, eventShortcut, shortcutConflict, mergeShortcuts } from './shortcuts.ts';

function key(overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return { code: 'KeyP', key: 'P', ctrlKey: true, metaKey: false, shiftKey: true, altKey: false, isComposing: false, getModifierState: () => false, ...overrides } as KeyboardEvent;
}
test('组合输入和 AltGr 不触发应用动作', () => {
  assert.equal(eventShortcut(key({ isComposing: true })), '');
  assert.equal(eventShortcut(key({ key: 'Process' })), '');
  assert.equal(eventShortcut(key({ getModifierState: name => name === 'AltGraph' })), '');
});
test('平台修饰键和物理键位保持一致', () => {
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  assert.equal(eventShortcut(key({ ctrlKey: !mac, metaKey: mac })), 'Mod+Shift+KeyP');
  assert.equal(eventShortcut(key({ ctrlKey: false, metaKey: false, shiftKey: false })), '');
  assert.equal(eventShortcut(key({ ctrlKey: mac, metaKey: !mac })), '');
});
test('冲突不能覆盖其他动作和基本输入按键', () => {
  assert.match(shortcutConflict('palette', defaultShortcuts.find, defaultShortcuts), /冲突/);
  assert.match(shortcutConflict('palette', 'Mod+KeyC', defaultShortcuts), /保留/);
  assert.equal(shortcutConflict('palette', '', defaultShortcuts), '');
  assert.equal(shortcutConflict('palette', defaultShortcuts.palette, defaultShortcuts), '');
});
test('旧配置保留自定义键位，新增动作避让已使用键位', () => {
  const values = mergeShortcuts({ palette: defaultShortcuts.newTerminal, find: '' });
  assert.equal(values.palette, defaultShortcuts.newTerminal);
  assert.equal(values.newTerminal, '');
  assert.equal(values.find, '');
  assert.equal(values.switchPane, defaultShortcuts.switchPane);
});
test('方向键与 Tab 可解析，系统组合仍拒绝', () => {
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  assert.equal(eventShortcut(key({ code: 'ArrowRight', key: 'ArrowRight', ctrlKey: !mac, metaKey: mac })), 'Mod+Shift+ArrowRight');
  assert.equal(eventShortcut(key({ code: 'Tab', key: 'Tab', ctrlKey: false, metaKey: false, altKey: true, shiftKey: false })), 'Alt+Tab');
  assert.match(shortcutConflict('nextWorkspace', 'Alt+Tab', defaultShortcuts), /保留/);
});
