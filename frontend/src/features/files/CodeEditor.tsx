import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { bracketMatching, defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { json } from '@codemirror/lang-json';
import { yaml } from '@codemirror/lang-yaml';
import { javascript } from '@codemirror/lang-javascript';

export default function CodeEditor({ path, content, onChange, onSave }: { path: string; content: string; onChange(value: string): void; onSave(): void }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>();
  const callbacks = useRef({ onChange, onSave }); callbacks.current = { onChange, onSave };
  useEffect(() => {
    const language = /\.json$/i.test(path) ? json() : /\.ya?ml$/i.test(path) ? yaml() : /\.[cm]?[jt]sx?$/i.test(path) ? javascript({ typescript: /\.tsx?$/.test(path) }) : [];
    const editor = new EditorView({ parent: host.current!, state: EditorState.create({ doc: content, extensions: [
      lineNumbers(), history(), drawSelection(), highlightActiveLine(), bracketMatching(), highlightSelectionMatches(), syntaxHighlighting(defaultHighlightStyle), language,
      keymap.of([{ key: 'Mod-s', run: () => { callbacks.current.onSave(); return true; } }, ...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
      EditorView.updateListener.of((update) => { if (update.docChanged) callbacks.current.onChange(update.state.doc.toString()); }),
      EditorView.theme({ '&': { height: '100%', background: '#121418', color: '#d7dce2', fontSize: '13px' }, '.cm-scroller': { fontFamily: '"SFMono-Regular", Consolas, monospace', overflow: 'auto' }, '.cm-gutters': { background: '#181b20', color: '#626e7d', borderRight: '1px solid #2a2e35' }, '.cm-activeLine': { background: '#1b2028' }, '.cm-activeLineGutter': { background: '#242a34' }, '.cm-cursor': { borderLeftColor: '#8fc6b4' }, '.cm-selectionBackground': { background: '#344c50 !important' } }, { dark: true }),
    ] }) }); view.current = editor;
    return () => { editor.destroy(); view.current = undefined; };
  }, [path]);
  return <div className="code-editor" ref={host} />;
}
