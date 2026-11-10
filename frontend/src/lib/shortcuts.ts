import { t as translate } from '../i18n/index.ts';
const mac = /Mac|iPhone|iPad/.test(navigator.platform);

export const shortcutDefinitions = [
  {
    id: 'palette',
    get label() {
      return translate('common:commandSearch2');
    },
    scope: 'app',
    key: 'Mod+Shift+KeyP',
  },
  {
    id: 'settings',
    get label() {
      return translate('common:openSettings');
    },
    scope: 'app',
    key: mac ? 'Mod+Comma' : 'Mod+Shift+Comma',
  },
  {
    id: 'newConnection',
    get label() {
      return translate('common:newConnection');
    },
    scope: 'app',
    key: 'Mod+KeyN',
  },
  {
    id: 'closeTab',
    get label() {
      return translate('common:closeCurrentTab');
    },
    scope: 'app',
    key: 'Mod+KeyW',
  },
  {
    id: 'closeWorkspace',
    get label() {
      return translate('common:closeCurrentWorkspace');
    },
    scope: 'app',
    key: 'Mod+Shift+KeyW',
  },
  {
    id: 'nextWorkspace',
    get label() {
      return translate('common:nextWorkspace');
    },
    scope: 'app',
    key: 'Mod+Shift+BracketRight',
  },
  {
    id: 'previousWorkspace',
    get label() {
      return translate('common:previousWorkspace');
    },
    scope: 'app',
    key: 'Mod+Shift+BracketLeft',
  },
  {
    id: 'switchPane',
    get label() {
      return translate('common:switchPane');
    },
    scope: 'workspace',
    key: 'Mod+Alt+Backslash',
  },
  {
    id: 'closeContent',
    get label() {
      return translate('common:closeCurrentTerminalOrFile');
    },
    scope: 'workspace',
    key: 'Mod+Alt+KeyW',
  },
  {
    id: 'newTerminal',
    get label() {
      return translate('common:newTerminal');
    },
    scope: 'app',
    key: mac ? 'Mod+KeyT' : 'Mod+Alt+KeyT',
  },
  {
    id: 'find',
    get label() {
      return translate('common:findInTerminal');
    },
    scope: 'terminal',
    key: mac ? 'Mod+KeyF' : 'Mod+Shift+KeyF',
  },
  {
    id: 'terminalCompletion',
    get label() {
      return translate('common:triggerTerminalCompletion');
    },
    scope: 'terminal',
    key: 'Alt+Slash',
  },
  {
    id: 'commandHelp',
    get label() {
      return translate('common:pOSIXCommandReference');
    },
    scope: 'terminal',
    key: '',
  },
  {
    id: 'copy',
    get label() {
      return translate('common:copyTerminalSelection');
    },
    scope: 'terminal',
    key: mac ? 'Mod+KeyC' : 'Mod+Shift+KeyC',
  },
  {
    id: 'paste',
    get label() {
      return translate('common:pasteIntoTerminal');
    },
    scope: 'terminal',
    key: mac ? 'Mod+KeyV' : 'Mod+Shift+KeyV',
  },
  {
    id: 'clear',
    get label() {
      return translate('common:clearTerminalDisplay');
    },
    scope: 'terminal',
    key: 'Mod+Shift+KeyL',
  },
  {
    id: 'selectAll',
    get label() {
      return translate('common:selectAllInTerminal');
    },
    scope: 'terminal',
    key: '',
  },
  {
    id: 'zoomIn',
    get label() {
      return translate('common:increaseTerminalFontSize');
    },
    scope: 'terminal',
    key: '',
  },
  {
    id: 'zoomOut',
    get label() {
      return translate('common:decreaseTerminalFontSize');
    },
    scope: 'terminal',
    key: '',
  },
  {
    id: 'zoomReset',
    get label() {
      return translate('common:resetTerminalFontSize');
    },
    scope: 'terminal',
    key: '',
  },
  {
    id: 'completion',
    get label() {
      return translate('common:triggerCodeCompletion');
    },
    scope: 'editor',
    key: 'Alt+Slash',
  },
] as const;
export type ShortcutID = (typeof shortcutDefinitions)[number]['id'];
export type Shortcuts = Record<ShortcutID, string>;
export const defaultShortcuts = Object.fromEntries(
  shortcutDefinitions.map((d) => [d.id, d.key]),
) as Shortcuts;
export const shortcutStorageKey = 'termquay.shortcuts';
export function mergeShortcuts(stored: Partial<Shortcuts>): Shortcuts {
  const values = { ...defaultShortcuts, ...stored };
  const assigned = shortcutDefinitions.filter((d) =>
    Object.prototype.hasOwnProperty.call(stored, d.id),
  );
  for (const d of shortcutDefinitions) {
    if (Object.prototype.hasOwnProperty.call(stored, d.id)) continue;
    values[d.id] = assigned.some(
      (other) => values[other.id] === d.key && overlappingScopes(other.scope, d.scope),
    )
      ? ''
      : d.key;
    if (values[d.id]) assigned.push(d);
  }
  return values;
}
function overlappingScopes(first: string, second: string) {
  return (
    first === second ||
    first === 'app' ||
    second === 'app' ||
    first === 'workspace' ||
    second === 'workspace'
  );
}
export function eventShortcut(event: KeyboardEvent): string {
  if (
    event.isComposing ||
    event.key === 'Process' ||
    event.getModifierState('AltGraph') ||
    !/^(Key[A-Z]|Digit[0-9]|Comma|Period|Slash|Backslash|Semicolon|Quote|BracketLeft|BracketRight|Minus|Equal|Tab|ArrowLeft|ArrowRight|ArrowUp|ArrowDown|F[1-9]|F1[0-2])$/.test(
      event.code,
    )
  )
    return '';
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  if ((mac ? event.ctrlKey : event.metaKey) || !(event.ctrlKey || event.metaKey || event.altKey))
    return '';
  return [
    event.ctrlKey || event.metaKey ? 'Mod' : '',
    event.altKey ? 'Alt' : '',
    event.shiftKey ? 'Shift' : '',
    event.code,
  ]
    .filter(Boolean)
    .join('+');
}
export function shortcutLabel(key: string) {
  const labels: Record<string, string> = {
    Mod: mac ? '⌘' : 'Ctrl',
    Alt: mac ? '⌥' : 'Alt',
    Shift: mac ? '⇧' : 'Shift',
    Comma: ',',
    Period: '.',
    Minus: '-',
    Equal: '=',
    Backslash: '\\',
    Slash: '/',
    BracketLeft: '[',
    BracketRight: ']',
    Semicolon: ';',
    Quote: "'",
    ArrowLeft: '←',
    ArrowRight: '→',
    ArrowUp: '↑',
    ArrowDown: '↓',
  };
  return (
    key
      .split('+')
      .map((part) => labels[part] || part.replace(/^(Key|Digit)/, ''))
      .join(mac ? '' : '+') || translate('common:unassigned')
  );
}
export function shortcutConflict(id: ShortcutID, key: string, values: Shortcuts): string {
  if (!key) return '';
  const scope = shortcutDefinitions.find((d) => d.id === id)!.scope;
  const other = shortcutDefinitions.find(
    (d) => d.id !== id && values[d.id] === key && overlappingScopes(d.scope, scope),
  );
  if (other) return translate('common:conflictsWith', { value1: other.label });
  const assignedInput: Partial<Record<ShortcutID, string>> = {
    closeTab: 'Mod+KeyW',
    closeWorkspace: 'Mod+Shift+KeyW',
    copy: 'Mod+KeyC',
    paste: 'Mod+KeyV',
    find: 'Mod+KeyF',
  };
  if (
    (/^Mod\+(Key[ACFVXYZS]|KeyW|KeyQ|Tab|Arrow\w+)$/.test(key) ||
      /^(Alt\+(Tab|F4)|Mod\+Alt\+Tab|Mod\+Shift\+KeyW)$/.test(key)) &&
    assignedInput[id] !== key
  )
    return translate('common:thisShortcutIsReservedForInputsOrThe');
  return '';
}
