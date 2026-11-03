import { appearanceKey, parseAppearance } from './appearance';
import { mergeShortcuts, shortcutConflict, shortcutDefinitions, shortcutStorageKey } from '../../lib/shortcuts';

export function capturePortableUI(): Record<string, string> {
  const shortcuts = mergeShortcuts(JSON.parse(localStorage.getItem(shortcutStorageKey) || '{}'));
  for (const definition of shortcutDefinitions) if (typeof shortcuts[definition.id] !== 'string' || shortcutConflict(definition.id, shortcuts[definition.id], shortcuts)) throw new Error('快捷键配置无效，请在设置中复位');
  return { appearance: JSON.stringify(parseAppearance(localStorage.getItem(appearanceKey))), shortcuts: JSON.stringify(shortcuts) };
}

export function applyPortableUI(values: Record<string, string | undefined> | null) {
  const appearance = values?.appearance ? parseAppearance(values.appearance) : undefined;
  const shortcuts = values?.shortcuts ? mergeShortcuts(JSON.parse(values.shortcuts)) : undefined;
  if (shortcuts) for (const definition of shortcutDefinitions) if (typeof shortcuts[definition.id] !== 'string' || shortcutConflict(definition.id, shortcuts[definition.id], shortcuts)) throw new Error('快照快捷键配置无效');
  if (appearance) localStorage.setItem(appearanceKey, JSON.stringify(appearance));
  if (shortcuts) localStorage.setItem(shortcutStorageKey, JSON.stringify(shortcuts));
  window.dispatchEvent(new Event('termquay:portable-restored'));
}
