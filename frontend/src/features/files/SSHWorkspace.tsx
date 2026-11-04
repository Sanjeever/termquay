import Tooltip from '../../components/Tooltip';
import { errorCode, errorMessage } from "../../lib/errors";
import { forwardRef, lazy, Suspense, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Button, Dropdown, DropdownTrigger, DropdownMenu, DropdownItem, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react';
import { Stream } from '@wailsio/runtime';
import { ReadRemoteFile, ReadRemoteFileEncoded, DownloadFileDraft, StartDownload, SaveRemoteFile, CreateTerminal, CloseTerminal, WorkspaceRecoveryDrafts, CloseWorkspace, RegisterWorkspaceView, ReleaseWorkspaceView, SetWorkspaceDirty } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import SelectControl from '../../components/SelectControl';
import { documentFormat, formatKey, editorEncodings } from './editorFormat';
import type { Document, Entry } from '../../../bindings/github.com/Sanjeever/termquay/internal/files/models';
import TerminalView, { type TerminalAction, type TerminalHandle } from '../terminal/TerminalView';
import FileBrowser from './FileBrowser';
import MonitorPanel from '../monitor/MonitorPanel';
import Icon from '../../components/Icon';
import ErrorNotice from '../../components/ErrorNotice';
import ResizeHandle from '../../components/layout/ResizeHandle';
import type { RecoveryDraftInput, SSHLayout } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import WorkspacePanes from './WorkspacePanes';
import TunnelPanel from '../tunnels/TunnelPanel';
import PaneTabs from './PaneTabs';
import { shortcutLabel, type Shortcuts } from '../../lib/shortcuts';
import { shellQuote } from '../terminal/shellIntegration';
import useSSHReconnect from '../connections/useSSHReconnect';
import { isImagePath } from './fileTypes';
import { ReadSudoFile, SaveSudoFile } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import SudoAuthorizationDialog, { type SudoAuthorization } from './SudoAuthorizationDialog';

const TextDocument = lazy(() => import('./TextDocument'));
const ImagePreview = lazy(() => import('./ImagePreview'));
const FileConflictView = lazy(() => import('./FileConflictView'));

type Draft = Document & { saved: string; savedFormat?: string; reloadEpoch?: number; error: string; saving: boolean; needsReview?: boolean; recovery?:boolean; sudo?: boolean };
function isDirty(draft: Draft) { return !!draft.recovery || draft.content !== draft.saved || !!draft.savedFormat && formatKey(draft) !== draft.savedFormat; }
function savedEncoding(draft: Draft) { return draft.savedFormat ? JSON.parse(draft.savedFormat).encoding as string : draft.encoding || 'UTF-8'; }
export type SSHWorkspaceHandle = { sudoEdit(): void; workspaceAction(action: 'switchPane' | 'closeContent' | 'newTerminal'): boolean; layout():SSHLayout; hasDirty():boolean; recoveryDrafts():RecoveryDraftInput[]|null; insertionTarget():string; insert(text:string,target:string):boolean; focus(): void; saveAll(): Promise<boolean>; prepareReconnect(): Promise<boolean>; showFiles(): void; locateDirectory(path: string): void; toggleMonitor(): void; toggleFocus(): void; terminalAction(action: TerminalAction): void };

const SSHWorkspace = forwardRef<SSHWorkspaceHandle, {
  id: string; sessionID: string; connectionID: string; target: string; environment: string; state: string; shortcuts: Shortcuts; initialLayout?:SSHLayout; visible: boolean; fontSize?: number; onDirtyChange(dirty: boolean): void; onState(state: string): void; onStateChange():void; onReconnect(): void; onAutomaticReconnect(): Promise<{ ok: boolean; retryable: boolean }>; onCancelReconnect(): void; onSnippets(): void; busy: boolean;
}>(function SSHWorkspace({ id, sessionID, connectionID, target, environment, state, shortcuts, initialLayout, visible, fontSize = 14, onDirtyChange, onState, onStateChange, onReconnect, onAutomaticReconnect, onCancelReconnect, onSnippets, busy }, ref) {
  const reconnect = useSSHReconnect(sessionID, state, busy, onAutomaticReconnect);
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
  const [fileViews,setFileViews]=useState<Record<string,'text'|'image'>>({});
  const [markdownAnchor,setMarkdownAnchor]=useState<{path:string;hash:string;sequence:number}>();
  const [restoring,setRestoring]=useState(!!initialLayout);
  const [restoreReady,setRestoreReady]=useState(!initialLayout);
  const [restoreEpoch,setRestoreEpoch]=useState(0);
  const [pendingErrors,setPendingErrors]=useState<Record<string,{ message:string; code:string; encoding:string }>>({});
  const restoreApplied=useRef(!initialLayout);
  const terminalOwners=useRef(new Map([[sessionID,sessionID]]));
  const [directory,setDirectory]=useState(initialLayout?.directory||'');
  const [followDirectory, setFollowDirectory] = useState(false);
  const [directoryRequest, setDirectoryRequest] = useState<{ path: string; sequence: number; locate?: boolean }>();
  const [fileJump, setFileJump] = useState<{ path: string; line: number; sequence: number }>();
  const terminalDirectories = useRef(new Map<string, string>());
  const [preparing, setPreparing] = useState(false);
  const [tunnelsOpen,setTunnelsOpen]=useState(false);
  const [closing, setClosing] = useState('');
  const [rereading, setRereading] = useState('');
  const [reopenEncoding, setReopenEncoding] = useState('UTF-8');
  const [conflict, applyConflict] = useState('');
  const [sudoPrompt, setSudoPrompt] = useState<{ path: string; encoding: string; operation: 'open' | 'read' | 'save' }>();
  const sudoAnswer = useRef<(value?: SudoAuthorization) => void>();
  const [sudoConflict, setSudoConflict] = useState<Document>();
  function authorizeSudo(path: string, encoding: string, operation: 'open' | 'read' | 'save') {
    if (sudoAnswer.current) return Promise.resolve(undefined);
    return new Promise<SudoAuthorization | undefined>(resolve => { sudoAnswer.current = resolve; setSudoPrompt({ path, encoding, operation }); });
  }
  function answerSudo(value?: SudoAuthorization) { const answer = sudoAnswer.current; sudoAnswer.current = undefined; setSudoPrompt(undefined); answer?.(value); }
  useEffect(() => () => { sudoAnswer.current?.(); sudoAnswer.current = undefined; }, [sessionID]);
  async function setConflict(path: string) {
    if (!path) { applyConflict(''); setSudoConflict(undefined); return; }
    const draft = draftsRef.current.find(d => d.path === path);
    if (draft?.sudo) {
      const authorization = await authorizeSudo(path, savedEncoding(draft), 'read');
      if (!authorization || disposed.current || instance.current !== sessionID) return;
      const request = ReadSudoFile(sessionID, path, authorization.encoding, authorization.password);
      reads.current.set(path, request);
      try { const doc = await request; if (!disposed.current && instance.current === sessionID && reads.current.get(path) === request) { setSudoConflict(doc); applyConflict(path); } }
      catch (e) { if (!disposed.current) setError(errorMessage(e)); }
      finally { if (reads.current.get(path) === request) reads.current.delete(path); }
    } else { setSudoConflict(undefined); applyConflict(path); }
  }
  async function openSudo(path = active && !terminals.includes(active) ? active : directory + '/') {
    if (restoring || !restoreReady || state !== '已连接') return;
    const authorization = await authorizeSudo(path, 'UTF-8', 'open');
    if (!authorization || disposed.current || instance.current !== sessionID) return;
    path = authorization.path;
    if (reads.current.has(path) || saves.current.has(path)) return;
    if (!fileOrder.includes(path) && new Set([...fileOrder, ...reads.current.keys()]).size >= 64) { setError('打开文件达到上限（64 个）'); return; }
    const request = ReadSudoFile(sessionID, path, authorization.encoding, authorization.password);
    reads.current.set(path, request);
    try {
      const doc = await request;
      if (disposed.current || instance.current !== sessionID || reads.current.get(path) !== request) return;
      const existing = draftsRef.current.find(d => d.path === path);
      const needsReview = !!existing && isDirty(existing);
      updateDrafts(previous => [...previous.filter(d => d.path !== path), { ...doc, ...(needsReview ? { content: existing!.content, ...documentFormat(existing!) } : {}), sudo: true, saved: doc.content, savedFormat: formatKey(doc), needsReview, saving: false, error: needsReview ? '请先对比与合并' : '' }]);
      setFileViews(previous => ({ ...previous, [path]: 'text' }));
      setPendingErrors(previous => { const next = { ...previous }; delete next[path]; return next; });
      setFileOrder(previous => previous.includes(path) ? previous : [...previous, path]); setActive(path);
      if (needsReview) { setSudoConflict(doc); applyConflict(path); }
    } catch (e) { if (!disposed.current) setError(errorMessage(e)); }
    finally { if (reads.current.get(path) === request) reads.current.delete(path); }
  }
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
  const dirty = drafts.some(d => isDirty(d));
  currentDirty.current = dirty;
  const filesShown = !focus && (narrow ? narrowPanel === 'files' : filesOpen);
  const monitorShown = !focus && (narrow ? narrowPanel === 'monitor' : monitorOpen);
  const tabIDs=[...terminals,...fileOrder];
  const paneFor=(path:string)=>split&&secondary.includes(path)?1:0;
  const paneSelected=selection.map((path,pane)=>tabIDs.includes(path)&&paneFor(path)===pane?path:tabIDs.find(t=>paneFor(t)===pane)||'');
  useEffect(()=>{const live=new Set(terminals);for(const key of terminalOwners.current.keys())if(!live.has(key))terminalOwners.current.delete(key);for(const key of terminalDirectories.current.keys())if(!live.has(key))terminalDirectories.current.delete(key);setSecondary(previous=>{const next=previous.filter(path=>live.has(path)||fileOrder.includes(path));return next.length===previous.length?previous:next;});},[terminals,fileOrder]);
  const active=paneSelected[activePane];
  useEffect(() => { const path = terminalDirectories.current.get(active); if (followDirectory && path) setDirectoryRequest({ path, sequence: Date.now() }); }, [active, followDirectory]);
  function terminalDirectory(terminal: string, path: string, host: string) {
    const targetHost = target.slice(target.lastIndexOf('@') + 1, target.lastIndexOf(':')).replace(/^\[|\]$/g, '').toLowerCase();
    if (host && host.replace(/^\[|\]$/g, '').toLowerCase() !== targetHost) return;
    terminalDirectories.current.set(terminal, path);
    if (followDirectory && terminal === active) setDirectoryRequest({ path, sequence: Date.now() });
  }
  function locateInTerminal(path: string) {
    const terminal = terminals.includes(active) ? active : terminals.find(value => terminalOwners.current.get(value) === sessionID && !terminalHandles.current.get(value)?.ended());
    if (!terminal) { setError('请先打开可输入的终端'); return; }
    setActive(terminal); terminalHandles.current.get(terminal)?.insert(`cd -- ${shellQuote(path)}`);
    requestAnimationFrame(() => focusTab(terminal));
  }
  async function openTerminalFile(path: string, line: number) { try { setFileJump({ path, line, sequence: Date.now() }); await openPath(path); } catch (e) { setError(errorMessage(e)); } }
  useEffect(()=>{if(!paneSelected[activePane]&&paneSelected[1-activePane])setActivePane(1-activePane);},[paneSelected[0],paneSelected[1],activePane]);
  function setActive(path:string){const pane=paneFor(path);setActivePane(pane);setSelection(prev=>pane===0?[path,prev[1]]:[prev[0],path]);}
  function shown(path:string){return path===paneSelected[paneFor(path)]&&(!maximized||paneFor(path)===activePane);}
  function imageFile(path:string){return fileViews[path]?fileViews[path]==='image':isImagePath(path);}
  function focusTab(path=active){if(document.querySelector('[role=dialog][data-open=true]'))return;const selector=`[data-tab-id="${CSS.escape(path)}"]`;Array.from(center.current?.querySelectorAll<HTMLElement>(`${selector} .terminal-search > input, ${selector} .xterm-helper-textarea, ${selector} .cm-content, ${selector} [data-image-preview], ${selector} [data-markdown-preview]`)||[]).find(element=>element.getClientRects().length>0)?.focus();}
  function moveActive(){if(!active)return;const target=1-paneFor(active);setSplit(true);setMaximized(false);setSecondary(prev=>target===1?[...prev,active]:prev.filter(p=>p!==active));setSelection(prev=>target===0?[active,prev[1]]:[prev[0],active]);setActivePane(target);requestAnimationFrame(()=>focusTab(active));}
  async function newTerminal(pane=activePane){if(creating||restoring||terminals.length>=16)return;setCreating(true);try{const result=await CreateTerminal(sessionID);if(disposed.current||instance.current!==sessionID){CloseTerminal(result.id);return;}terminalOwners.current.set(result.id,sessionID);setTerminals(prev=>[...prev,result.id]);if(pane===1){setSplit(true);setSecondary(prev=>[...prev,result.id]);}setSelection(prev=>pane===0?[result.id,prev[1]]:[prev[0],result.id]);setActivePane(pane);setMaximized(false);}catch(e){setError(errorMessage(e));}finally{setCreating(false);}}
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
    viewReady.current.then(()=>{if(disposed.current)ReleaseWorkspaceView(id);}).catch(e=>{if(!disposed.current)setError(errorMessage(e));});
    return () => { disposed.current = true; ReleaseWorkspaceView(id).catch(() => {}); };
  }, [id]);
  useEffect(() => {
    let ended = false;
    const owner = Stream('workspace'); owner.onopen = () => { if(ended)return; owner.send(new TextEncoder().encode(sessionID)); stateCallback.current('已连接'); }; owner.onclose = () => { if (!ended) stateCallback.current('已断开'); };
    if(previousInstance.current !== sessionID){
      previousInstance.current = sessionID;terminalOwners.current.set(sessionID,sessionID); setTerminals(prev=>[...prev,sessionID].slice(-16)); setActive(sessionID);
      updateDrafts(prev=>prev.map(d=>({...d,needsReview:true,error:'连接已更新，正在核对远端版本'})));
      void (async()=>{for(const draft of draftsRef.current){if(ended)return;const request=ReadRemoteFileEncoded(sessionID,draft.path,savedEncoding(draft));reads.current.set(draft.path,request);try{const current=await request;if(ended)return;updateDrafts(prev=>prev.map(d=>d.path===draft.path?d.recovery?{...d,saved:current.content,savedFormat:formatKey(current),revision:current.revision,needsReview:true,error:'恢复草稿，请先对比与合并'}:current.content===d.saved&&(!d.savedFormat||formatKey(current)===d.savedFormat)?{...d,revision:current.revision,needsReview:false,error:''}:{...d,needsReview:true,error:'远端内容已变化，请对比后合并或重新读取'}:d));}catch(e){if(!ended)updateDrafts(prev=>prev.map(d=>d.path===draft.path?{...d,needsReview:true,error:errorMessage(e)}:d));}finally{if(reads.current.get(draft.path)===request)reads.current.delete(draft.path);}}})();
    }
    return () => { ended = true; for (const read of reads.current.values()) read.cancel(); reads.current.clear(); owner.close(); CloseWorkspace(sessionID).catch(() => {}); };
  }, [sessionID]);
  useEffect(()=>{
    if(!initialLayout||restoreApplied.current)return;restoreApplied.current=true;setRestoring(true);let stopped=false;const bodyRequest=WorkspaceRecoveryDrafts(id);
    void(async()=>{try{
      const bodies=await bodyRequest;if(stopped)return;const paths=[...new Set([...(initialLayout.tabs||[]).filter(t=>t.kind==='file').map(t=>t.path),...(bodies||[]).map(d=>d.path)])];if(paths.length>64)throw new Error('恢复文件超过 64 个，请在本地草稿设置查看或清理后重试');setFileOrder(paths);
      updateDrafts(prev=>[...prev,...(bodies||[]).filter(d=>!prev.some(old=>old.path===d.path)).map(d=>({path:d.path,content:d.content,encoding:d.encoding,line_ending:d.line_ending,bom:d.bom,revision:'',saved:'',saving:false,error:'恢复草稿，连接后需对比最新远端内容',needsReview:true,recovery:true}))]);setFileViews(previous=>({...previous,...Object.fromEntries((bodies||[]).map(body=>[body.path,'text' as const]))}));setRestoreReady(true);
      const planned=(initialLayout.tabs||[]).map((tab,index)=>({tab,key:initialIDs[index]})).filter(t=>t.tab.kind==='terminal');
      if(!planned.length)await CloseTerminal(sessionID);
      for(let index=1;index<planned.length;index++){try{const result=await CreateTerminal(sessionID);if(stopped){CloseTerminal(result.id);return;}terminalOwners.current.set(result.id,sessionID);setTerminals(prev=>[...prev,result.id]);const old=planned[index].key;setSecondary(prev=>prev.map(id=>id===old?result.id:id));setSelection(prev=>prev.map(id=>id===old?result.id:id) as [string,string]);}catch(e){if(!stopped)setError(`部分终端未能恢复：${errorMessage(e)}`);break;}}
      for(const path of paths){if(stopped)return;if(isImagePath(path)&&!bodies?.some(body=>body.path===path))continue;const encoding=draftsRef.current.find(d=>d.path===path)?.encoding || 'UTF-8';const request=ReadRemoteFileEncoded(sessionID,path,encoding);reads.current.set(path,request);try{const doc=await request;if(stopped||reads.current.get(path)!==request)return;updateDrafts(prev=>{const old=prev.find(d=>d.path===path);return old?prev.map(d=>d.path===path?{...d,revision:doc.revision,saved:doc.content,savedFormat:formatKey(doc),needsReview:!!d.recovery,error:d.recovery?'恢复草稿，请先对比与合并':'',saving:false}:d):[...prev,{...doc,saved:doc.content,savedFormat:formatKey(doc),error:'',saving:false}];});}catch(e){if(stopped||reads.current.get(path)!==request)return;setPendingErrors(prev=>({...prev,[path]:{message:errorMessage(e),code:errorCode(e),encoding}}));updateDrafts(prev=>prev.map(d=>d.path===path?{...d,error:errorMessage(e),needsReview:true}:d));}finally{if(reads.current.get(path)===request)reads.current.delete(path);}}
      if(!stopped){setActivePane(initialLayout.active_pane);const first=(bodies||[])[0];if(first){setActive(first.path);setConflict(first.path);}}
    }catch(e){if(!stopped)setError(errorMessage(e));}finally{if(!stopped)setRestoring(false);}})();
    return()=>{stopped=true;bodyRequest.cancel();};
  },[sessionID,restoreEpoch]);
  useEffect(() => { dirtyCallback.current(dirty); viewReady.current?.then(()=>{if(!disposed.current)return SetWorkspaceDirty(id,currentDirty.current);}).catch(e => {if(!disposed.current)setError(errorMessage(e));}); }, [dirty, id]);
  useEffect(() => { const handler = (event: BeforeUnloadEvent) => { if (draftsRef.current.some(d => isDirty(d))) { event.preventDefault(); event.returnValue = ''; } }; window.addEventListener('beforeunload', handler); return () => window.removeEventListener('beforeunload', handler); }, []);

  async function open(entry: Entry,view?:'text'|'image') {
    await openPath(entry.path,'UTF-8',view);
  }
  async function openPath(path:string, encoding = 'UTF-8', view?:'text'|'image'){
    if(restoring||!restoreReady)throw new Error('请等待或重试本地草稿载入');
    if(!fileOrder.includes(path)&&new Set([...fileOrder,...reads.current.keys()]).size>=64)throw new Error('打开文件达到上限（64 个）');
    if(view)setFileViews(previous=>({...previous,[path]:view}));
    if(view==='image'||view!=='text'&&imageFile(path)){
      const request=reads.current.get(path);reads.current.delete(path);request?.cancel();
      setFileOrder(previous=>previous.includes(path)?previous:[...previous,path]);setActive(path);if(narrow)setNarrowPanel(null);return true;
    }
    if (draftsRef.current.some(d => d.path === path)) { setActive(path); if(narrow)setNarrowPanel(null); return true; }
    if (reads.current.has(path)) return;
    setFileOrder(prev=>prev.includes(path)?prev:[...prev,path]); setActive(path);
    if(narrow)setNarrowPanel(null);
    setPendingErrors(prev=>{const next={...prev};delete next[path];return next;});
    const request = ReadRemoteFileEncoded(sessionID, path, encoding); reads.current.set(path, request);
    try { const doc = await request; if (disposed.current || instance.current!==sessionID || reads.current.get(path)!==request) return false; updateDrafts(prev => [...prev, { ...doc, saved: doc.content, savedFormat: formatKey(doc), error: '', saving: false }]);setFileOrder(prev=>prev.includes(path)?prev:[...prev,path]); if(split&&activePane===1&&!fileOrder.includes(path)){setSecondary(prev=>[...prev,path]);setSelection(prev=>[prev[0],path]);}else setActive(path); return true; }
    catch(e) { if (!disposed.current && instance.current===sessionID && reads.current.get(path)===request) setPendingErrors(prev=>({...prev,[path]:{message:errorMessage(e),code:errorCode(e),encoding}})); return false; }
    finally { if(reads.current.get(path)===request)reads.current.delete(path); }
  }
  async function save(path: string): Promise<boolean> {
    const pending = saves.current.get(path); if (pending) return pending;
    const draft = draftsRef.current.find(d => d.path === path); if (!draft) return true;
    if (draft.needsReview) { updateDrafts(prev=>prev.map(d=>d.path===path?{...d,error:'请先核对最新远端内容，再保存草稿'}:d)); return false; }
    if (!isDirty(draft)) return true;
    updateDrafts(prev => prev.map(d => d.path === path ? { ...d, saving: true, error: '' } : d));
    const operation = (async () => {
      try {
        const authorization = draft.sudo ? await authorizeSudo(path, draft.encoding || 'UTF-8', 'save') : undefined;
        if (draft.sudo && !authorization) { updateDrafts(prev => prev.map(d => d.path === path ? { ...d, saving: false } : d)); return false; }
        if (disposed.current || instance.current !== sessionID) return false;
        const document = { path, content: draft.content, revision: draft.revision, ...documentFormat(draft) };
        const result = authorization ? await SaveSudoFile(sessionID, document, authorization.password) : await SaveRemoteFile(sessionID, document);
        if (disposed.current || instance.current!==sessionID) return false;
        updateDrafts(prev => prev.map(d => d.path === path ? { ...d, saved: result.content, savedFormat: formatKey(result), revision: result.revision, saving: false } : d));
        const current = draftsRef.current.find(d => d.path === path);
        return !!current && !isDirty(current);
      } catch (e) { if (!disposed.current) updateDrafts(prev => prev.map(d => d.path === path ? { ...d, saving: false, error: errorMessage(e) } : d)); return false; }
      finally { saves.current.delete(path); }
    })();
    saves.current.set(path, operation); return operation;
  }
  useImperativeHandle(ref, () => ({ sudoEdit: () => { void openSudo(); }, workspaceAction, layout,hasDirty:()=>draftsRef.current.some(d=>isDirty(d)), recoveryDrafts:()=>restoreReady?draftsRef.current.filter(d=>isDirty(d)).map(d=>({path:d.path,content:d.content,encoding:d.encoding,line_ending:d.line_ending,bom:d.bom})):null,insertionTarget:()=>terminalHandles.current.has(active)?active:'',insert:(text,target)=>target===active?terminalHandles.current.get(target)?.insert(text)||false:false, focus:()=>focusTab(), showFiles, locateDirectory: path => { showFiles(); setDirectoryRequest(previous => ({path, sequence: (previous?.sequence || 0) + 1, locate: true})); }, toggleMonitor, terminalAction: action => terminalHandles.current.get(active)?.action(action), toggleFocus: () => setFocus(prev => !prev), async prepareReconnect(){if(terminals.length>=16){setError('保留终端达到上限（16 个），请先关闭结束标签');return false;}if(saves.current.size||creating||preparing||restoring||sudoPrompt){setError('请等待当前保存、恢复或终端创建完成');return false;}setPreparing(true);try{await CloseWorkspace(sessionID);return !disposed.current;}finally{setPreparing(false);}}, async saveAll() { for (const draft of draftsRef.current) { if (!await save(draft.path)) { setActive(draft.path); return false; } } return !draftsRef.current.some(d => isDirty(d)); } }));

  function close(path: string, discard = false) {
    const draft = draftsRef.current.find(d => d.path === path);
    if (draft?.saving) return;
    if (!discard && draft && (isDirty(draft))) { setClosing(path); return; }
    const request = reads.current.get(path); reads.current.delete(path); request?.cancel();
    setFileViews(previous=>{const next={...previous};delete next[path];return next;});
    setFileJump(previous=>previous?.path===path?undefined:previous);
    setMarkdownAnchor(previous=>previous?.path===path?undefined:previous);
    updateDrafts(prev => prev.filter(d => d.path !== path));setFileOrder(prev=>prev.filter(p=>p!==path)); setSecondary(prev=>prev.filter(p=>p!==path));setPendingErrors(prev=>{const next={...prev};delete next[path];return next;}); setClosing('');
  }
  function requestReload(path: string, encoding: string) {
    if (reads.current.has(path)) return;
    setError(''); setReopenEncoding(encoding);
    const draft = draftsRef.current.find(d => d.path === path);
    if (draft && isDirty(draft)) setRereading(path); else void reread(path, encoding);
  }
  async function reread(path: string, encoding = reopenEncoding) {
    const sudo = draftsRef.current.find(d => d.path === path)?.sudo;
    const authorization = sudo ? await authorizeSudo(path, encoding, 'read') : undefined;
    if (sudo && !authorization || disposed.current || instance.current !== sessionID) return;
    setError(''); const request = authorization ? ReadSudoFile(sessionID, path, encoding, authorization.password) : ReadRemoteFileEncoded(sessionID, path, encoding); reads.current.set(path, request);
    try { const doc = await request; if (!disposed.current && instance.current===sessionID && reads.current.get(path)===request) { updateDrafts(prev => prev.map(d => d.path === path ? { ...doc, sudo, saved: doc.content, savedFormat: formatKey(doc), reloadEpoch:(d.reloadEpoch||0)+1, saving: false, error: '' } : d)); setRereading(''); } }
    catch (e) { if (!disposed.current && instance.current===sessionID && reads.current.get(path)===request) { updateDrafts(prev=>prev.map(d=>d.path===path?{...d,error:errorMessage(e)}:d)); setRereading(''); } } finally { if(reads.current.get(path)===request)reads.current.delete(path); }
  }
  const closingDraft = drafts.find(d => d.path === closing);
  function activate(path: string) { setActive(path); requestAnimationFrame(() => focusTab(path)); }
  function closeTab(path: string) { if (!terminals.includes(path)) { close(path); return; } terminalOwners.current.delete(path); setTerminals(prev => prev.filter(t => t !== path)); setSecondary(prev => prev.filter(p => p !== path)); }
  function workspaceAction(action: 'switchPane' | 'closeContent' | 'newTerminal') { if (restoring) return true; if (action === 'newTerminal') void newTerminal(); if (action === 'closeContent') { if (!active) return false; closeTab(active); } if (action === 'switchPane' && split) { const pane = 1 - activePane; setActivePane(pane); requestAnimationFrame(() => focusTab(paneSelected[pane])); } return true; }
  const tabs = tabIDs.map(path => { const draft = drafts.find(d => d.path === path); const terminal = terminals.includes(path); return { id: path, label: terminal ? `终端 ${terminals.indexOf(path) + 1}` : path.split('/').pop() || path, terminal, dirty: !!draft && isDirty(draft), closingDisabled: restoring || draft?.saving }; });
  return <div className="ssh-workspace" onKeyDown={event=>{if(event.key==='Escape'&&narrowPanel&&!event.defaultPrevented&&!event.nativeEvent.isComposing&&!(event.target as HTMLElement).closest('input,textarea,[role=dialog]')){event.preventDefault();const panel=narrowPanel;setNarrowPanel(null);(panel==='files'?filesToggle:monitorToggle).current?.focus();}}}>
    <div className="workspace-toolbar" aria-label="SSH 工作区工具"><Tooltip content={target}><span className="session-target">{target}</span></Tooltip>{environment && <span className={`connection-environment ${environment}`}>{({production:'生产',staging:'预发布',development:'开发'} as Record<string,string>)[environment]}</span>}{state !== '已连接' && <span className="session-state" role="status">{state}</span>}<button ref={filesToggle} className="session-tool" aria-pressed={filesShown} onClick={toggleFiles}><Icon name="files" width="15" />文件</button><button ref={monitorToggle} className="session-tool" aria-pressed={monitorShown} onClick={toggleMonitor}><Icon name="monitor" width="15" />监控</button>{state === '已断开' && <Button size="sm" variant="light" isDisabled={busy||preparing} onPress={onReconnect}>重新连接</Button>}<Dropdown><DropdownTrigger><Tooltip content="窗格布局"><button className="icon-button" aria-label="窗格布局"><Icon name="sidebar" width="16" /></button></Tooltip></DropdownTrigger><DropdownMenu aria-label="窗格操作" disabledKeys={[...(creating||terminals.length>=16?['new']:[]),...(!active?['move']:[]),...(!split?['maximize','merge']:[])]} onAction={key=>{if(key==='new')void newTerminal(1);if(key==='move')moveActive();if(key==='maximize')setMaximized(v=>!v);if(key==='merge'){setSplit(false);setSecondary([]);setSelection([active||paneSelected[0],'']);setActivePane(0);setMaximized(false);}}}><DropdownItem key="new">新建终端到右侧</DropdownItem><DropdownItem key="move">移动当前标签到另一窗格</DropdownItem><DropdownItem key="maximize">{maximized?'恢复双窗格':'最大化当前窗格'}</DropdownItem><DropdownItem key="merge">合并窗格</DropdownItem></DropdownMenu></Dropdown><Tooltip content="专注模式"><button className="icon-button focus-toggle" aria-label="专注模式" aria-pressed={focus} onClick={() => setFocus(!focus)}><Icon name="focus" width="16" /></button></Tooltip><Dropdown><DropdownTrigger><Tooltip content="SSH 会话操作"><button className="icon-button" aria-label="SSH 会话操作"><Icon name="more" width="15" /></button></Tooltip></DropdownTrigger><DropdownMenu aria-label="SSH 会话操作" disabledKeys={[...(busy || preparing ? ['reconnect'] : []), ...(!connectionID ? ['automatic'] : [])]} onAction={key => { if(key==='tunnels')setTunnelsOpen(v=>!v);else if (key === 'automatic') { reconnect.toggle(); if (reconnect.enabled) onCancelReconnect(); } else onReconnect(); }}><DropdownItem key="tunnels" showDivider endContent={tunnelsOpen?'✓':null}>端口转发</DropdownItem><DropdownItem key="reconnect">重新连接</DropdownItem><DropdownItem key="automatic" endContent={reconnect.enabled ? '✓' : null}>断线后自动重连</DropdownItem></DropdownMenu></Dropdown></div>
    <div hidden={!tunnelsOpen}><TunnelPanel id={sessionID} connectionID={connectionID} visible={visible&&tunnelsOpen}/></div>
    {reconnect.status && <div className="session-status" role="status"><span>{reconnect.status}</span><button className="session-tool" onClick={() => { reconnect.toggle(); onCancelReconnect(); }}>停止自动重连</button></div>}
    <div className="ssh-panels">
    {narrow && narrowPanel && <button className="panel-scrim" aria-label="关闭辅助面板" tabIndex={-1} onClick={()=>{const panel=narrowPanel;setNarrowPanel(null);(panel==='files'?filesToggle:monitorToggle).current?.focus();}} />}
    <div className="file-dock" hidden={!filesShown} style={{ width: filesWidth }}><FileBrowser id={sessionID} connectionID={connectionID} initialDirectory={initialLayout?.directory} onDirectory={setDirectory} directoryRequest={directoryRequest} followDirectory={followDirectory} onFollowDirectory={() => setFollowDirectory(value => !value)} onTerminalDirectory={locateInTerminal} visible={visible && filesShown} onOpen={open} onOpenFile={openTerminalFile} onClose={() => { toggleFiles(); filesToggle.current?.focus(); }} /></div>
    {filesShown && !narrow && <ResizeHandle label="文件面板宽度" value={filesWidth} min={200} max={420} onChange={setFilesWidth} />}
    <div className="ssh-center" ref={center}>
      <ErrorNotice message={error} onDismiss={() => setError('')} className="connection-feedback" />
      {!restoreReady&&!restoring&&<Button size="sm" onPress={()=>{restoreApplied.current=false;setRestoreEpoch(v=>v+1);}}>重试载入本地草稿</Button>}
      {restoring&&<div className="session-status" role="status">正在恢复文件与终端入口…</div>}
      {!tabIDs.length && <div className="workspace-empty">从标签栏新建终端或打开文件</div>}
      <WorkspacePanes split={split} maximized={maximized} ratio={ratio} onRatio={setRatio}>
      {[0, 1].map(pane => <PaneTabs key={`pane-${pane}`} pane={pane} newShortcut={shortcutLabel(shortcuts.newTerminal)} closeShortcut={shortcutLabel(shortcuts.closeContent)} items={tabs.filter(t => paneFor(t.id) === pane)} selected={paneSelected[pane]} focused={pane === activePane} hidden={(!split && pane === 1) || (maximized && pane !== activePane)} column={maximized || pane === 0 ? 1 : 3} creating={creating || restoring || terminals.length >= 16} onSelect={activate} onClose={closeTab} onNew={() => void newTerminal(pane)} />)}
      {terminals.map(terminal => <div className={`terminal-tab ${activePane===paneFor(terminal)?'focused-pane':''}`} data-tab-id={terminal} hidden={!shown(terminal)} style={{gridColumn:maximized?1:paneFor(terminal)===0?1:3,gridRow:2}} onFocusCapture={()=>setActivePane(paneFor(terminal))} key={terminal}><TerminalView ref={handle => { if (handle) terminalHandles.current.set(terminal, handle); else terminalHandles.current.delete(terminal); }} id={terminal} workspace={terminalOwners.current.get(terminal) || sessionID} host={target.slice(target.lastIndexOf('@')+1,target.lastIndexOf(':')).replace(/^\[|\]$/g,'')} onDirectory={(path, host) => terminalDirectory(terminal, path, host)} onFile={openTerminalFile} onSnippets={()=>{setActive(terminal);onSnippets();}} onConnectionChange={()=>changeCallback.current()} visible={visible && shown(terminal)} focusOnShow={activePane===paneFor(terminal)} fontSize={fontSize} /></div>)}
      {fileOrder.filter(path=>!imageFile(path)&&!drafts.some(d=>d.path===path)).map(path=>{
        const failure = pendingErrors[path];
        const retry = (encoding: string) => { void openPath(path,encoding,'text').catch(e=>setError(errorMessage(e))); };
        return <div key={path} className="editor-tab pending-file" data-tab-id={path} hidden={!shown(path)} style={{gridColumn:maximized?1:paneFor(path)===0?1:3,gridRow:2}}>
          <p className="file-path">{path}</p>
          {failure ? <ErrorNotice message={failure.message}/> : <p role="status" className="muted">正在读取文件…</p>}
          <div className="button-row">
            {failure?.code === 'file_encoding' && <SelectControl aria-label="以指定编码打开文件" value="" disabled={restoring||!restoreReady} onChange={e=>{if(e.target.value)retry(e.target.value);}}><option value="" disabled>选择编码…</option>{editorEncodings.map(([value,label])=><option key={value} value={value}>{label}</option>)}</SelectControl>}
            {failure && !['file_encoding','file_binary','file_too_large','file_not_regular'].includes(failure.code) && <Button size="sm" variant="bordered" isDisabled={restoring||!restoreReady} onPress={()=>retry(failure.encoding)}>重试读取</Button>}
            {failure && <Button size="sm" variant="light" isDisabled={restoring || !restoreReady || state !== '已连接'} onPress={() => void openSudo(path)}>以 sudo 打开</Button>}
            {failure && failure.code !== 'file_not_regular' && <Button size="sm" variant="light" onPress={()=>{void StartDownload(sessionID,path).catch(e=>setError(errorMessage(e)));}}>下载原文件</Button>}
            {failure?.code==='file_binary'&&<Button size="sm" variant="light" onPress={()=>{void openPath(path,'UTF-8','image').catch(e=>setError(errorMessage(e)));}}>预览图片</Button>}
            <Button size="sm" variant="light" onPress={()=>close(path)}>关闭文件</Button>
          </div>
        </div>;
      })}
      {fileOrder.filter(imageFile).map(path=><div key={`image:${path}`} className="editor-tab" data-tab-id={path} hidden={!shown(path)} style={{gridColumn:maximized?1:paneFor(path)===0?1:3,gridRow:2}} onFocusCapture={()=>setActivePane(paneFor(path))}><Suspense fallback={<div className="view-loading" role="status">正在载入图片预览…</div>}><ImagePreview workspace={sessionID} path={path} visible={visible&&shown(path)} onDownload={()=>{void StartDownload(sessionID,path).catch(e=>setError(errorMessage(e)));}} onText={()=>{void openPath(path,'UTF-8','text').catch(e=>setError(errorMessage(e)));}}/></Suspense></div>)}
      {drafts.map(d => <div key={d.path} className={`editor-tab ${activePane===paneFor(d.path)?'focused-pane':''}`} data-tab-id={d.path} hidden={!shown(d.path)||imageFile(d.path)} style={{gridColumn:maximized?1:paneFor(d.path)===0?1:3,gridRow:2}} onFocusCapture={()=>setActivePane(paneFor(d.path))}>
        {d.error && <div className="file-save-error"><p role="alert" className="error">{d.error}</p><div className="button-row"><Button size="sm" variant="light" isDisabled={d.saving} onPress={()=>setConflict(d.path)}>对比与合并</Button><Button size="sm" variant="light" onPress={() => setRereading(d.path)}>重新读取</Button><Button size="sm" variant="light" onPress={() => { navigator.clipboard.writeText(d.content).catch(e => setError(errorMessage(e))); }}>复制草稿</Button></div></div>}
        <Suspense fallback={<div className="view-loading" role="status">正在载入编辑器…</div>}><TextDocument workspace={sessionID} anchor={markdownAnchor?.path===d.path?markdownAnchor:undefined} onNavigate={(path,hash)=>{setMarkdownAnchor(previous=>({path,hash,sequence:(previous?.sequence||0)+1}));void openPath(path).catch(error=>setError(errorMessage(error)));}} completionShortcut={shortcuts.completion} path={d.path} jumpTo={fileJump?.path === d.path ? fileJump : undefined} content={d.content} format={documentFormat(d)} saving={d.saving} dirty={isDirty(d)} reloadEpoch={d.reloadEpoch} visible={visible && shown(d.path) && !imageFile(d.path)} focusOnShow={activePane===paneFor(d.path)} onChange={(value,format) => updateDrafts(prev => prev.map(item => item.path === d.path ? { ...item, ...format, content: value } : item))} onSave={() => void save(d.path)} onReload={encoding=>requestReload(d.path,encoding)} onDownload={()=>void DownloadFileDraft({...d,...documentFormat(d)}).catch(e=>updateDrafts(prev=>prev.map(item=>item.path===d.path?{...item,error:errorMessage(e)}:item)))} /></Suspense>
      </div>)}
      </WorkspacePanes>
    </div>
    <MonitorPanel id={sessionID} visible={visible && monitorShown} onDirectory={path => { showFiles(); setDirectoryRequest(previous => ({ path, sequence: (previous?.sequence || 0) + 1, locate: true })); }} onFile={path => openTerminalFile(path, 1)} onClose={() => { toggleMonitor(); monitorToggle.current?.focus(); }} />
    </div>
    {conflict && drafts.find(d=>d.path===conflict) && <Suspense fallback={<div className="session-status" role="status">正在载入差异视图…</div>}><FileConflictView key={`${sessionID}:${conflict}`} sessionID={sessionID} path={conflict} content={drafts.find(d=>d.path===conflict)!.content} encoding={savedEncoding(drafts.find(d=>d.path===conflict)!)} lineEnding={drafts.find(d=>d.path===conflict)!.line_ending || 'LF'} remoteDocument={sudoConflict} onClose={()=>setConflict('')} onApply={(content,remote)=>{updateDrafts(prev=>prev.map(d=>d.path===conflict?{...d,content,saved:remote.content,savedFormat:formatKey(remote),revision:remote.revision,needsReview:false,recovery:false,error:''}:d));setConflict('');}} /></Suspense>}
    {sudoPrompt && <SudoAuthorizationDialog {...sudoPrompt} target={target} onAnswer={answerSudo} />}
    <Modal isOpen={!!closingDraft} onClose={() => !closingDraft?.saving && setClosing('')} className="app-dialog"><ModalContent><ModalHeader>保存文件修改？</ModalHeader><ModalBody><p className="file-path">{closing}</p>{closingDraft?.error && <p className="error" role="alert">{closingDraft.error}</p>}</ModalBody><ModalFooter><Button variant="light" isDisabled={closingDraft?.saving} onPress={() => setClosing('')}>取消</Button><Button color="danger" variant="light" isDisabled={closingDraft?.saving} onPress={() => close(closing, true)}>放弃修改</Button><Button color="primary" isLoading={closingDraft?.saving} onPress={async () => { if (await save(closing)) close(closing, true); }}>保存并关闭</Button></ModalFooter></ModalContent></Modal>
    <Modal isOpen={!!rereading} onClose={() => setRereading('')} className="app-dialog"><ModalContent><ModalHeader>重新读取远端文件</ModalHeader><ModalBody><p className="file-path">{rereading}</p><p>将覆盖此文件的本地草稿。请先复制需要保留的内容。</p></ModalBody><ModalFooter><Button variant="light" onPress={() => setRereading('')}>取消</Button><Button color="danger" onPress={() => void reread(rereading)}>放弃草稿并重新读取</Button></ModalFooter></ModalContent></Modal>
  </div>;
});

export default SSHWorkspace;
