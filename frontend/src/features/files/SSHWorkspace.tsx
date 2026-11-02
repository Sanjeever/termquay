import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react';
import { Stream } from '@wailsio/runtime';
import { ReadRemoteFile, SaveRemoteFile, CreateTerminal, CloseWorkspace, RegisterWorkspaceView, ReleaseWorkspaceView, SetWorkspaceDirty } from '../../../bindings/github.com/Sanjeever/termquay/appservice';
import type { Document, Entry } from '../../../bindings/github.com/Sanjeever/termquay/internal/files/models';
import TerminalView, { type TerminalAction, type TerminalHandle } from '../terminal/TerminalView';
import CodeEditor from './CodeEditor';
import FileBrowser from './FileBrowser';
import MonitorPanel from '../monitor/MonitorPanel';
import Icon from '../../components/Icon';
import ResizeHandle from '../../components/layout/ResizeHandle';

type Draft = Document & { saved: string; error: string; saving: boolean; needsReview?: boolean };
export type SSHWorkspaceHandle = { saveAll(): Promise<boolean>; prepareReconnect(): Promise<boolean>; showFiles(): void; toggleMonitor(): void; toggleFocus(): void; terminalAction(action: TerminalAction): void };

const SSHWorkspace = forwardRef<SSHWorkspaceHandle, {
  id: string; sessionID: string; visible: boolean; fontSize?: number; onDirtyChange(dirty: boolean): void; onState(state: string): void; onReconnect(): void; busy: boolean;
}>(function SSHWorkspace({ id, sessionID, visible, fontSize = 14, onDirtyChange, onState, onReconnect, busy }, ref) {
  const [error, setError] = useState('');
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [active, setActive] = useState(sessionID);
  const [terminals, setTerminals] = useState([sessionID]);
  const [preparing, setPreparing] = useState(false);
  const [closing, setClosing] = useState('');
  const [rereading, setRereading] = useState('');
  const [creating, setCreating] = useState(false);
  const [filesOpen, setFilesOpen] = useState(localStorage.getItem('termquay.layout.files-open') !== 'false');
  const [filesWidth, setFilesWidth] = useState(Math.max(200, Math.min(420, Number(localStorage.getItem('termquay.layout.files-width') || localStorage.getItem('termquay.layout.sidebar-width')) || 248)));
  const [monitorOpen, setMonitorOpen] = useState(localStorage.getItem('termquay.layout.monitor') === 'true');
  const [focus, setFocus] = useState(false);
  const [narrow, setNarrow] = useState(window.innerWidth <= 1100);
  const [narrowPanel, setNarrowPanel] = useState<'files' | 'monitor' | null>(null);
  const draftsRef = useRef(drafts);
  const disposed = useRef(false);
  const instance = useRef(sessionID); instance.current = sessionID;
  const previousInstance = useRef(sessionID);
  const viewReady = useRef<Promise<void>>();
  const currentDirty = useRef(false);
  const reads = useRef(new Map<string, ReturnType<typeof ReadRemoteFile>>());
  const saves = useRef(new Map<string, Promise<boolean>>());
  const center = useRef<HTMLDivElement>(null);
  const terminalHandles = useRef(new Map<string, TerminalHandle>());
  const filesToggle = useRef<HTMLButtonElement>(null);
  const monitorToggle = useRef<HTMLButtonElement>(null);
  const dirtyCallback = useRef(onDirtyChange); dirtyCallback.current = onDirtyChange;
  const stateCallback = useRef(onState); stateCallback.current = onState;
  const dirty = drafts.some(d => d.content !== d.saved);
  currentDirty.current = dirty;
  const filesShown = !focus && (narrow ? narrowPanel === 'files' : filesOpen);
  const monitorShown = !focus && (narrow ? narrowPanel === 'monitor' : monitorOpen);

  function showFiles() { setFocus(false); if (narrow) setNarrowPanel('files'); else setFilesOpen(true); }
  function toggleFiles() { setFocus(false); if (narrow) setNarrowPanel(prev => prev === 'files' ? null : 'files'); else setFilesOpen(prev => !prev); }
  function toggleMonitor() { setFocus(false); if (narrow) setNarrowPanel(prev => prev === 'monitor' ? null : 'monitor'); else setMonitorOpen(prev => !prev); }
  useEffect(() => { localStorage.setItem('termquay.layout.files-open', String(filesOpen)); }, [filesOpen]);
  useEffect(() => { localStorage.setItem('termquay.layout.files-width', String(filesWidth)); }, [filesWidth]);
  useEffect(() => { localStorage.setItem('termquay.layout.monitor', String(monitorOpen)); }, [monitorOpen]);
  useEffect(() => { const media = window.matchMedia('(max-width: 1100px)'); const update = () => { setNarrow(media.matches); setNarrowPanel(null); }; media.addEventListener('change', update); return () => media.removeEventListener('change', update); }, []);

  function updateDrafts(update: (prev: Draft[]) => Draft[]) { const next = update(draftsRef.current); draftsRef.current = next; setDrafts(next); }
  useEffect(() => {
    disposed.current = false;
    viewReady.current = RegisterWorkspaceView(id);
    viewReady.current.then(()=>{if(disposed.current)ReleaseWorkspaceView(id);}).catch(e=>{if(!disposed.current)setError(String(e));});
    return () => { disposed.current = true; ReleaseWorkspaceView(id).catch(() => {}); };
  }, [id]);
  useEffect(() => {
    let ended = false;
    const owner = Stream('workspace'); owner.onopen = () => { if(ended)return; owner.send(new TextEncoder().encode(sessionID)); setError(''); stateCallback.current('已连接'); }; owner.onclose = () => { if (!ended) { setError('SSH 工作区已断开'); stateCallback.current('已断开'); } };
    if(previousInstance.current !== sessionID){
      previousInstance.current = sessionID; setTerminals(prev=>[...prev,sessionID]); setActive(sessionID);
      updateDrafts(prev=>prev.map(d=>({...d,needsReview:true,error:'连接已更新，正在核对远端版本'})));
      void (async()=>{for(const draft of draftsRef.current){if(ended)return;const request=ReadRemoteFile(sessionID,draft.path);reads.current.set(draft.path,request);try{const current=await request;if(ended)return;updateDrafts(prev=>prev.map(d=>d.path===draft.path?current.content===d.saved?{...d,revision:current.revision,needsReview:false,error:''}:{...d,needsReview:true,error:'远端内容已变化，请对比后合并或重新读取'}:d));}catch(e){if(!ended)updateDrafts(prev=>prev.map(d=>d.path===draft.path?{...d,needsReview:true,error:String(e)}:d));}finally{if(reads.current.get(draft.path)===request)reads.current.delete(draft.path);}}})();
    }
    return () => { ended = true; for (const read of reads.current.values()) read.cancel(); reads.current.clear(); owner.close(); CloseWorkspace(sessionID).catch(() => {}); };
  }, [sessionID]);
  useEffect(() => { dirtyCallback.current(dirty); viewReady.current?.then(()=>{if(!disposed.current)return SetWorkspaceDirty(id,currentDirty.current);}).catch(e => {if(!disposed.current)setError(String(e));}); }, [dirty, id]);
  useEffect(() => { const handler = (event: BeforeUnloadEvent) => { if (draftsRef.current.some(d => d.content !== d.saved)) { event.preventDefault(); event.returnValue = ''; } }; window.addEventListener('beforeunload', handler); return () => window.removeEventListener('beforeunload', handler); }, []);

  async function open(entry: Entry) {
    if (draftsRef.current.some(d => d.path === entry.path)) { setActive(entry.path); return; }
    if (reads.current.has(entry.path)) return;
    if(draftsRef.current.length+reads.current.size>=32)throw new Error('打开文件达到上限（32 个）');
    const request = ReadRemoteFile(sessionID, entry.path); reads.current.set(entry.path, request);
    try { const doc = await request; if (disposed.current || instance.current!==sessionID) return; updateDrafts(prev => [...prev, { ...doc, saved: doc.content, error: '', saving: false }]); setActive(entry.path); }
    finally { if(reads.current.get(entry.path)===request)reads.current.delete(entry.path); }
  }
  async function save(path: string): Promise<boolean> {
    const pending = saves.current.get(path); if (pending) return pending;
    const draft = draftsRef.current.find(d => d.path === path); if (!draft) return true;
    if (draft.content === draft.saved) return true;
    if (draft.needsReview) { updateDrafts(prev=>prev.map(d=>d.path===path?{...d,error:'请先核对最新远端内容，再保存草稿'}:d)); return false; }
    updateDrafts(prev => prev.map(d => d.path === path ? { ...d, saving: true, error: '' } : d));
    const operation = (async () => {
      try {
        const result = await SaveRemoteFile(sessionID, { path, content: draft.content, revision: draft.revision });
        if (disposed.current || instance.current!==sessionID) return false;
        updateDrafts(prev => prev.map(d => d.path === path ? { ...d, saved: result.content, revision: result.revision, saving: false } : d));
        return draftsRef.current.find(d => d.path === path)?.content === result.content;
      } catch (e) { if (!disposed.current) updateDrafts(prev => prev.map(d => d.path === path ? { ...d, saving: false, error: String(e) } : d)); return false; }
      finally { saves.current.delete(path); }
    })();
    saves.current.set(path, operation); return operation;
  }
  useImperativeHandle(ref, () => ({ showFiles, toggleMonitor, terminalAction: action => terminalHandles.current.get(active)?.action(action), toggleFocus: () => setFocus(prev => !prev), async prepareReconnect(){if(terminals.length>=16){setError('保留终端达到上限（16 个），请先关闭结束标签');return false;}if(saves.current.size||creating||preparing){setError('请等待当前保存或终端创建完成');return false;}setPreparing(true);try{await CloseWorkspace(sessionID);return !disposed.current;}finally{setPreparing(false);}}, async saveAll() { for (const draft of draftsRef.current) { if (!await save(draft.path)) { setActive(draft.path); return false; } } return !draftsRef.current.some(d => d.content !== d.saved); } }));

  function close(path: string, discard = false) {
    const draft = draftsRef.current.find(d => d.path === path);
    if (draft?.saving) return;
    if (!discard && draft && draft.content !== draft.saved) { setClosing(path); return; }
    updateDrafts(prev => prev.filter(d => d.path !== path)); if (active === path) setActive(terminals[0] || draftsRef.current[0]?.path || ''); setClosing('');
  }
  async function reread(path: string) {
    setError(''); const request = ReadRemoteFile(sessionID, path); reads.current.set(path, request);
    try { const doc = await request; if (!disposed.current && instance.current===sessionID) { updateDrafts(prev => prev.map(d => d.path === path ? { ...doc, saved: doc.content, saving: false, error: '' } : d)); setRereading(''); } }
    catch (e) { if (!disposed.current && instance.current===sessionID) setError(String(e)); } finally { if(reads.current.get(path)===request)reads.current.delete(path); }
  }
  const closingDraft = drafts.find(d => d.path === closing);
  const tabIDs = [...terminals, ...drafts.map(d => d.path)];
  function activate(path: string) { setActive(path); requestAnimationFrame(() => center.current?.querySelector<HTMLElement>('.terminal-tab:not([hidden]) .xterm-helper-textarea, .editor-tab:not([hidden]) .cm-content')?.focus()); }
  return <div className="ssh-workspace">
    <div className="workspace-toolbar" aria-label="SSH 工作区工具"><button ref={filesToggle} className="session-tool" aria-pressed={filesShown} onClick={toggleFiles}><Icon name="files" width="15" />文件</button><button ref={monitorToggle} className="session-tool" aria-pressed={monitorShown} onClick={toggleMonitor}><Icon name="monitor" width="15" />监控</button><Button size="sm" variant="light" isDisabled={busy||preparing} onPress={onReconnect}>重新连接</Button><button className="icon-button focus-toggle" aria-label="专注模式" title="专注模式" aria-pressed={focus} onClick={() => setFocus(!focus)}><Icon name="focus" width="16" /></button></div>
    <div className="ssh-panels">
    <div className="file-dock" hidden={!filesShown} style={{ width: filesWidth }}><FileBrowser id={sessionID} visible={visible && filesShown} onOpen={open} onClose={() => { toggleFiles(); filesToggle.current?.focus(); }} /></div>
    {filesShown && !narrow && <ResizeHandle label="文件面板宽度" value={filesWidth} min={200} max={420} onChange={setFilesWidth} />}
    <div className="ssh-center" ref={center}>
      <div className="inner-tabs" role="tablist" aria-label="终端与文件" onKeyDown={e => {
        const target = e.target as HTMLElement;
        if (target.getAttribute('role') !== 'tab' || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
        e.preventDefault(); const buttons = e.currentTarget.querySelectorAll<HTMLElement>('[role=tab]'); const index = Array.from(buttons).indexOf(target);
        const next = e.key === 'Home' ? 0 : e.key === 'End' ? tabIDs.length - 1 : (index + (e.key === 'ArrowRight' ? 1 : -1) + tabIDs.length) % tabIDs.length;
        setActive(tabIDs[next]); setTimeout(() => buttons[next]?.focus(), 0);
      }}>
        {terminals.map((terminal, index) => <div key={terminal} className={active === terminal ? 'selected' : ''}><button role="tab" tabIndex={active === terminal ? 0 : -1} aria-selected={active === terminal} onClick={() => activate(terminal)}><Icon name="terminal" width="14" />终端 {index + 1}</button><button aria-label={`关闭终端 ${index + 1}`} onClick={() => { setTerminals(prev => prev.filter(t => t !== terminal)); if (active === terminal) setActive(terminals.find(t => t !== terminal) || drafts[0]?.path || ''); }}><Icon name="close" width="12" /></button></div>)}
        {drafts.map(d => <div key={d.path} className={active === d.path ? 'selected' : ''}><button role="tab" tabIndex={active === d.path ? 0 : -1} aria-selected={active === d.path} title={d.path} onClick={() => activate(d.path)}>{d.path.split('/').pop()}{d.content !== d.saved && <span className="dirty-dot" aria-label="未保存">●</span>}</button><button aria-label={`关闭文件 ${d.path}`} disabled={d.saving} onClick={() => close(d.path)}><Icon name="close" width="12" /></button></div>)}
        <button aria-label="新建终端" disabled={creating||terminals.length>=16} onClick={async () => { setCreating(true); try { const result = await CreateTerminal(sessionID); if (disposed.current || instance.current!==sessionID) return; setTerminals(prev => [...prev, result.id]); setActive(result.id); } catch (e) { setError(String(e)); } finally { setCreating(false); } }}><Icon name="plus" width="15" /></button>
      </div>
      {error && <div className="connection-feedback error" role="alert">{error}</div>}
      {!active && <div className="workspace-empty">从标签栏新建终端或打开文件</div>}
      {terminals.map(terminal => <div className="terminal-tab" hidden={active !== terminal} key={terminal}><TerminalView ref={handle => { if (handle) terminalHandles.current.set(terminal, handle); else terminalHandles.current.delete(terminal); }} id={terminal} visible={visible && active === terminal} fontSize={fontSize} /></div>)}
      {drafts.map(d => <div key={d.path} className="editor-tab" hidden={active !== d.path}>
        <div className="editor-toolbar"><span title={d.path}>{d.path}</span><Button size="sm" isLoading={d.saving} isDisabled={d.content === d.saved} onPress={() => void save(d.path)}>保存</Button></div>
        {d.error && <div className="file-save-error"><p role="alert" className="error">{d.error}</p><div className="button-row"><Button size="sm" variant="light" onPress={() => setRereading(d.path)}>重新读取</Button><Button size="sm" variant="light" onPress={() => { navigator.clipboard.writeText(d.content).catch(e => setError(String(e))); }}>复制草稿</Button></div></div>}
        <CodeEditor path={d.path} content={d.content} visible={visible && active === d.path} onChange={value => updateDrafts(prev => prev.map(item => item.path === d.path ? { ...item, content: value } : item))} onSave={() => void save(d.path)} />
      </div>)}
    </div>
    <MonitorPanel id={sessionID} visible={visible && monitorShown} onClose={() => { toggleMonitor(); monitorToggle.current?.focus(); }} />
    </div>
    <Modal isOpen={!!closingDraft} onClose={() => !closingDraft?.saving && setClosing('')} className="app-dialog"><ModalContent><ModalHeader>保存文件修改？</ModalHeader><ModalBody><p className="file-path">{closing}</p>{closingDraft?.error && <p className="error" role="alert">{closingDraft.error}</p>}</ModalBody><ModalFooter><Button variant="light" isDisabled={closingDraft?.saving} onPress={() => setClosing('')}>取消</Button><Button color="danger" variant="light" isDisabled={closingDraft?.saving} onPress={() => close(closing, true)}>放弃修改</Button><Button color="primary" isLoading={closingDraft?.saving} onPress={async () => { if (await save(closing)) close(closing, true); }}>保存并关闭</Button></ModalFooter></ModalContent></Modal>
    <Modal isOpen={!!rereading} onClose={() => setRereading('')} className="app-dialog"><ModalContent><ModalHeader>重新读取远端文件</ModalHeader><ModalBody><p className="file-path">{rereading}</p><p>将覆盖此文件的本地草稿。请先复制需要保留的内容。</p>{error && <p className="error" role="alert">{error}</p>}</ModalBody><ModalFooter><Button variant="light" onPress={() => setRereading('')}>取消</Button><Button color="danger" onPress={() => void reread(rereading)}>放弃草稿并重新读取</Button></ModalFooter></ModalContent></Modal>
  </div>;
});

export default SSHWorkspace;
