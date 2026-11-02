import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Button, Dropdown, DropdownTrigger, DropdownMenu, DropdownItem, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react';
import { Stream } from '@wailsio/runtime';
import { ReadRemoteFile, SaveRemoteFile, CreateTerminal, CloseWorkspace, RegisterWorkspaceView, ReleaseWorkspaceView, SetWorkspaceDirty } from '../../../bindings/github.com/Sanjeever/termquay/appservice';
import type { Document, Entry } from '../../../bindings/github.com/Sanjeever/termquay/internal/files/models';
import TerminalView, { type TerminalAction, type TerminalHandle } from '../terminal/TerminalView';
import CodeEditor from './CodeEditor';
import FileBrowser from './FileBrowser';
import MonitorPanel from '../monitor/MonitorPanel';
import Icon from '../../components/Icon';
import ResizeHandle from '../../components/layout/ResizeHandle';
import FileConflictView from './FileConflictView';
import WorkspacePanes from './WorkspacePanes';

type Draft = Document & { saved: string; error: string; saving: boolean; needsReview?: boolean };
export type SSHWorkspaceHandle = { focus(): void; saveAll(): Promise<boolean>; prepareReconnect(): Promise<boolean>; showFiles(): void; toggleMonitor(): void; toggleFocus(): void; terminalAction(action: TerminalAction): void };

const SSHWorkspace = forwardRef<SSHWorkspaceHandle, {
  id: string; sessionID: string; connectionID: string; visible: boolean; fontSize?: number; onDirtyChange(dirty: boolean): void; onState(state: string): void; onReconnect(): void; busy: boolean;
}>(function SSHWorkspace({ id, sessionID, connectionID, visible, fontSize = 14, onDirtyChange, onState, onReconnect, busy }, ref) {
  const [error, setError] = useState('');
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [selection,setSelection]=useState<[string,string]>([sessionID,'']);
  const [activePane,setActivePane]=useState(0);
  const [secondary,setSecondary]=useState<string[]>([]);
  const [split,setSplit]=useState(false);
  const [maximized,setMaximized]=useState(false);
  const [ratio,setRatio]=useState(50);
  const [terminals, setTerminals] = useState([sessionID]);
  const [preparing, setPreparing] = useState(false);
  const [closing, setClosing] = useState('');
  const [rereading, setRereading] = useState('');
  const [conflict, setConflict] = useState('');
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
  const tabIDs=[...terminals,...drafts.map(d=>d.path)];
  const paneFor=(path:string)=>split&&secondary.includes(path)?1:0;
  const paneSelected=selection.map((path,pane)=>tabIDs.includes(path)&&paneFor(path)===pane?path:tabIDs.find(t=>paneFor(t)===pane)||'');
  const active=paneSelected[activePane];
  useEffect(()=>{if(!paneSelected[activePane]&&paneSelected[1-activePane])setActivePane(1-activePane);},[paneSelected[0],paneSelected[1],activePane]);
  function setActive(path:string){const pane=paneFor(path);setActivePane(pane);setSelection(prev=>pane===0?[path,prev[1]]:[prev[0],path]);}
  function shown(path:string){return path===paneSelected[paneFor(path)]&&(!maximized||paneFor(path)===activePane);}
  function focusTab(path=active){center.current?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(path)}"] .terminal-search > input, [data-tab-id="${CSS.escape(path)}"] .xterm-helper-textarea, [data-tab-id="${CSS.escape(path)}"] .cm-content`)?.focus();}
  function moveActive(){if(!active)return;const target=1-paneFor(active);setSplit(true);setMaximized(false);setSecondary(prev=>target===1?[...prev,active]:prev.filter(p=>p!==active));setSelection(prev=>target===0?[active,prev[1]]:[prev[0],active]);setActivePane(target);requestAnimationFrame(()=>focusTab(active));}
  async function newTerminal(pane=activePane){if(creating||terminals.length>=16)return;setCreating(true);try{const result=await CreateTerminal(sessionID);if(disposed.current||instance.current!==sessionID)return;setTerminals(prev=>[...prev,result.id]);if(pane===1){setSplit(true);setSecondary(prev=>[...prev,result.id]);}setSelection(prev=>pane===0?[result.id,prev[1]]:[prev[0],result.id]);setActivePane(pane);setMaximized(false);}catch(e){setError(String(e));}finally{setCreating(false);}}

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
    try { const doc = await request; if (disposed.current || instance.current!==sessionID) return; updateDrafts(prev => [...prev, { ...doc, saved: doc.content, error: '', saving: false }]); if(split&&activePane===1){setSecondary(prev=>[...prev,entry.path]);setSelection(prev=>[prev[0],entry.path]);}else setActive(entry.path); }
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
  useImperativeHandle(ref, () => ({ focus:()=>focusTab(), showFiles, toggleMonitor, terminalAction: action => terminalHandles.current.get(active)?.action(action), toggleFocus: () => setFocus(prev => !prev), async prepareReconnect(){if(terminals.length>=16){setError('保留终端达到上限（16 个），请先关闭结束标签');return false;}if(saves.current.size||creating||preparing){setError('请等待当前保存或终端创建完成');return false;}setPreparing(true);try{await CloseWorkspace(sessionID);return !disposed.current;}finally{setPreparing(false);}}, async saveAll() { for (const draft of draftsRef.current) { if (!await save(draft.path)) { setActive(draft.path); return false; } } return !draftsRef.current.some(d => d.content !== d.saved); } }));

  function close(path: string, discard = false) {
    const draft = draftsRef.current.find(d => d.path === path);
    if (draft?.saving) return;
    if (!discard && draft && draft.content !== draft.saved) { setClosing(path); return; }
    updateDrafts(prev => prev.filter(d => d.path !== path)); setSecondary(prev=>prev.filter(p=>p!==path)); setClosing('');
  }
  async function reread(path: string) {
    setError(''); const request = ReadRemoteFile(sessionID, path); reads.current.set(path, request);
    try { const doc = await request; if (!disposed.current && instance.current===sessionID) { updateDrafts(prev => prev.map(d => d.path === path ? { ...doc, saved: doc.content, saving: false, error: '' } : d)); setRereading(''); } }
    catch (e) { if (!disposed.current && instance.current===sessionID) setError(String(e)); } finally { if(reads.current.get(path)===request)reads.current.delete(path); }
  }
  const closingDraft = drafts.find(d => d.path === closing);
  function activate(path: string) { setActive(path); requestAnimationFrame(() => focusTab(path)); }
  return <div className="ssh-workspace">
    <div className="workspace-toolbar" aria-label="SSH 工作区工具"><button ref={filesToggle} className="session-tool" aria-pressed={filesShown} onClick={toggleFiles}><Icon name="files" width="15" />文件</button><button ref={monitorToggle} className="session-tool" aria-pressed={monitorShown} onClick={toggleMonitor}><Icon name="monitor" width="15" />监控</button><Button size="sm" variant="light" isDisabled={busy||preparing} onPress={onReconnect}>重新连接</Button><Dropdown><DropdownTrigger><Button size="sm" variant="light">窗格</Button></DropdownTrigger><DropdownMenu aria-label="窗格操作" disabledKeys={[...(creating||terminals.length>=16?['new']:[]),...(!active?['move']:[]),...(!split?['maximize','merge']:[])]} onAction={key=>{if(key==='new')void newTerminal(1);if(key==='move')moveActive();if(key==='maximize')setMaximized(v=>!v);if(key==='merge'){setSplit(false);setSecondary([]);setSelection([active||paneSelected[0],'']);setActivePane(0);setMaximized(false);}}}><DropdownItem key="new">新建终端到右侧</DropdownItem><DropdownItem key="move">移动当前标签到另一窗格</DropdownItem><DropdownItem key="maximize">{maximized?'恢复双窗格':'最大化当前窗格'}</DropdownItem><DropdownItem key="merge">合并窗格</DropdownItem></DropdownMenu></Dropdown><button className="icon-button focus-toggle" aria-label="专注模式" title="专注模式" aria-pressed={focus} onClick={() => setFocus(!focus)}><Icon name="focus" width="16" /></button></div>
    <div className="ssh-panels">
    <div className="file-dock" hidden={!filesShown} style={{ width: filesWidth }}><FileBrowser id={sessionID} connectionID={connectionID} visible={visible && filesShown} onOpen={open} onClose={() => { toggleFiles(); filesToggle.current?.focus(); }} /></div>
    {filesShown && !narrow && <ResizeHandle label="文件面板宽度" value={filesWidth} min={200} max={420} onChange={setFilesWidth} />}
    <div className="ssh-center" ref={center}>
      <div className="inner-tabs" role="tablist" aria-label="终端与文件" aria-multiselectable={split} onKeyDown={e => {
        const target = e.target as HTMLElement;
        if (target.getAttribute('role') !== 'tab' || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
        e.preventDefault(); const buttons = e.currentTarget.querySelectorAll<HTMLElement>('[role=tab]'); const index = Array.from(buttons).indexOf(target);
        const next = e.key === 'Home' ? 0 : e.key === 'End' ? tabIDs.length - 1 : (index + (e.key === 'ArrowRight' ? 1 : -1) + tabIDs.length) % tabIDs.length;
        setActive(tabIDs[next]); setTimeout(() => buttons[next]?.focus(), 0);
      }}>
        {terminals.map((terminal, index) => <div key={terminal} className={shown(terminal) ? 'selected' : ''}><button role="tab" tabIndex={active === terminal ? 0 : -1} aria-selected={shown(terminal)} onClick={() => activate(terminal)}><Icon name="terminal" width="14" />终端 {index + 1}{split&&<small>· {paneFor(terminal)+1}</small>}</button><button aria-label={`关闭终端 ${index + 1}`} onClick={() => { setTerminals(prev => prev.filter(t => t !== terminal)); setSecondary(prev=>prev.filter(p=>p!==terminal)); }}><Icon name="close" width="12" /></button></div>)}
        {drafts.map(d => <div key={d.path} className={shown(d.path) ? 'selected' : ''}><button role="tab" tabIndex={active === d.path ? 0 : -1} aria-selected={shown(d.path)} title={d.path} onClick={() => activate(d.path)}>{d.path.split('/').pop()}{split&&<small>· {paneFor(d.path)+1}</small>}{d.content !== d.saved && <span className="dirty-dot" aria-label="未保存">●</span>}</button><button aria-label={`关闭文件 ${d.path}`} disabled={d.saving} onClick={() => close(d.path)}><Icon name="close" width="12" /></button></div>)}
        <button aria-label="新建终端" disabled={creating||terminals.length>=16} onClick={()=>void newTerminal()}><Icon name="plus" width="15" /></button>
      </div>
      {error && <div className="connection-feedback error" role="alert">{error}</div>}
      {!tabIDs.length && <div className="workspace-empty">从标签栏新建终端或打开文件</div>}
      <WorkspacePanes split={split} maximized={maximized} ratio={ratio} onRatio={setRatio}>
      {terminals.map(terminal => <div className={`terminal-tab ${activePane===paneFor(terminal)?'focused-pane':''}`} data-tab-id={terminal} hidden={!shown(terminal)} style={{gridColumn:maximized?1:paneFor(terminal)===0?1:3,gridRow:1}} onFocusCapture={()=>setActivePane(paneFor(terminal))} key={terminal}><TerminalView ref={handle => { if (handle) terminalHandles.current.set(terminal, handle); else terminalHandles.current.delete(terminal); }} id={terminal} visible={visible && shown(terminal)} focusOnShow={activePane===paneFor(terminal)} fontSize={fontSize} /></div>)}
      {drafts.map(d => <div key={d.path} className={`editor-tab ${activePane===paneFor(d.path)?'focused-pane':''}`} data-tab-id={d.path} hidden={!shown(d.path)} style={{gridColumn:maximized?1:paneFor(d.path)===0?1:3,gridRow:1}} onFocusCapture={()=>setActivePane(paneFor(d.path))}>
        <div className="editor-toolbar"><span title={d.path}>{d.path}</span><Button size="sm" isLoading={d.saving} isDisabled={d.content === d.saved} onPress={() => void save(d.path)}>保存</Button></div>
        {d.error && <div className="file-save-error"><p role="alert" className="error">{d.error}</p><div className="button-row"><Button size="sm" variant="light" isDisabled={d.saving} onPress={()=>setConflict(d.path)}>对比与合并</Button><Button size="sm" variant="light" onPress={() => setRereading(d.path)}>重新读取</Button><Button size="sm" variant="light" onPress={() => { navigator.clipboard.writeText(d.content).catch(e => setError(String(e))); }}>复制草稿</Button></div></div>}
        <CodeEditor path={d.path} content={d.content} visible={visible && shown(d.path)} focusOnShow={activePane===paneFor(d.path)} onChange={value => updateDrafts(prev => prev.map(item => item.path === d.path ? { ...item, content: value } : item))} onSave={() => void save(d.path)} />
      </div>)}
      </WorkspacePanes>
    </div>
    <MonitorPanel id={sessionID} visible={visible && monitorShown} onClose={() => { toggleMonitor(); monitorToggle.current?.focus(); }} />
    </div>
    {conflict && drafts.find(d=>d.path===conflict) && <FileConflictView key={`${sessionID}:${conflict}`} sessionID={sessionID} path={conflict} content={drafts.find(d=>d.path===conflict)!.content} onClose={()=>setConflict('')} onApply={(content,remote)=>{updateDrafts(prev=>prev.map(d=>d.path===conflict?{...d,content,saved:remote.content,revision:remote.revision,needsReview:false,error:''}:d));setConflict('');}} />}
    <Modal isOpen={!!closingDraft} onClose={() => !closingDraft?.saving && setClosing('')} className="app-dialog"><ModalContent><ModalHeader>保存文件修改？</ModalHeader><ModalBody><p className="file-path">{closing}</p>{closingDraft?.error && <p className="error" role="alert">{closingDraft.error}</p>}</ModalBody><ModalFooter><Button variant="light" isDisabled={closingDraft?.saving} onPress={() => setClosing('')}>取消</Button><Button color="danger" variant="light" isDisabled={closingDraft?.saving} onPress={() => close(closing, true)}>放弃修改</Button><Button color="primary" isLoading={closingDraft?.saving} onPress={async () => { if (await save(closing)) close(closing, true); }}>保存并关闭</Button></ModalFooter></ModalContent></Modal>
    <Modal isOpen={!!rereading} onClose={() => setRereading('')} className="app-dialog"><ModalContent><ModalHeader>重新读取远端文件</ModalHeader><ModalBody><p className="file-path">{rereading}</p><p>将覆盖此文件的本地草稿。请先复制需要保留的内容。</p>{error && <p className="error" role="alert">{error}</p>}</ModalBody><ModalFooter><Button variant="light" onPress={() => setRereading('')}>取消</Button><Button color="danger" onPress={() => void reread(rereading)}>放弃草稿并重新读取</Button></ModalFooter></ModalContent></Modal>
  </div>;
});

export default SSHWorkspace;
