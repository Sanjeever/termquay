import { useEffect, useRef, useState } from 'react';
import { Compartment, EditorState, Transaction } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches, openSearchPanel } from '@codemirror/search';
import { bracketMatching, defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { editorLanguage } from './editorLanguage';
import { useAppearance } from '../settings/AppearanceProvider';
import { editorTheme } from './editorTheme';

export default function CodeEditor({ path, content, visible, onChange, onSave, focusOnShow=true }: { path: string; content: string; visible: boolean; onChange(value: string): void; onSave(): void; focusOnShow?:boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>();
  const { appearance, dark } = useAppearance();
  const theme = useRef(new Compartment());
  const syncing = useRef(false);
  const [position,setPosition]=useState({line:1,column:1});
  const callbacks = useRef({ onChange, onSave }); callbacks.current = { onChange, onSave };
  useEffect(() => {
    const language = editorLanguage(path);
    const editor = new EditorView({ parent: host.current!, state: EditorState.create({ doc: content, extensions: [
      EditorView.lineWrapping, lineNumbers(), history(), drawSelection(), highlightActiveLine(), bracketMatching(), highlightSelectionMatches(), syntaxHighlighting(defaultHighlightStyle), language,
      keymap.of([{ key: 'Mod-s', run: () => { callbacks.current.onSave(); return true; } }, ...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
      EditorState.phrases.of({ 'Find': '查找', 'Replace': '替换', 'next': '下一个', 'previous': '上一个', 'all': '全部', 'match case': '区分大小写', 'regexp': '正则', 'by word': '全词', 'replace': '替换', 'replace all': '全部替换', 'close': '关闭', 'current match': '当前匹配', 'on line': '所在行' }),
      EditorView.updateListener.of((update) => { if (update.docChanged && !syncing.current) callbacks.current.onChange(update.state.doc.toString()); if(update.docChanged||update.selectionSet){const head=update.state.selection.main.head;const line=update.state.doc.lineAt(head);const column=head-line.from+1;setPosition(prev=>prev.line===line.number&&prev.column===column?prev:{line:line.number,column});} }),
      theme.current.of(editorTheme(dark)),
    ] }) }); view.current = editor;
    return () => { editor.destroy(); view.current = undefined; };
  }, [path]);
  useEffect(() => { view.current?.dispatch({ effects: theme.current.reconfigure(editorTheme(dark)) }); view.current?.requestMeasure(); }, [dark, appearance.monoFont, path]);
  useEffect(() => {
    const editor = view.current;
    if (!editor || editor.state.doc.toString() === content) return;
    syncing.current = true;
    try { editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: content }, annotations: Transaction.addToHistory.of(false) }); }
    finally { syncing.current = false; }
  }, [content]);
  useEffect(() => { if (visible) { view.current?.requestMeasure(); if (focusOnShow&&!document.activeElement?.closest('[role=tablist]')) view.current?.focus(); } }, [visible]);
  return <><div className="code-editor" ref={host} /><div className="editor-status"><output aria-label="光标位置">行 {position.line}，列 {position.column}</output><button onClick={()=>{if(view.current)openSearchPanel(view.current);}}>查找 / 替换</button></div></>;
}
