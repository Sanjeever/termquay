const mac = /Mac|iPhone|iPad/.test(navigator.platform);

export const shortcutDefinitions = [
  { id: 'palette', label: '命令搜索', scope: 'app', key: 'Mod+Shift+KeyP' },
  { id: 'settings', label: '打开设置', scope: 'app', key: mac ? 'Mod+Comma' : 'Mod+Shift+Comma' },
  { id: 'newConnection', label: '新建连接', scope: 'app', key: 'Mod+KeyN' },
  { id: 'closeTab', label: '关闭当前标签', scope: 'app', key: 'Mod+KeyW' },
  { id: 'closeWorkspace', label: '关闭当前工作区', scope: 'app', key: 'Mod+Shift+KeyW' },
  { id: 'nextWorkspace', label: '下一个工作区', scope: 'app', key: 'Mod+Shift+BracketRight' },
  { id: 'previousWorkspace', label: '上一个工作区', scope: 'app', key: 'Mod+Shift+BracketLeft' },
  { id: 'switchPane', label: '切换窗格', scope: 'workspace', key: 'Mod+Alt+Backslash' },
  { id: 'closeContent', label: '关闭当前终端或文件', scope: 'workspace', key: 'Mod+Alt+KeyW' },
  { id: 'newTerminal', label: '新建终端', scope: 'app', key: mac ? 'Mod+KeyT' : 'Mod+Alt+KeyT' },
  { id: 'find', label: '终端查找', scope: 'terminal', key: mac ? 'Mod+KeyF' : 'Mod+Shift+KeyF' },
  { id: 'copy', label: '复制终端选择', scope: 'terminal', key: mac ? 'Mod+KeyC' : 'Mod+Shift+KeyC' },
  { id: 'paste', label: '粘贴到终端', scope: 'terminal', key: mac ? 'Mod+KeyV' : 'Mod+Shift+KeyV' },
  { id: 'clear', label: '清空终端显示', scope: 'terminal', key: 'Mod+Shift+KeyL' },
  { id: 'selectAll', label: '全选终端', scope: 'terminal', key: '' },
  { id: 'zoomIn', label: '放大终端字号', scope: 'terminal', key: '' },
  { id: 'zoomOut', label: '缩小终端字号', scope: 'terminal', key: '' },
  { id: 'zoomReset', label: '复位终端字号', scope: 'terminal', key: '' },
  { id: 'completion', label: '触发代码补全', scope: 'editor', key: 'Alt+Slash' },
] as const;
export type ShortcutID = typeof shortcutDefinitions[number]['id'];
export type Shortcuts = Record<ShortcutID, string>;
export const defaultShortcuts = Object.fromEntries(shortcutDefinitions.map(d => [d.id, d.key])) as Shortcuts;
export const shortcutStorageKey = 'termquay.shortcuts';
export function mergeShortcuts(stored: Partial<Shortcuts>): Shortcuts {
  const values = { ...defaultShortcuts, ...stored };
  const assigned = new Set(Object.values(stored));
  for (const d of shortcutDefinitions) { if (Object.prototype.hasOwnProperty.call(stored, d.id)) continue; values[d.id] = assigned.has(d.key) ? '' : d.key; if (values[d.id]) assigned.add(values[d.id]); }
  return values;
}
export function eventShortcut(event: KeyboardEvent): string {
  if (event.isComposing || event.key === 'Process' || event.getModifierState('AltGraph') || !/^(Key[A-Z]|Digit[0-9]|Comma|Period|Slash|Backslash|Semicolon|Quote|BracketLeft|BracketRight|Minus|Equal|Tab|ArrowLeft|ArrowRight|ArrowUp|ArrowDown|F[1-9]|F1[0-2])$/.test(event.code)) return '';
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  if ((mac ? event.ctrlKey : event.metaKey) || !(event.ctrlKey || event.metaKey || event.altKey)) return '';
  return [event.ctrlKey || event.metaKey ? 'Mod' : '', event.altKey ? 'Alt' : '', event.shiftKey ? 'Shift' : '', event.code].filter(Boolean).join('+');
}
export function shortcutLabel(key: string) {
  const labels: Record<string,string> = { Mod: mac ? '⌘' : 'Ctrl', Alt: mac ? '⌥' : 'Alt', Shift: mac ? '⇧' : 'Shift', Comma: ',', Period: '.', Minus: '-', Equal: '=', Backslash: '\\', Slash: '/', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓' };
  return key.split('+').map(part=>labels[part] || part.replace(/^(Key|Digit)/,'')).join(mac ? '' : '+') || '未分配';
}
export function shortcutConflict(id: ShortcutID, key: string, values: Shortcuts): string {
  if (!key) return '';
  const other = shortcutDefinitions.find(d => d.id !== id && values[d.id] === key);
  if (other) return `与“${other.label}”冲突`;
  const assignedInput: Partial<Record<ShortcutID,string>> = { closeTab: 'Mod+KeyW', closeWorkspace: 'Mod+Shift+KeyW', copy: 'Mod+KeyC', paste: 'Mod+KeyV', find: 'Mod+KeyF' };
  if ((/^Mod\+(Key[ACFVXYZS]|KeyW|KeyQ|Tab|Arrow\w+)$/.test(key) || /^(Alt\+(Tab|F4)|Mod\+Alt\+Tab|Mod\+Shift\+KeyW)$/.test(key)) && assignedInput[id] !== key) return '此组合保留给输入组件或系统';
  return '';
}
