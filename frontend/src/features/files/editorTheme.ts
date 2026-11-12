import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';

export function editorTheme(dark: boolean) {
  return [
    EditorView.theme(
      {
        '&': {
          height: '100%',
          background: 'var(--color-background)',
          color: 'var(--color-text)',
          fontSize: 'var(--editor-font-size, 14px)',
        },
        '.cm-scroller': { fontFamily: 'var(--font-mono)', overflow: 'auto', lineHeight: '1.5' },
        '.cm-gutters': {
          background: 'var(--color-surface)',
          color: 'var(--color-muted)',
          borderRight: '1px solid var(--color-border)',
        },
        '.cm-activeLine': { background: 'var(--color-selection-muted)' },
        '.cm-activeLineGutter': { background: 'var(--color-hover)' },
        '.cm-cursor': { borderLeftColor: 'var(--color-primary)' },
        '.cm-selectionBackground': { background: 'var(--color-selected) !important' },
        '.cm-panels': { background: 'var(--color-elevated)', color: 'var(--color-text)' },
        '.cm-selectionMatch': { background: 'var(--color-selected)' },
        '.cm-search': { padding: '6px 8px', fontFamily: 'var(--font-ui)', fontSize: '12px' },
        '.cm-search input, .cm-search button': { borderRadius: '4px', padding: '3px 6px' },
        '.cm-content': { padding: '8px 0', caretColor: 'var(--color-primary)' },
        '.cm-line': { padding: '0 12px' },
        '.cm-foldGutter': { width: '14px' },
        '.cm-minimap-gutter': {
          background: 'var(--color-background)',
          borderLeft: '1px solid var(--color-border)',
        },
        '.cm-tooltip': {
          background: 'var(--color-elevated)',
          color: 'var(--color-text)',
          border: '1px solid var(--color-border-strong)',
          borderRadius: '6px',
        },
        '.cm-tooltip-autocomplete ul li[aria-selected=true]': {
          background: 'var(--color-selected)',
          color: 'var(--color-text)',
        },
        '.cm-completionInfo,.editor-word-help': {
          padding: '8px 10px',
          maxWidth: '360px',
          fontFamily: 'var(--font-ui)',
          fontSize: '12px',
        },
        '.cm-diagnostic-error': { borderLeftColor: 'var(--color-danger)' },
        '.cm-diagnostic-warning': { borderLeftColor: 'var(--color-warning)' },
        '.cm-panel-lint': {
          background: 'var(--color-surface)',
          color: 'var(--color-text)',
          maxHeight: '160px',
        },
      },
      { dark },
    ),
    syntaxHighlighting(
      HighlightStyle.define([
        { tag: tags.keyword, color: dark ? '#c586c0' : '#8a287b' },
        { tag: [tags.propertyName, tags.attributeName], color: dark ? '#9cdcfe' : '#0451a5' },
        { tag: [tags.string, tags.special(tags.string)], color: dark ? '#ce9178' : '#a31515' },
        { tag: [tags.number, tags.bool, tags.null], color: dark ? '#b5cea8' : '#096b30' },
        { tag: tags.comment, color: dark ? '#7f9f72' : '#557747', fontStyle: 'italic' },
        {
          tag: [tags.function(tags.variableName), tags.labelName],
          color: dark ? '#dcdcaa' : '#795e26',
        },
        { tag: [tags.typeName, tags.className], color: dark ? '#4ec9b0' : '#267f99' },
        { tag: [tags.operator, tags.punctuation], color: dark ? '#c8ccd4' : '#434b59' },
        { tag: tags.meta, color: dark ? '#d7ba7d' : '#795e26' },
        {
          tag: tags.invalid,
          color: dark ? '#ffaaaa' : '#a52131',
          textDecoration: 'underline wavy',
        },
      ]),
    ),
  ];
}
