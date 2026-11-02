import { EditorView } from '@codemirror/view';

export function editorTheme(dark: boolean) {
  return EditorView.theme({
    '&': { height: '100%', background: 'var(--color-background)', color: 'var(--color-text)', fontSize: '14px' },
    '.cm-scroller': { fontFamily: 'var(--font-mono)', overflow: 'auto', lineHeight: '1.5' },
    '.cm-gutters': { background: 'var(--color-surface)', color: 'var(--color-muted)', borderRight: '1px solid var(--color-border)' },
    '.cm-activeLine': { background: 'var(--color-surface)' },
    '.cm-activeLineGutter': { background: 'var(--color-hover)' },
    '.cm-cursor': { borderLeftColor: 'var(--color-primary)' },
    '.cm-selectionBackground': { background: 'var(--color-selected) !important' },
    '.cm-panels': { background: 'var(--color-elevated)', color: 'var(--color-text)' },
    '.cm-selectionMatch': { background: 'var(--color-selected)' },
    '.cm-search': { padding: '6px 8px', fontFamily: 'var(--font-ui)', fontSize: '12px' },
    '.cm-search input, .cm-search button': { borderRadius: '4px', padding: '3px 6px' },
  }, { dark });
}
