import { errorMessage } from "../../lib/errors";
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Dropdown, DropdownTrigger, DropdownMenu, DropdownSection, DropdownItem } from '@heroui/react';
import Tooltip from '../../components/Tooltip';
import { Compartment, EditorState, StateEffect, StateField, Transaction } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab, undo, redo, undoDepth, redoDepth, invertedEffects } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches, openSearchPanel } from '@codemirror/search';
import { bracketMatching, foldGutter, indentOnInput } from '@codemirror/language';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { diagnosticCount, openLintPanel, setDiagnostics } from '@codemirror/lint';
import { showMinimap } from '@replit/codemirror-minimap';
import Icon from '../../components/Icon';
import { detectEditorLanguage, editorLanguages, loadEditorLanguage, type EditorLanguageID } from './editorLanguage';
import { editorIntelligence, startCompletion } from './editorIntelligence';
import SelectControl from '../../components/SelectControl';
import ErrorNotice from '../../components/ErrorNotice';
import { eventShortcut, shortcutLabel } from '../../lib/shortcuts';
import { useAppearance } from '../settings/AppearanceProvider';
import { editorTheme } from './editorTheme';
import { editorEncodings, type EditorFormat } from './editorFormat';

const changeFormat = StateEffect.define<EditorFormat>();
const formatState = StateField.define<EditorFormat>({ create: () => ({ encoding: 'UTF-8', line_ending: 'LF', bom: false }), update: (value, transaction) => transaction.effects.reduce((current, effect) => effect.is(changeFormat) ? effect.value : current, value), provide: field => [EditorState.readOnly.from(field, value => value.line_ending === 'mixed'), EditorView.editable.from(field, value => value.line_ending !== 'mixed')] });

export default function CodeEditor({ path, content, format, visible, saving, dirty, reloadEpoch = 0, onChange, onSave, onReload, onDownload, focusOnShow = true, jumpTo, demo = false, completionShortcut = 'Alt+Slash' }: {
  path: string; content: string; format: EditorFormat; visible: boolean; saving: boolean; dirty: boolean; reloadEpoch?: number;
  onChange(value: string, format: EditorFormat): void; onSave(): void; onReload(encoding: string): void; onDownload(): void; focusOnShow?: boolean;
  jumpTo?: { line: number; sequence: number };
  demo?: boolean;
  completionShortcut?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>();
  const { appearance, dark } = useAppearance();
  const theme = useRef(new Compartment());
  const map = useRef(new Compartment());
  const wrapping = useRef(new Compartment());
  const language = useRef(new Compartment());
  const intelligence = useRef(new Compartment());
  const syncing = useRef(false);
  const mixedContent = useRef(content);
  function editorContent(state: EditorState) { const format = state.field(formatState); return format.line_ending === 'mixed' ? mixedContent.current : format.line_ending === 'CRLF' ? state.doc.toString().replace(/\n/g, '\r\n') : state.doc.toString(); }
  const [position, setPosition] = useState({ line: 1, column: 1 });
  const [historyState, setHistoryState] = useState({ undo: 0, redo: 0 });
  const [fontSize, setFontSize] = useState(() => Math.max(10, Math.min(24, Number(localStorage.getItem('termquay.editor.font-size')) || 14)));
  const [minimap, setMinimap] = useState(() => localStorage.getItem('termquay.editor.minimap') !== 'false');
  const [wrap, setWrap] = useState(false);
  const [wide, setWide] = useState(false);
  const [error, setError] = useState('');
  const [languageOverride, setLanguageOverride] = useState<EditorLanguageID|'auto'>('auto');
  const [languageError, setLanguageError] = useState('');
  const [diagnosticError, setDiagnosticError] = useState('');
  const [problems, setProblems] = useState(0);
  const [languageEpoch, setLanguageEpoch] = useState(0);
  const [diagnosticEpoch, setDiagnosticEpoch] = useState(0);
  const mode = languageOverride==='auto'?detectEditorLanguage(path,content):languageOverride;
  const callbacks = useRef({ onChange, onSave, completionShortcut }); callbacks.current = { onChange, onSave, completionShortcut };
  useEffect(() => {
    const editor = new EditorView({ parent: host.current!, state: EditorState.create({ doc: content, extensions: [
      formatState.init(() => format), lineNumbers(), history(), drawSelection(), highlightActiveLine(), highlightActiveLineGutter(), bracketMatching(), closeBrackets(), foldGutter(), indentOnInput(), highlightSelectionMatches(), language.current.of([]), intelligence.current.of([]),
      EditorView.domEventHandlers({keydown(event,editor){if(!editor.composing&&!event.isComposing&&callbacks.current.completionShortcut&&eventShortcut(event)===callbacks.current.completionShortcut&&!editor.state.facet(EditorState.readOnly)){event.preventDefault();startCompletion(editor);return true;}return false;}}),
      invertedEffects.of(transaction => transaction.effects.some(effect => effect.is(changeFormat)) ? [changeFormat.of(transaction.startState.field(formatState))] : []),
      keymap.of([{ key: 'Mod-s', run: () => { callbacks.current.onSave(); return true; } }, ...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
      EditorState.phrases.of({ 'Find': '查找', 'Replace': '替换', 'next': '下一个', 'previous': '上一个', 'all': '全部', 'match case': '区分大小写', 'regexp': '正则', 'by word': '全词', 'replace': '替换', 'replace all': '全部替换', 'close': '关闭', 'current match': '当前匹配', 'on line': '所在行' }),
      EditorView.contentAttributes.of({ 'aria-label': `编辑 ${path}`, spellcheck: 'false' }),
      EditorView.updateListener.of(update => {
        const changedFormat = update.transactions.some(transaction => transaction.effects.some(effect => effect.is(changeFormat)));
        if ((update.docChanged || changedFormat) && !syncing.current) callbacks.current.onChange(editorContent(update.state), update.state.field(formatState));
        if (update.docChanged || update.selectionSet) { const head = update.state.selection.main.head; const line = update.state.doc.lineAt(head); setPosition({ line: line.number, column: head - line.from + 1 }); }
        setHistoryState(previous => { const next = { undo: undoDepth(update.state), redo: redoDepth(update.state) }; return next.undo === previous.undo && next.redo === previous.redo ? previous : next; });
        setProblems(diagnosticCount(update.state));
      }), theme.current.of(editorTheme(dark)), map.current.of([]), wrapping.current.of([]),
    ] }) });
    view.current = editor; setHistoryState({ undo: 0, redo: 0 });
    return () => { editor.destroy(); view.current = undefined; };
  }, [path, reloadEpoch]);
  useEffect(()=>{
    const editor=view.current;if(!editor)return;let ended=false;setLanguageError('');
    void loadEditorLanguage(mode).then(extension=>{if(!ended&&view.current===editor)editor.dispatch({effects:language.current.reconfigure(extension)});}).catch(error=>{if(!ended)setLanguageError(errorMessage(error));});
    return()=>{ended=true;};
  },[mode,path,reloadEpoch,languageEpoch]);
  useEffect(()=>{const editor=view.current;if(!editor)return;setDiagnosticError('');if(diagnosticCount(editor.state))editor.dispatch(setDiagnostics(editor.state,[]));editor.dispatch({effects:intelligence.current.reconfigure(editorIntelligence(mode,setDiagnosticError,visible))});},[mode,visible,path,reloadEpoch,diagnosticEpoch]);
  useEffect(() => { view.current?.dispatch({ effects: theme.current.reconfigure(editorTheme(dark)) }); view.current?.requestMeasure(); }, [dark, appearance.monoFont, path, reloadEpoch]);
  useEffect(() => { const observer = new ResizeObserver(([entry]) => setWide(entry.contentRect.width >= 600)); observer.observe(host.current!); return () => observer.disconnect(); }, []);
  useEffect(() => { view.current?.dispatch({ effects: map.current.reconfigure(visible && wide && minimap ? showMinimap.of({ create: () => ({ dom: document.createElement('div') }), displayText: 'blocks', showOverlay: 'always' }) : []) }); }, [visible, wide, minimap, reloadEpoch]);
  useEffect(() => { view.current?.dispatch({ effects: wrapping.current.reconfigure(wrap ? EditorView.lineWrapping : []) }); }, [wrap, reloadEpoch]);
  useEffect(() => {
    const editor = view.current;
    if (!editor || editorContent(editor.state) === content && JSON.stringify(editor.state.field(formatState)) === JSON.stringify(format)) return;
    if (format.line_ending === 'mixed') mixedContent.current = content;
    syncing.current = true;
    try { editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: content }, effects: changeFormat.of(format), annotations: Transaction.addToHistory.of(false) }); }
    finally { syncing.current = false; }
  }, [content, format.encoding, format.line_ending, format.bom]);
  useEffect(() => { if (visible) { view.current?.requestMeasure(); if (focusOnShow && !document.activeElement?.closest('[role=tablist]')) view.current?.focus(); } }, [visible]);
  useEffect(() => { const editor = view.current; if (!editor || !visible || !jumpTo) return; const line = editor.state.doc.line(Math.max(1, Math.min(editor.state.doc.lines, jumpTo.line))); editor.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: 'center' }) }); editor.focus(); }, [jumpTo?.sequence, visible, reloadEpoch]);
  function updateFormat(value: Partial<EditorFormat>) { const editor = view.current; if (editor) { const next = { ...editor.state.field(formatState), ...value }; if (JSON.stringify(next) === JSON.stringify(editor.state.field(formatState))) return; editor.dispatch({ effects: changeFormat.of(next), annotations: Transaction.userEvent.of('input.format') }); editor.focus(); } }
  function preference(key: string, value: string, apply: () => void) { try { if(!demo)localStorage.setItem(key, value); apply(); setError(''); } catch (e) { setError(errorMessage(e)); } }
  function action(label: string, name: Parameters<typeof Icon>[0]['name'], run: () => void, disabled = false) { return <Tooltip content={label}><button type="button" className="icon-button" aria-label={label} disabled={disabled} onClick={run}><Icon name={name} width="16" /></button></Tooltip>; }
  const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';
  return <>
    <div className="editor-toolbar" aria-label="文件编辑工具栏">
      {action(`撤销 · ${mod}Z`, 'undo', () => { if (view.current) undo(view.current); }, !historyState.undo)}
      {action(`重做 · ${mod}Shift+Z`, 'redo', () => { if (view.current) redo(view.current); }, !historyState.redo)}
      <span className="editor-toolbar-divider" />
      {action('重新加载', 'refresh', () => onReload(format.encoding), saving)}
      {action(saving ? '正在保存' : `保存 · ${mod}S`, 'save', onSave, saving || !dirty)}
      {action('下载当前内容', 'download', onDownload, demo)}
      {action(`搜索 · ${mod}F`, 'search', () => { if (view.current) openSearchPanel(view.current); })}
      {action(`触发代码补全 · ${shortcutLabel(completionShortcut)}`, 'terminal', () => {if(view.current){view.current.focus();startCompletion(view.current);}}, format.line_ending==='mixed')}
      <span className="editor-toolbar-divider" />
      {['LF', 'CRLF'].map(value => <button key={value} className="editor-format-button" aria-label={`使用 ${value} 换行符`} aria-pressed={format.line_ending === value} disabled={saving} onClick={() => updateFormat({ line_ending: value })}>{value}</button>)}
      <Dropdown><DropdownTrigger><button className="editor-encoding" aria-label="文件编码" disabled={saving}>{format.encoding}{format.bom && format.encoding === 'UTF-8' ? ' BOM' : ''}<Icon name="chevron" width="11" style={{ transform: 'rotate(90deg)' }} /></button></DropdownTrigger><DropdownMenu aria-label="文件编码操作" onAction={key => { const [mode, encoding] = String(key).split(':'); if (mode === 'open') onReload(encoding); else updateFormat({ encoding, bom: encoding === 'UTF-8' && format.bom }); }}><DropdownSection title="以编码重新打开" showDivider>{editorEncodings.map(([value, label]) => <DropdownItem key={`open:${value}`}>{label}</DropdownItem>)}</DropdownSection><DropdownSection title="以编码保存">{editorEncodings.map(([value, label]) => <DropdownItem key={`save:${value}`}>{label}</DropdownItem>)}</DropdownSection></DropdownMenu></Dropdown>
      <Dropdown><DropdownTrigger><Tooltip content="编辑器视图选项"><button className="icon-button" aria-label="编辑器视图选项"><Icon name="more" width="16" /></button></Tooltip></DropdownTrigger><DropdownMenu aria-label="编辑器视图选项" closeOnSelect={false} disabledKeys={[...(fontSize>=24?['zoomIn']:[]),...(fontSize<=10?['zoomOut']:[])]} onAction={key => { if (key === 'minimap') preference('termquay.editor.minimap', String(!minimap), () => setMinimap(!minimap));else if(key==='wrap')setWrap(!wrap);else{const size=key==='zoomIn'?fontSize+1:fontSize-1;preference('termquay.editor.font-size',String(size),()=>setFontSize(size));} }}><DropdownItem key="minimap" endContent={minimap ? '✓' : null}>代码缩略图</DropdownItem><DropdownItem key="wrap" endContent={wrap ? '✓' : null} showDivider>自动换行</DropdownItem><DropdownItem key="zoomIn">放大字体</DropdownItem><DropdownItem key="zoomOut">缩小字体</DropdownItem></DropdownMenu></Dropdown>
    </div>
    {format.line_ending === 'mixed' && <p className="editor-format-warning">混合换行符，请选择 LF 或 CRLF 后编辑</p>}
    <ErrorNotice message={error} onDismiss={()=>setError('')}/>
    <ErrorNotice message={languageError}><button className="session-tool" onClick={()=>setLanguageEpoch(value=>value+1)}>重新加载语言</button></ErrorNotice>
    <ErrorNotice message={diagnosticError}><button className="session-tool" onClick={()=>setDiagnosticEpoch(value=>value+1)}>重试语法检查</button></ErrorNotice>
    <div className="code-editor" ref={host} style={{ '--editor-font-size': `${fontSize}px` } as CSSProperties} />
    <div className="editor-status"><Tooltip content={path}><span className="editor-path">{path}</span></Tooltip><SelectControl aria-label="编辑语言" value={languageOverride} onChange={event=>setLanguageOverride(event.target.value as EditorLanguageID|'auto')}><option value="auto">{`自动 · ${editorLanguages.find(([id])=>id===mode)?.[1]}`}</option>{editorLanguages.map(([id,name])=><option key={id} value={id}>{name}</option>)}</SelectControl>{problems>0&&<button className="error" onClick={()=>{if(view.current)openLintPanel(view.current);}}>{problems} 个问题</button>}<output aria-label="光标位置">行 {position.line}，列 {position.column}</output><span>{fontSize}px</span></div>
  </>;
}
