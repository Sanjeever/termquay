import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Button, Dropdown, DropdownTrigger, DropdownMenu, DropdownItem, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react';
import { Stream } from '@wailsio/runtime';
import { ReadRemoteFile, SaveRemoteFile, CreateTerminal, CloseTerminal, WorkspaceRecoveryDrafts, CloseWorkspace, RegisterWorkspaceView, ReleaseWorkspaceView, SetWorkspaceDirty } from '../../../bindings/github.com/Sanjeever/termquay/appservice';
import type { Document, Entry } from '../../../bindings/github.com/Sanjeever/termquay/internal/files/models';
import TerminalView, { type TerminalAction, type TerminalHandle } from '../terminal/TerminalView';
import CodeEditor from './CodeEditor';
import FileBrowser from './FileBrowser';
import MonitorPanel from '../monitor/MonitorPanel';
import Icon from '../../components/Icon';
import ResizeHandle from '../../components/layout/ResizeHandle';
import FileConflictView from './FileConflictView';
import type { RecoveryDraftInput, SSHLayout } from '../../../bindings/github.com/Sanjeever/termquay/models';
import WorkspacePanes from './WorkspacePanes';
import TunnelPanel from '../tunnels/TunnelPanel';
import PaneTabs from './PaneTabs';
import { shortcutLabel, type Shortcuts } from '../../lib/shortcuts';

type Draft = Document & { saved: string; error: string; saving: boolean; needsReview?: boolean; recovery?:boolean };
export type SSHWorkspaceHandle = { workspaceAction(action: 'switchPane' | 'closeContent' | 'newTerminal'): void; layout():SSHLayout; hasDirty():boolean; recoveryDrafts():RecoveryDraftInput[]|null; insertionTarget():string; insert(text:string,target:string):boolean; focus(): void; saveAll(): Promise<boolean>; prepareReconnect(): Promise<boolean>; showFiles(): void; toggleMonitor(): void; toggleFocus(): void; terminalAction(action: TerminalAction): void };

const SSHWorkspace = forwardRef<SSHWorkspaceHandle, {
  id: string; sessionID: string; connectionID: string; target: string; environment: string; state: string; shortcuts: Shortcuts; initialLayout?:SSHLayout; visible: boolean; fontSize?: number; onDirtyChange(dirty: boolean): void; onState(state: string): void; onStateChange():void; onReconnect(): void; busy: boolean;
}>(function SSHWorkspace({ id, sessionID, connectionID, target, environment, state, shortcuts, initialLayout, visible, fontSize = 14, onDirtyChange, onState, onStateChange, onReconnect, busy }, ref) {
  let terminalIndex=0;const initialIDs=(initialLayout?.tabs||[]).map((tab,index)=>tab.kind==='file'?tab.path:terminalIndex++===0?sessionID:`restore-terminal-${index}`);
  const [error, setError] = useState('');
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [selection,setSelection]=useState<[string,string]>(initialLayout?[initialIDs[initialLayout.selected[0]]||'',initialIDs[initialLayout.selected[1]]||'']:[sessionID,'']);
  const [activePane,setActivePane]=useState(initialLayout?.active_pane||0);
  const [secondary,setSecondary]=useState<string[]>((initialLayout?.tabs||[]).flatMap((tab,index)=>tab.pane===1?[initialIDs[index]]:[]));
  const [split,setSplit]=useState(initialLayout?.split||false);
  const [maximized,setMaximized]=useState(initialLayout?.maximized||false);
  const [ratio,setRatio]=useState(initialLayout?.ratio||50);
  const [terminals, setTerminals] = useState<string[]>(!initialLayout||initialLayout.tabs?.some(t=>t.kind==='terminal')?[sessionID]:[]);
  const [fileOrder,setFileOrder]=useState((initialLayout?.tabs||[]).filter(t=>t.kind==='file').map(t=>t.path));
  const [restoring,setRestoring]=useState(!!initialLayout);
  const [restoreReady,setRestoreReady]=useState(!initialLayout);
  const [restoreEpoch,setRestoreEpoch]=useState(0);
  const [pendingErrors,setPendingErrors]=useState<Record<string,string>>({});
  const restoreApplied=useRef(!initialLayout);
  const terminalOwners=useRef(new Map([[sessionID,sessionID]]));
  const [directory,setDirectory]=useState(initialLayout?.directory||'');
  const [preparing, setPreparing] = useState(false);
  const [tunnelsOpen,setTunnelsOpen]=useState(false);
  const [closing, setClosing] = useState('');
  const [rereading, setRereading] = useState('');
  const [conflict, setConflict] = useState('');
  const [creating, setCreating] = useState(false);
  const [filesOpen, setFilesOpen] = useState(initialLayout?.files_open??(localStorage.getItem('termquay.layout.files-open') !== 'false'));
  const [filesWidth, setFilesWidth] = useState(initialLayout?.files_width??Math.max(200, Math.min(420, Number(localStorage.getItem('termquay.layout.files-width') || localStorage.getItem('termquay.layout.sidebar-width')) || 248)));
  const [monitorOpen, setMonitorOpen] = useState(initialLayout?.monitor_open??(localStorage.getItem('termquay.layout.monitor') === 'true'));
  const [focus, setFocus] = useState(initialLayout?.focus||false);
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
  const changeCallback=useRef(onStateChange);changeCallback.current=onStateChange;
  useEffect(()=>{changeCallback.current();},[drafts,terminals,fileOrder,secondary,selection,activePane,split,maximized,ratio,directory,filesOpen,filesWidth,monitorOpen,focus,restoreReady,restoring]);
  const dirty = drafts.some(d => d.recovery||d.content !== d.saved);
  currentDirty.current = dirty;
  const filesShown = !focus && (narrow ? narrowPanel === 'files' : filesOpen);
  const monitorShown = !focus && (narrow ? narrowPanel === 'monitor' : monitorOpen);
  const tabIDs=[...terminals,...fileOrder];
  const paneFor=(path:string)=>split&&secondary.includes(path)?1:0;
  const paneSelected=selection.map((path,pane)=>tabIDs.includes(path)&&paneFor(path)===pane?path:tabIDs.find(t=>paneFor(t)===pane)||'');
  const active=paneSelected[activePane];
  useEffect(()=>{if(!paneSelected[activePane]&&paneSelected[1-activePane])setActivePane(1-activePane);},[paneSelected[0],paneSelected[1],activePane]);
  function setActive(path:string){const pane=paneFor(path);setActivePane(pane);setSelection(prev=>pane===0?[path,prev[1]]:[prev[0],path]);}
  function shown(path:string){return path===paneSelected[paneFor(path)]&&(!maximized||paneFor(path)===activePane);}
  function focusTab(path=active){if(document.querySelector('[role=dialog][data-open=true]'))return;center.current?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(path)}"] .terminal-search > input, [data-tab-id="${CSS.escape(path)}"] .xterm-helper-textarea, [data-tab-id="${CSS.escape(path)}"] .cm-content`)?.focus();}
  function moveActive(){if(!active)return;const target=1-paneFor(active);setSplit(true);setMaximized(false);setSecondary(prev=>target===1?[...prev,active]:prev.filter(p=>p!==active));setSelection(prev=>target===0?[active,prev[1]]:[prev[0],active]);setActivePane(target);requestAnimationFrame(()=>focusTab(active));}
  async function newTerminal(pane=activePane){if(creating||restoring||terminals.length>=16)return;setCreating(true);try{const result=await CreateTerminal(sessionID);if(disposed.current||instance.current!==sessionID){CloseTerminal(result.id);return;}terminalOwners.current.set(result.id,sessionID);setTerminals(prev=>[...prev,result.id]);if(pane===1){setSplit(true);setSecondary(prev=>[...prev,result.id]);}setSelection(prev=>pane===0?[result.id,prev[1]]:[prev[0],result.id]);setActivePane(pane);setMaximized(false);}catch(e){setError(String(e));}finally{setCreating(false);}}
  function layout():SSHLayout{if(restoring&&initialLayout)return initialLayout;const live=terminals.filter(t=>terminalOwners.current.get(t)===sessionID&&!terminalHandles.current.get(t)?.ended()).slice(-8);const ordered=[...live,...fileOrder];return {tabs:ordered.map(path=>({kind:live.includes(path)?'terminal':'file',path:live.includes(path)?'':path,pane:paneFor(path)})),selected:[ordered.indexOf(paneSelected[0]),ordered.indexOf(paneSelected[1])],active_pane:activePane,split,maximized,ratio,directory,files_open:filesOpen,files_width:Math.round(filesWidth),monitor_open:monitorOpen,focus};}

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
      previousInstance.current = sessionID;terminalOwners.current.set(sessionID,sessionID); setTerminals(prev=>[...prev,sessionID]); setActive(sessionID);
      updateDrafts(prev=>prev.map(d=>({...d,needsReview:true,error:'连接已更新，正在核对远端版本'})));
      void (async()=>{for(const draft of draftsRef.current){if(ended)return;const request=ReadRemoteFile(sessionID,draft.path);reads.current.set(draft.path,request);try{const current=await request;if(ended)return;updateDrafts(prev=>prev.map(d=>d.path===draft.path?d.recovery?{...d,saved:current.content,revision:current.revision,needsReview:true,error:'恢复草稿，请先对比与合并'}:current.content===d.saved?{...d,revision:current.revision,needsReview:false,error:''}:{...d,needsReview:true,error:'远端内容已变化，请对比后合并或重新读取'}:d));}catch(e){if(!ended)updateDrafts(prev=>prev.map(d=>d.path===draft.path?{...d,needsReview:true,error:String(e)}:d));}finally{if(reads.current.get(draft.path)===request)reads.current.delete(draft.path);}}})();
    }
    return () => { ended = true; for (const read of reads.current.values()) read.cancel(); reads.current.clear(); owner.close(); CloseWorkspace(sessionID).catch(() => {}); };
  }, [sessionID]);
  useEffect(()=>{
    if(!initialLayout||restoreApplied.current)return;restoreApplied.current=true;setRestoring(true);let stopped=false;const bodyRequest=WorkspaceRecoveryDrafts(id);
    void(async()=>{try{
      const bodies=await bodyRequest;if(stopped)return;const paths=[...new Set([...(initialLayout.tabs||[]).filter(t=>t.kind==='file').map(t=>t.path),...(bodies||[]).map(d=>d.path)])];if(paths.length>64)throw new Error('恢复文件超过 64 个，请在本地草稿设置查看或清理后重试');setFileOrder(paths);
      updateDrafts(prev=>[...prev,...(bodies||[]).filter(d=>!prev.some(old=>old.path===d.path)).map(d=>({path:d.path,content:d.content,revision:'',saved:'',saving:false,error:'恢复草稿，连接后需对比最新远端内容',needsReview:true,recovery:true}))]);setRestoreReady(true);
      const planned=(initialLayout.tabs||[]).map((tab,index)=>({tab,key:initialIDs[index]})).filter(t=>t.tab.kind==='terminal');
      if(!planned.length)await CloseTerminal(sessionID);
      for(let index=1;index<planned.length;index++){try{const result=await CreateTerminal(sessionID);if(stopped){CloseTerminal(result.id);return;}terminalOwners.current.set(result.id,sessionID);setTerminals(prev=>[...prev,result.id]);const old=planned[index].key;setSecondary(prev=>prev.map(id=>id===old?result.id:id));setSelection(prev=>prev.map(id=>id===old?result.id:id) as [string,string]);}catch(e){if(!stopped)setError(`部分终端未能恢复：${String(e)}`);break;}}
      for(const path of paths){if(stopped)return;const request=ReadRemoteFile(sessionID,path);reads.current.set(path,request);try{const doc=await request;if(stopped)return;updateDrafts(prev=>{const old=prev.find(d=>d.path===path);return old?prev.map(d=>d.path===path?{...d,revision:doc.revision,saved:doc.content,needsReview:!!d.recovery,error:d.recovery?'恢复草稿，请先对比与合并':'',saving:false}:d):[...prev,{...doc,saved:doc.content,error:'',saving:false}];});}catch(e){if(stopped)return;setPendingErrors(prev=>({...prev,[path]:String(e)}));updateDrafts(prev=>prev.map(d=>d.path===path?{...d,error:String(e),needsReview:true}:d));}finally{if(reads.current.get(path)===request)reads.current.delete(path);}}
      if(!stopped){setActivePane(initialLayout.active_pane);const first=(bodies||[])[0];if(first){setActive(first.path);setConflict(first.path);}}
    }catch(e){if(!stopped)setError(String(e));}finally{if(!stopped)setRestoring(false);}})();
    return()=>{stopped=true;bodyRequest.cancel();};
  },[sessionID,restoreEpoch]);
  useEffect(() => { dirtyCallback.current(dirty); viewReady.current?.then(()=>{if(!disposed.current)return SetWorkspaceDirty(id,currentDirty.current);}).catch(e => {if(!disposed.current)setError(String(e));}); }, [dirty, id]);
  useEffect(() => { const handler = (event: BeforeUnloadEvent) => { if (draftsRef.current.some(d => d.content !== d.saved)) { event.preventDefault(); event.returnValue = ''; } }; window.addEventListener('beforeunload', handler); return () => window.removeEventListener('beforeunload', handler); }, []);

  async function open(entry: Entry) {
    await openPath(entry.path); if (narrow) setNarrowPanel(null);
  }
  async function openPath(path:string){
    if(restoring||!restoreReady)throw new Error('请等待或重试本地草稿载入');
    if (draftsRef.current.some(d => d.path === path)) { setActive(path); return; }
    if (reads.current.has(path)) return;
    if(!fileOrder.includes(path)&&fileOrder.length+reads.current.size>=64)throw new Error('打开文件达到上限（64 个）');
    const request = ReadRemoteFile(sessionID, path); reads.current.set(path, request);
    try { const doc = await request; if (disposed.current || instance.current!==sessionID) return; updateDrafts(prev => [...prev, { ...doc, saved: doc.content, error: '', saving: false }]);setFileOrder(prev=>prev.includes(path)?prev:[...prev,path]); if(split&&activePane===1&&!fileOrder.includes(path)){setSecondary(prev=>[...prev,path]);setSelection(prev=>[prev[0],path]);}else setActive(path); }
    finally { if(reads.current.get(path)===request)reads.current.delete(path); }
  }
  async function save(path: string): Promise<boolean> {
    const pending = saves.current.get(path); if (pending) return pending;
    const draft = draftsRef.current.find(d => d.path === path); if (!draft) return true;
    if (draft.needsReview) { updateDrafts(prev=>prev.map(d=>d.path===path?{...d,error:'请先核对最新远端内容，再保存草稿'}:d)); return false; }
    if (draft.content === draft.saved) return true;
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
  useImperativeHandle(ref, () => ({ workspaceAction, layout,hasDirty:()=>draftsRef.current.some(d=>d.recovery||d.content!==d.saved), recoveryDrafts:()=>restoreReady?draftsRef.current.filter(d=>d.recovery||d.content!==d.saved).map(d=>({path:d.path,content:d.content})):null,insertionTarget:()=>terminalHandles.current.has(active)?active:'',insert:(text,target)=>target===active?terminalHandles.current.get(target)?.insert(text)||false:false, focus:()=>focusTab(), showFiles, toggleMonitor, terminalAction: action => terminalHandles.current.get(active)?.action(action), toggleFocus: () => setFocus(prev => !prev), async prepareReconnect(){if(terminals.length>=16){setError('保留终端达到上限（16 个），请先关闭结束标签');return false;}if(saves.current.size||creating||preparing||restoring){setError('请等待当前保存、恢复或终端创建完成');return false;}setPreparing(true);try{await CloseWorkspace(sessionID);return !disposed.current;}finally{setPreparing(false);}}, async saveAll() { for (const draft of draftsRef.current) { if (!await save(draft.path)) { setActive(draft.path); return false; } } return !draftsRef.current.some(d => d.recovery||d.content !== d.saved); } }));

  function close(path: string, discard = false) {
    const draft = draftsRef.current.find(d => d.path === path);
    if (draft?.saving) return;
    if (!discard && draft && (draft.recovery||draft.content !== draft.saved)) { setClosing(path); return; }
    updateDrafts(prev => prev.filter(d => d.path !== path));setFileOrder(prev=>prev.filter(p=>p!==path)); setSecondary(prev=>prev.filter(p=>p!==path));setPendingErrors(prev=>{const next={...prev};delete next[path];return next;}); setClosing('');
  }
  async function reread(path: string) {
    setError(''); const request = ReadRemoteFile(sessionID, path); reads.current.set(path, request);
    try { const doc = await request; if (!disposed.current && instance.current===sessionID) { updateDrafts(prev => prev.map(d => d.path === path ? { ...doc, saved: doc.content, saving: false, error: '' } : d)); setRereading(''); } }
    catch (e) { if (!disposed.current && instance.current===sessionID) setError(String(e)); } finally { if(reads.current.get(path)===request)reads.current.delete(path); }
  }
  const closingDraft = drafts.find(d => d.path === closing);
  function activate(path: string) { setActive(path); requestAnimationFrame(() => focusTab(path)); }
  function closeTab(path: string) { if (!terminals.includes(path)) { close(path); return; } terminalOwners.current.delete(path); setTerminals(prev => prev.filter(t => t !== path)); setSecondary(prev => prev.filter(p => p !== path)); }
  function workspaceAction(action: 'switchPane' | 'closeContent' | 'newTerminal') { if (restoring) return; if (action === 'newTerminal') void newTerminal(); if (action === 'closeContent' && active) closeTab(active); if (action === 'switchPane' && split) { const pane = 1 - activePane; setActivePane(pane); requestAnimationFrame(() => focusTab(paneSelected[pane])); } }
  const tabs = tabIDs.map(path => { const draft = drafts.find(d => d.path === path); const terminal = terminals.includes(path); return { id: path, label: terminal ? `终端 ${terminals.indexOf(path) + 1}` : path.split('/').pop() || path, terminal, dirty: !!draft && (draft.recovery || draft.content !== draft.saved), closingDisabled: restoring || draft?.saving }; });
  return <div className="ssh-workspace">
    <div className="workspace-toolbar" aria-label="SSH 工作区工具"><span className="session-target" title={target}>{target}</span>{environment && <span className={`connection-environment ${environment}`}>{({production:'生产',staging:'预发布',development:'开发'} as Record<string,string>)[environment]}</span>}<span className="session-state">{state}</span><button ref={filesToggle} className="session-tool" aria-pressed={filesShown} onClick={toggleFiles}><Icon name="files" width="15" />文件</button><button ref={monitorToggle} className="session-tool" aria-pressed={monitorShown} onClick={toggleMonitor}><Icon name="monitor" width="15" />监控</button><button className="session-tool" aria-pressed={tunnelsOpen} onClick={()=>setTunnelsOpen(v=>!v)}>端口转发</button>{state === '已断开' && <Button size="sm" variant="light" isDisabled={busy||preparing} onPress={onReconnect}>重新连接</Button>}<Dropdown><DropdownTrigger><Button size="sm" variant="light">窗格</Button></DropdownTrigger><DropdownMenu aria-label="窗格操作" disabledKeys={[...(creating||terminals.length>=16?['new']:[]),...(!active?['move']:[]),...(!split?['maximize','merge']:[])]} onAction={key=>{if(key==='new')void newTerminal(1);if(key==='move')moveActive();if(key==='maximize')setMaximized(v=>!v);if(key==='merge'){setSplit(false);setSecondary([]);setSelection([active||paneSelected[0],'']);setActivePane(0);setMaximized(false);}}}><DropdownItem key="new">新建终端到右侧</DropdownItem><DropdownItem key="move">移动当前标签到另一窗格</DropdownItem><DropdownItem key="maximize">{maximized?'恢复双窗格':'最大化当前窗格'}</DropdownItem><DropdownItem key="merge">合并窗格</DropdownItem></DropdownMenu></Dropdown><Dropdown><DropdownTrigger><button className="icon-button" aria-label="SSH 会话操作"><Icon name="more" width="15" /></button></DropdownTrigger><DropdownMenu aria-label="SSH 会话操作" disabledKeys={busy || preparing ? ['reconnect'] : []} onAction={() => onReconnect()}><DropdownItem key="reconnect">重新连接</DropdownItem></DropdownMenu></Dropdown><button className="icon-button focus-toggle" aria-label="专注模式" title="专注模式" aria-pressed={focus} onClick={() => setFocus(!focus)}><Icon name="focus" width="16" /></button></div>
    <div hidden={!tunnelsOpen}><TunnelPanel id={sessionID} visible={visible&&tunnelsOpen}/></div>
    <div className="ssh-panels">
    <div className="file-dock" hidden={!filesShown} style={{ width: filesWidth }}><FileBrowser id={sessionID} connectionID={connectionID} initialDirectory={initialLayout?.directory} onDirectory={setDirectory} visible={visible && filesShown} onOpen={open} onClose={() => { toggleFiles(); filesToggle.current?.focus(); }} /></div>
    {filesShown && !narrow && <ResizeHandle label="文件面板宽度" value={filesWidth} min={200} max={420} onChange={setFilesWidth} />}
    <div className="ssh-center" ref={center}>
      {error && <div className="connection-feedback error" role="alert">{error}</div>}
      {!restoreReady&&!restoring&&<Button size="sm" onPress={()=>{restoreApplied.current=false;setRestoreEpoch(v=>v+1);}}>重试载入本地草稿</Button>}
      {restoring&&<div className="session-status" role="status">正在恢复文件与终端入口…</div>}
      {!tabIDs.length && <div className="workspace-empty">从标签栏新建终端或打开文件</div>}
      <WorkspacePanes split={split} maximized={maximized} ratio={ratio} onRatio={setRatio}>
      {[0, 1].map(pane => <PaneTabs key={`pane-${pane}`} pane={pane} newShortcut={shortcutLabel(shortcuts.newTerminal)} closeShortcut={shortcutLabel(shortcuts.closeContent)} items={tabs.filter(t => paneFor(t.id) === pane)} selected={paneSelected[pane]} focused={pane === activePane} hidden={(!split && pane === 1) || (maximized && pane !== activePane)} column={maximized || pane === 0 ? 1 : 3} creating={creating || restoring || terminals.length >= 16} onSelect={activate} onClose={closeTab} onNew={() => void newTerminal(pane)} />)}
      {terminals.map(terminal => <div className={`terminal-tab ${activePane===paneFor(terminal)?'focused-pane':''}`} data-tab-id={terminal} hidden={!shown(terminal)} style={{gridColumn:maximized?1:paneFor(terminal)===0?1:3,gridRow:2}} onFocusCapture={()=>setActivePane(paneFor(terminal))} key={terminal}><TerminalView ref={handle => { if (handle) terminalHandles.current.set(terminal, handle); else terminalHandles.current.delete(terminal); }} id={terminal} onConnectionChange={()=>changeCallback.current()} visible={visible && shown(terminal)} focusOnShow={activePane===paneFor(terminal)} fontSize={fontSize} /></div>)}
      {fileOrder.filter(path=>!drafts.some(d=>d.path===path)).map(path=><div key={path} className="editor-tab" data-tab-id={path} hidden={!shown(path)} style={{gridColumn:maximized?1:paneFor(path)===0?1:3,gridRow:2}}><p className="file-path">{path}</p>{pendingErrors[path]&&<p role="alert" className="error">{pendingErrors[path]}</p>}<Button size="sm" isDisabled={restoring} onPress={()=>{openPath(path).catch(e=>setPendingErrors(prev=>({...prev,[path]:String(e)})));}}>读取文件</Button></div>)}
      {drafts.map(d => <div key={d.path} className={`editor-tab ${activePane===paneFor(d.path)?'focused-pane':''}`} data-tab-id={d.path} hidden={!shown(d.path)} style={{gridColumn:maximized?1:paneFor(d.path)===0?1:3,gridRow:2}} onFocusCapture={()=>setActivePane(paneFor(d.path))}>
        <div className="editor-toolbar"><span title={d.path}>{d.path}</span><Button size="sm" isLoading={d.saving} isDisabled={d.content === d.saved} onPress={() => void save(d.path)}>保存</Button></div>
        {d.error && <div className="file-save-error"><p role="alert" className="error">{d.error}</p><div className="button-row"><Button size="sm" variant="light" isDisabled={d.saving} onPress={()=>setConflict(d.path)}>对比与合并</Button><Button size="sm" variant="light" onPress={() => setRereading(d.path)}>重新读取</Button><Button size="sm" variant="light" onPress={() => { navigator.clipboard.writeText(d.content).catch(e => setError(String(e))); }}>复制草稿</Button></div></div>}
        <CodeEditor path={d.path} content={d.content} visible={visible && shown(d.path)} focusOnShow={activePane===paneFor(d.path)} onChange={value => updateDrafts(prev => prev.map(item => item.path === d.path ? { ...item, content: value } : item))} onSave={() => void save(d.path)} />
      </div>)}
      </WorkspacePanes>
    </div>
    <MonitorPanel id={sessionID} visible={visible && monitorShown} onClose={() => { toggleMonitor(); monitorToggle.current?.focus(); }} />
    </div>
    {conflict && drafts.find(d=>d.path===conflict) && <FileConflictView key={`${sessionID}:${conflict}`} sessionID={sessionID} path={conflict} content={drafts.find(d=>d.path===conflict)!.content} onClose={()=>setConflict('')} onApply={(content,remote)=>{updateDrafts(prev=>prev.map(d=>d.path===conflict?{...d,content,saved:remote.content,revision:remote.revision,needsReview:false,recovery:false,error:''}:d));setConflict('');}} />}
    <Modal isOpen={!!closingDraft} onClose={() => !closingDraft?.saving && setClosing('')} className="app-dialog"><ModalContent><ModalHeader>保存文件修改？</ModalHeader><ModalBody><p className="file-path">{closing}</p>{closingDraft?.error && <p className="error" role="alert">{closingDraft.error}</p>}</ModalBody><ModalFooter><Button variant="light" isDisabled={closingDraft?.saving} onPress={() => setClosing('')}>取消</Button><Button color="danger" variant="light" isDisabled={closingDraft?.saving} onPress={() => close(closing, true)}>放弃修改</Button><Button color="primary" isLoading={closingDraft?.saving} onPress={async () => { if (await save(closing)) close(closing, true); }}>保存并关闭</Button></ModalFooter></ModalContent></Modal>
    <Modal isOpen={!!rereading} onClose={() => setRereading('')} className="app-dialog"><ModalContent><ModalHeader>重新读取远端文件</ModalHeader><ModalBody><p className="file-path">{rereading}</p><p>将覆盖此文件的本地草稿。请先复制需要保留的内容。</p>{error && <p className="error" role="alert">{error}</p>}</ModalBody><ModalFooter><Button variant="light" onPress={() => setRereading('')}>取消</Button><Button color="danger" onPress={() => void reread(rereading)}>放弃草稿并重新读取</Button></ModalFooter></ModalContent></Modal>
  </div>;
});

export default SSHWorkspace;
