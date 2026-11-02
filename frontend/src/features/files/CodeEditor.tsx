import { useEffect, useRef } from 'react';
import { EditorState, Transaction } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { bracketMatching, defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { json } from '@codemirror/lang-json';
import { yaml } from '@codemirror/lang-yaml';
import { javascript } from '@codemirror/lang-javascript';

export default function CodeEditor({ path, content, visible, onChange, onSave }: { path: string; content: string; visible: boolean; onChange(value: string): void; onSave(): void }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>();
  const syncing = useRef(false);
  const callbacks = useRef({ onChange, onSave }); callbacks.current = { onChange, onSave };
  useEffect(() => {
    const language = /\.json$/i.test(path) ? json() : /\.ya?ml$/i.test(path) ? yaml() : /\.[cm]?[jt]sx?$/i.test(path) ? javascript({ typescript: /\.tsx?$/.test(path) }) : [];
    const editor = new EditorView({ parent: host.current!, state: EditorState.create({ doc: content, extensions: [
      lineNumbers(), history(), drawSelection(), highlightActiveLine(), bracketMatching(), highlightSelectionMatches(), syntaxHighlighting(defaultHighlightStyle), language,
      keymap.of([{ key: 'Mod-s', run: () => { callbacks.current.onSave(); return true; } }, ...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
      EditorView.updateListener.of((update) => { if (update.docChanged && !syncing.current) callbacks.current.onChange(update.state.doc.toString()); }),
      EditorView.theme({ '&': { height: '100%', background: 'var(--color-background)', color: 'var(--color-text)', fontSize: '14px' }, '.cm-scroller': { fontFamily: 'var(--font-mono)', overflow: 'auto', lineHeight: '1.5' }, '.cm-gutters': { background: 'var(--color-surface)', color: 'var(--color-muted)', borderRight: '1px solid var(--color-border)' }, '.cm-activeLine': { background: 'var(--color-surface)' }, '.cm-activeLineGutter': { background: 'var(--color-hover)' }, '.cm-cursor': { borderLeftColor: 'var(--color-primary)' }, '.cm-selectionBackground': { background: 'var(--color-selected) !important' } }, { dark: true }),
    ] }) }); view.current = editor;
    return () => { editor.destroy(); view.current = undefined; };
  }, [path]);
  useEffect(() => {
    const editor = view.current;
    if (!editor || editor.state.doc.toString() === content) return;
    syncing.current = true;
    try { editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: content }, annotations: Transaction.addToHistory.of(false) }); }
    finally { syncing.current = false; }
  }, [content]);
  useEffect(() => { if (visible) { view.current?.requestMeasure(); view.current?.focus(); } }, [visible]);
  return <div className="code-editor" ref={host} />;
}
