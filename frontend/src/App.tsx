import SelectControl from './components/SelectControl';
import { createRef, useEffect, useRef, useState, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import { Events } from '@wailsio/runtime';
import { Button, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Tooltip } from '@heroui/react';
import { GetCatalog, GetConnectionPreferences, RecordConnectionSuccess, SetRDPResolution, SetRDPClient, SystemRDPAvailable, ListSnippets, SetFrontendReady, UseSessionStorage, DiscardAndQuit } from '../bindings/github.com/Sanjeever/termquay/appservice';
import type { Snippet, SSHLayout, WorkspaceLayout, WorkspaceLayoutEntry } from '../bindings/github.com/Sanjeever/termquay/models';
import type { Connection, ConnectionPreference, Group } from '../bindings/github.com/Sanjeever/termquay/internal/store/models';
import type { Grant } from '../bindings/github.com/Sanjeever/termquay/internal/rdp/models';
import SSHWorkspace, { type SSHWorkspaceHandle } from './features/files/SSHWorkspace';
import RDPView, { type RDPHandle, type RDPOptions } from './features/rdp/RDPView';
import SettingsView from './features/settings/SettingsView';
import TransferPanel from './features/files/TransferPanel';
import useTransfers from './features/files/useTransfers';
import Workbench from './components/layout/Workbench';
import WorkspaceTabs from './components/layout/WorkspaceTabs';
import ConnectionCenter from './features/connections/ConnectionCenter';
import ConnectionDialog from './features/connections/ConnectionDialog';
import HostTrustDialog from './features/connections/HostTrustDialog';
import SSHChallengeDialog from './features/connections/SSHChallengeDialog';
import BatchCommandDialog from './features/terminal/BatchCommandDialog';
import { GetPortableUI, SavePortableUI } from '../bindings/github.com/Sanjeever/termquay/appservice';
import { applyPortableUI, capturePortableUI } from './features/settings/portable';
import useAutomaticBackup from './features/settings/useAutomaticBackup';
import { ExportDiagnostics } from '../bindings/github.com/Sanjeever/termquay/appservice';
import useConnectionAttempt from './features/connections/useConnectionAttempt';
import Icon from './components/Icon';
import CommandPalette, { type WorkbenchCommand } from './components/CommandPalette';
import { defaultShortcuts, mergeShortcuts, eventShortcut, shortcutConflict, shortcutDefinitions, shortcutLabel, shortcutStorageKey, type Shortcuts } from './lib/shortcuts';
import SnippetInsertDialog from './features/terminal/SnippetInsertDialog';
import useDraftRecovery from './features/workspaces/useDraftRecovery';
import useWorkspaceRestore from './features/workspaces/useWorkspaceRestore';
import WorkspaceRestoreDialog from './features/workspaces/WorkspaceRestoreDialog';
import { nextWorkspaceAfterClose } from './lib/workspaces';
import type { CommandKind } from './lib/commands';

type Workspace = { id: string; sessionID?: string; connection?: Connection; connectionID: string; name: string; state?: string; restore?:SSHLayout; restored?:boolean; rdp?: { connection: Connection; grant?: Grant; error?: string; options: RDPOptions }; view?: RefObject<RDPHandle>; ssh?: RefObject<SSHWorkspaceHandle>; dirty?: boolean };

export default function App() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [active, setActive] = useState('');
  const [catalog, setCatalog] = useState<{ groups: Group[]; connections: Connection[]; session_only: boolean }>();
  const [storageError, setStorageError] = useState('');
  const [catalogLoading, setCatalogLoading] = useState(true);
  const automaticBackup = useAutomaticBackup(!!catalog);
  const [preferences, setPreferences] = useState<Record<string, ConnectionPreference | undefined>>({});
  const [preferenceError, setPreferenceError] = useState('');
  const [dialog, setDialog] = useState<{ connection?: Connection; temporary: boolean; workspaceID?: string; rdpOptions?: RDPOptions }>();
  const [rdpStart, setRDPStart] = useState<{connection:Connection;options:RDPOptions}>();
  const [systemRDP, setSystemRDP] = useState(false);
  useEffect(() => { SystemRDPAvailable().then(setSystemRDP).catch(e => setPreferenceError(String(e))); return Events.On('rdp:system-error', event => setPreferenceError((event.data as {error:string}).error)); }, []);
  const [settings, setSettings] = useState(false);
  const [settingsSection,setSettingsSection]=useState('appearance');
  const [closing, setClosing] = useState('');
  const [quitConfirm, setQuitConfirm] = useState(false);
  const [savingClose, setSavingClose] = useState(false);
  const [closeError, setCloseError] = useState('');
  const [exitPersistenceError,setExitPersistenceError]=useState(false);
  const [transfersOpen, setTransfersOpen] = useState(false);
  const [transferHeight, setTransferHeight] = useState(Number(localStorage.getItem('termquay.layout.transfer-height')) || 220);
  const transfers = useTransfers();
  const [fontSize, setFontSize] = useState(Math.max(11, Math.min(24, Number(localStorage.getItem('termquay.terminal.font-size')) || 14)));
  const [palette, setPalette] = useState(false);
  const [paletteScope, setPaletteScope] = useState<'all' | CommandKind>('all');
  const [paletteQuery,setPaletteQuery]=useState('');
  const recentWorkspaces = useRef<string[]>([]);
  useEffect(() => { if (active) recentWorkspaces.current = [active, ...recentWorkspaces.current.filter(id => id !== active)].slice(0, 16); }, [active]);
  const [snippets,setSnippets]=useState<Snippet[]>([]);
  const [snippetError,setSnippetError]=useState('');
  const [snippetInsert,setSnippetInsert]=useState<{snippet:Snippet;workspace:string;terminal:string}>();
  const [batchCommandOpen, setBatchCommandOpen] = useState(false);
  const [shortcuts, setShortcuts] = useState<Shortcuts>({ ...defaultShortcuts });
  const [shortcutError, setShortcutError] = useState('');
  const current = workspaces.find(w => w.id === active);
  const latestWorkspaces = useRef(workspaces); latestWorkspaces.current = workspaces;
  const tabNavigation = useRef(false);
  const closingKeyboard = useRef(false);
  const recovery=useDraftRecovery();
  const workspaceRestore=useWorkspaceRestore();
  const [restoreDialog,setRestoreDialog]=useState<WorkspaceLayout>();
  const restorePrompted=useRef(false);
  const autoQuitting=useRef(false);
  const nativeClose=useRef<()=>void>(()=>{});
  function notifyRecovery(items=latestWorkspaces.current){if(!recovery.enabled)return;recovery.queue(items.flatMap(w=>{const documents=w.ssh?.current?.recoveryDrafts();return documents?[{workspace:w.id,name:w.name,documents}]:[];}));}
  function notifyLocalState(items=latestWorkspaces.current){notifyRecovery(items);const entries:WorkspaceLayoutEntry[]=[];for(const w of items){const c=w.rdp?.connection||w.connection;if(!c)return;const ssh=w.ssh?.current?.layout()||w.restore;if(c.protocol==='ssh'&&!ssh)return;entries.push({id:w.id,connection_id:w.connectionID,name:w.name,target:{name:c.name,protocol:c.protocol,host:c.host,port:c.port,username:c.username,domain:c.domain||'',auth_method:c.auth_method||'',identity_agent:c.identity_agent||'',jump_id:c.jump_id||'',mfa:c.mfa},...(ssh?{ssh}:{})});}workspaceRestore.queue({version:entries.some(e=>e.target.mfa||e.target.auth_method==='keyboard_interactive')?4:entries.some(e=>e.target.jump_id)?3:entries.some(e=>e.target.auth_method||e.target.identity_agent)?2:1,active:items.some(w=>w.id===active)?active:'',entries});}
  async function flushLocalState(){notifyLocalState();await workspaceRestore.flush();await recovery.flush();}
  nativeClose.current=()=>{if(autoQuitting.current)return;if(latestWorkspaces.current.some(w=>w.ssh?.current?.hasDirty())){setQuitConfirm(true);return;}autoQuitting.current=true;void(async()=>{try{await flushLocalState();await DiscardAndQuit();}catch(e){setCloseError(String(e));setExitPersistenceError(true);setQuitConfirm(true);}finally{autoQuitting.current=false;}})();};
  useEffect(()=>{notifyLocalState();},[workspaces,active,recovery.enabled,workspaceRestore.startup]);
  useEffect(()=>{if(restorePrompted.current||!catalog||!workspaceRestore.startup)return;restorePrompted.current=true;if(workspaceRestore.startup.entries?.length&&!workspaces.length&&!dialog&&!settings)setRestoreDialog(workspaceRestore.startup);},[catalog,workspaceRestore.startup]);

  function remove(id: string, keyboard = false) {
    attempt.cancelWorkspace(id);
    latestWorkspaces.current.find(w => w.id === id)?.view?.current?.cancel();
    notifyLocalState(latestWorkspaces.current.filter(w=>w.id!==id));
    setWorkspaces(prev => prev.filter(w => w.id !== id));
    setActive(prev => nextWorkspaceAfterClose(latestWorkspaces.current, prev, id, recentWorkspaces.current));
    if (keyboard) { tabNavigation.current = true; requestAnimationFrame(() => document.querySelector<HTMLElement>('.workspace-tabs [role=tab][aria-selected=true]')?.focus()); }
  }
  function select(id: string, keyboard = false) { tabNavigation.current = keyboard; setActive(id); setSettings(false); }
  function moveWorkspace(id: string, target: string) {
    setWorkspaces(prev => { const from = prev.findIndex(w => w.id === id); const to = prev.findIndex(w => w.id === target); if (from < 0 || to < 0 || from === to) return prev; const next = [...prev]; next.splice(to, 0, next.splice(from, 1)[0]); return next; });
  }
  function workspaceState(id: string, state: string) { setWorkspaces(prev => prev.map(w => w.id === id && w.state !== state ? { ...w, state } : w)); }
  async function recordSuccess(id: string) { if (!id) return; try { await RecordConnectionSuccess(id); setPreferences(await GetConnectionPreferences() || {}); } catch (e) { setPreferenceError(`记录最近连接失败：${String(e)}`); } }
  async function saveRDPResolution(id: string, value: string) { if (!id) return; await SetRDPResolution(id,value); setPreferences(await GetConnectionPreferences() || {}); }
  const attempt = useConnectionAttempt((id, connection, reuse, automatic) => {
    if(reuse&&!latestWorkspaces.current.some(w=>w.id===reuse))throw new Error('工作区已关闭');
    if(!reuse&&latestWorkspaces.current.length>=16)throw new Error('打开工作区达到上限（16 个）');
    setWorkspaces(prev => reuse?prev.map(w=>w.id===reuse?{...w,sessionID:id,connection,connectionID:connection.id,restored:false}:w):[...prev, { id, sessionID:id, connection, connectionID: connection.id, name: connection.name, ssh: createRef<SSHWorkspaceHandle>() }]); if (!automatic) select(reuse||id);
    void recordSuccess(connection.id);
  }, (connection, reuse, options = {clipboard:false,resolution:preferences[connection.id]?.rdp_resolution || 'dynamic'}) => {
    if(!reuse&&latestWorkspaces.current.length>=16)throw new Error('打开工作区达到上限（16 个）');
    const id = reuse || crypto.randomUUID();
    flushSync(() => {
      setWorkspaces(prev => reuse ? prev.map(w => w.id === id ? { ...w, connection,connectionID: connection.id,restored:false, rdp: { connection, options } } : w) : [...prev, { id, connectionID: connection.id, name: connection.name, rdp: { connection, options }, view: createRef<RDPHandle>() }]);
      select(id);
    });
    return id;
  }, async (id, grant, username, password, domain) => {
    flushSync(() => setWorkspaces(prev => prev.map(w => w.id === id ? { ...w, rdp: { ...w.rdp!, grant } } : w)));
    const view = latestWorkspaces.current.find(w => w.id === id)?.view?.current;
    if (!view) throw new Error('工作区已关闭');
    await view.connect(username, password, domain);
    const connectionID = latestWorkspaces.current.find(w => w.id === id)?.connectionID;
    if (connectionID) void recordSuccess(connectionID);
  }, (id, error) => setWorkspaces(prev => prev.map(w => w.id === id ? { ...w, rdp: { ...w.rdp!, error } } : w)), id => latestWorkspaces.current.find(w => w.id === id)?.view?.current?.cancel(), remove);

  async function reload() { setCatalogLoading(true); try { const data = await GetCatalog(); setCatalog({ ...data, groups: data.groups ?? [], connections: data.connections ?? [] }); setStorageError(''); try { setPreferences(await GetConnectionPreferences() || {}); setPreferenceError(''); } catch (e) { setPreferenceError(String(e)); } } catch (e) { setStorageError(String(e)); } finally { setCatalogLoading(false); } }
  useEffect(() => { void reload(); }, []);
  useEffect(()=>{if(!palette||!current?.ssh){setSnippets([]);return;}let ended=false;const request=ListSnippets();request.then(values=>{if(!ended){setSnippets(values||[]);setSnippetError('');}}).catch(e=>{if(!ended)setSnippetError(String(e));});return()=>{ended=true;request.cancel();};},[palette,active]);
  useEffect(() => {
    try {
      const stored = localStorage.getItem(shortcutStorageKey); if (!stored) return;
      const values = mergeShortcuts(JSON.parse(stored));
      for (const d of shortcutDefinitions) { if (typeof values[d.id] !== 'string' || shortcutConflict(d.id, values[d.id], values)) throw new Error('快捷键配置无效，请在设置中复位'); }
      setShortcuts(values);
    } catch (e) { setShortcutError(String(e)); }
  }, []);
  function saveShortcuts(values: Shortcuts) { try { localStorage.setItem(shortcutStorageKey, JSON.stringify(values)); setShortcuts(values); setShortcutError(''); window.dispatchEvent(new Event('termquay:portable-changed')); } catch (e) { setShortcutError(String(e)); } }
  useEffect(() => {
    if (!catalog) return;
    let ended = false; let timer: ReturnType<typeof setTimeout>;
    const restored = () => { try { setShortcuts(mergeShortcuts(JSON.parse(localStorage.getItem(shortcutStorageKey) || '{}'))); } catch (e) { setShortcutError(String(e)); } };
    const save = () => { clearTimeout(timer); timer = setTimeout(() => { try { SavePortableUI(capturePortableUI()).catch(e => { if (!ended) setPreferenceError(`界面设置保存失败：${String(e)}`); }); } catch (e) { setPreferenceError(String(e)); } }, 300); };
    window.addEventListener('termquay:portable-restored', restored); window.addEventListener('termquay:portable-changed', save);
    GetPortableUI().then(async values => { if (ended) return; if (Object.keys(values || {}).length) applyPortableUI(values); else await SavePortableUI(capturePortableUI()); }).catch(e => { if (!ended) setPreferenceError(String(e)); });
    return () => { ended = true; clearTimeout(timer); window.removeEventListener('termquay:portable-restored', restored); window.removeEventListener('termquay:portable-changed', save); };
  }, [catalog?.session_only]);
  useEffect(() => {const off=Events.On('app:close-requested',()=>nativeClose.current());SetFrontendReady().catch(e=>setPreferenceError(`退出协调初始化失败：${String(e)}`));return off;}, []);
  useEffect(() => { localStorage.setItem('termquay.layout.transfer-height', String(transferHeight)); }, [transferHeight]);
  useEffect(() => { localStorage.setItem('termquay.terminal.font-size', String(fontSize)); }, [fontSize]);
  useEffect(() => {
    if (dialog || rdpStart || restoreDialog || snippetInsert || attempt.trust || closing || quitConfirm || palette || settings) return;
    if (tabNavigation.current) { tabNavigation.current = false; return; }
    const frame = requestAnimationFrame(() => { if (current?.rdp) current.view?.current?.focus(); else current?.ssh?.current?.focus(); });
    return () => cancelAnimationFrame(frame);
  }, [active, dialog, rdpStart, restoreDialog, snippetInsert, attempt.trust, closing, quitConfirm, palette, settings]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.isComposing || event.repeat || dialog || attempt.trust || closing || quitConfirm) return;
      const path = event.composedPath();
      if (path.some(target => target instanceof HTMLElement && target.matches('[role=dialog], .shortcut-recorder'))) return;
      if (path.some(target => target instanceof HTMLElement && target.matches('.rdp-canvas')) && path.some(target => target instanceof HTMLElement && target.matches('.rdp-view[data-keyboard-target=remote]'))) return;
      const key = eventShortcut(event); if (!key) return;
      const terminal = !settings && !!current?.ssh && path.some(target => target instanceof HTMLElement && target.matches('.xterm'));
      const action = shortcutDefinitions.find(d => shortcuts[d.id] === key && (d.scope === 'app' || (d.scope === 'workspace' && !settings && current?.ssh) || terminal));
      if (!action) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (action.id === 'palette') { setPaletteScope('all'); setPaletteQuery(''); setPalette(prev => !prev); }
      else if (action.id === 'settings') setSettings(true);
      else if (action.id === 'nextWorkspace' || action.id === 'previousWorkspace') { const ids = ['', ...workspaces.map(w=>w.id)]; select(ids[(ids.indexOf(active) + (action.id === 'nextWorkspace' ? 1 : -1) + ids.length) % ids.length]); }
      else if (action.scope === 'workspace') current?.ssh?.current?.workspaceAction(action.id);
      else current?.ssh?.current?.terminalAction(action.id);
    };
    window.addEventListener('keydown', key, true); return () => window.removeEventListener('keydown', key, true);
  }, [dialog, attempt.trust, closing, quitConfirm, shortcuts, settings, current, workspaces, active]);
  function openDialog(temporary: boolean, connection?: Connection) { if (attempt.busy) return; attempt.clearError(); setDialog({ temporary, connection, rdpOptions:{clipboard:false,resolution:preferences[connection?.id || '']?.rdp_resolution || 'dynamic'} }); }
  function openSaved(c: Connection, another = false, clientOverride?: string) {
    const client = clientOverride || preferences[c.id]?.rdp_client || 'internal';
    if (c.protocol === 'rdp' && clientOverride === 'system' && !attempt.busy) { void attempt.start(c,undefined,undefined,{client,clipboard:false,resolution:preferences[c.id]?.rdp_resolution || 'dynamic'}); return; }
    const existing = client !== 'system' && !another && workspaces.find(w => w.connectionID === c.id);
    if (existing) { select(existing.id); return; }
    if (c.protocol === 'rdp' && !attempt.busy) { setRDPStart({connection:c,options:{clipboard:false,resolution:preferences[c.id]?.rdp_resolution || 'dynamic',client}}); return; }
    if (!attempt.busy) void attempt.start(c);
  }
  function editRDP(w: Workspace) {
    if (attempt.busy || !w.rdp) return;
    const candidate = catalog?.connections.find(c => c.id === w.connectionID);
    const saved=candidate&&(!w.restored||sameTarget(candidate,w.rdp.connection))?candidate:undefined;
    attempt.clearError();
    setDialog({ connection: saved || { ...w.rdp.connection, id: '', credential_id: '' }, temporary: !saved, workspaceID: w.id, rdpOptions:w.view?.current?.options() || w.rdp.options });
  }
  function retryRDP(w: Workspace) {
    const saved = catalog?.connections.find(c => c.id === w.connectionID);
    if(saved&&saved.protocol!=='rdp'){setPreferenceError('保存配置的协议已改变，请新建工作区');return;}
    if(saved&&w.restored&&w.rdp&&!sameTarget(saved,w.rdp.connection)){setPreferenceError('保存配置目标已改变，请编辑恢复入口后确认连接');return;}
    if (saved) void attempt.start(saved, undefined, w.id, w.view?.current?.options() || w.rdp?.options); else editRDP(w);
  }
  async function connect(connection:Connection, auth?:Parameters<typeof attempt.start>[1], reuse?:string, options?:RDPOptions){
    const workspace=reuse?latestWorkspaces.current.find(w=>w.id===reuse):undefined;
    if(reuse&&!workspace)return false;
    if(workspace&&(workspace.rdp?'rdp':workspace.connection?.protocol)!==connection.protocol){setPreferenceError('工作区协议不能改变，请新建工作区');return false;}
    if(workspace?.ssh?.current&&!await workspace.ssh.current.prepareReconnect())return false;
    return attempt.start(connection,auth,reuse,options);
  }
  function sameTarget(a:Connection,b:Connection){return a.protocol===b.protocol&&a.host===b.host&&a.port===b.port&&a.username===b.username&&(a.domain||'')===(b.domain||'');}
  function reconnectSSH(w:Workspace){const saved=catalog?.connections.find(c=>c.id===w.connectionID);if(saved&&saved.protocol!=='ssh'){setPreferenceError('保存配置的协议已改变，请新建工作区');return;}if(saved&&w.restored&&w.connection&&!sameTarget(saved,w.connection)){setPreferenceError('保存配置目标已改变，请重新填写恢复入口后确认连接');return;}if(saved)void connect(saved,undefined,w.id);else if(w.connection)setDialog({connection:{...w.connection,id:'',credential_id:''},temporary:true,workspaceID:w.id});}
  async function automaticReconnectSSH(w: Workspace) {
    const saved = catalog?.connections.find(c => c.id === w.connectionID);
    if (!saved || !w.connection || !sameTarget(saved, w.connection) || saved.jump_id !== w.connection.jump_id || saved.mfa || saved.auth_method === 'keyboard_interactive') return { ok: false, retryable: false };
    if (!await w.ssh?.current?.prepareReconnect()) return { ok: false, retryable: false };
    const ok = await attempt.start(saved, undefined, w.id, undefined, true);
    return { ok, retryable: attempt.canRetry() };
  }
  async function restoreWorkspaces(entries:WorkspaceLayoutEntry[]){await recovery.flush();const currentIDs=new Set(latestWorkspaces.current.map(w=>w.id));const values=entries.filter(e=>!currentIDs.has(e.id));if(values.length+currentIDs.size>16)throw new Error('打开工作区达到上限（16 个）');const restored:Workspace[]=values.map(e=>{const c:Connection={...e.target,id:e.connection_id,group_id:'',credential_id:''};return {id:e.id,connectionID:e.connection_id,connection:c,name:e.name,state:'未连接',restored:true,...(c.protocol==='ssh'?{ssh:createRef<SSHWorkspaceHandle>(),restore:e.ssh||undefined}:{rdp:{connection:c,options:{clipboard:false,resolution:preferences[c.id]?.rdp_resolution||'dynamic'}},view:createRef<RDPHandle>()})};});setWorkspaces(prev=>[...prev,...restored]);if(restored.length)select(restored.some(w=>w.id===restoreDialog?.active)?restoreDialog!.active:restored[0].id);}
  const tools = <>
    <Tooltip content={`命令搜索 · ${shortcutLabel(shortcuts.palette)}`}><button className="icon-button" aria-label="命令搜索" onClick={() => { setPaletteScope('all'); setPaletteQuery(''); setPalette(true); }}><Icon name="search" /></button></Tooltip>
    <Tooltip content="设置"><button className="icon-button" aria-label="设置" aria-pressed={settings} onClick={() => setSettings(!settings)}><Icon name="settings" /></button></Tooltip>
  </>;
  const commands: WorkbenchCommand[] = [
    ...workspaces.map(w => { const c = w.rdp?.connection || w.connection; return { id: `workspace-${w.id}`, label: w.name, detail: `${c?.protocol.toUpperCase()} · ${c?.username}@${c?.host}:${c?.port}`, search: catalog?.groups.find(g=>g.id===c?.group_id)?.name, kind: 'workspace' as const, run: () => select(w.id) }; }),
    ...(catalog?.connections || []).map(c => ({ id: `connection-${c.id}`, label: c.name, detail: `${c.protocol.toUpperCase()} · ${c.username}@${c.host}:${c.port}`, search: catalog?.groups.find(g=>g.id===c.group_id)?.name, kind: 'connection' as const, run: () => openSaved(c) })),
    { id: 'new', label: '新建连接', kind: 'command', run: () => openDialog(false) },
    { id: 'quick', label: '快速连接', kind: 'command', run: () => openDialog(true) },
    { id: 'connections', label: '进入连接中心', kind: 'command', run: () => select('') },
    ...(current?.ssh ? [{ id: 'files', label: '显示远端文件', kind: 'command' as const, run: () => current.ssh?.current?.showFiles() }, { id: 'monitor', label: '切换监控面板', kind: 'command' as const, run: () => current.ssh?.current?.toggleMonitor() }, { id: 'focus', label: '切换专注模式', kind: 'command' as const, run: () => current.ssh?.current?.toggleFocus() }] : []),
    ...(current?.ssh ? shortcutDefinitions.filter(d => d.scope === 'terminal').map(d => ({ id: `terminal-${d.id}`, label: d.label, detail: shortcutLabel(shortcuts[d.id]), kind: 'command' as const, run: () => current.ssh?.current?.terminalAction(d.id) })) : []),
    ...(current?.ssh ? shortcutDefinitions.filter(d=>d.scope==='workspace').map(d=>({id:d.id,label:d.label,detail:shortcutLabel(shortcuts[d.id]),kind:'command' as const,run:()=>current.ssh?.current?.workspaceAction(d.id)})) : []),
    { id: 'transfers', label: '查看传输任务', kind: 'command', run: () => setTransfersOpen(true) },
    { id: 'batch-command', label: '多主机执行命令', kind: 'command', run: () => setBatchCommandOpen(true) },
    { id: 'diagnostics', label: '导出脱敏诊断信息', kind: 'command', run: () => { ExportDiagnostics().catch(e => setPreferenceError(String(e))); } },
    { id: 'settings', label: '打开设置', kind: 'command', run: () => setSettings(true) },
    ...(workspaceRestore.startup?.entries?.length?[{id:'restore-layout',label:'恢复上次工作布局',kind:'command' as const,run:()=>setRestoreDialog(workspaceRestore.startup)}]:[]),
    ...(current?.ssh?.current?.insertionTarget()?snippets.map(snippet=>({id:`snippet-${snippet.id}`,label:`插入片段 ${snippet.name}`,detail:snippet.group,kind:'command' as const,run:()=>{const target=current.ssh?.current?.insertionTarget();if(target)setSnippetInsert({snippet,workspace:current.id,terminal:target});}})):[]),
  ];
  return <>
    <Workbench tabs={<WorkspaceTabs items={workspaces} active={active} onSelect={select} onClose={(id, keyboard) => { closingKeyboard.current = !!keyboard; if (workspaces.find(w => w.id === id)?.ssh?.current?.hasDirty()) setClosing(id); else remove(id, keyboard); }} onSearch={() => { setPaletteScope('workspace'); setPalette(true); }} onNew={() => openDialog(false)} onMove={moveWorkspace} onRename={(id, name) => setWorkspaces(prev => prev.map(w => w.id === id ? { ...w, name } : w))} />} tools={tools} settings={settings}
      status={<><span>{catalog?.session_only ? '会话存储' : '本地工作台'}</span><span>{workspaces.length} 个工作区</span><div className="status-spacer" />{recovery.error&&<button className="error" onClick={()=>{setSettingsSection('recovery');setSettings(true);}}>本地草稿保存失败</button>}<button className={transfers.failed || transfers.error ? 'error' : ''} aria-expanded={transfersOpen} onClick={() => setTransfersOpen(!transfersOpen)}><Icon name="transfer" width="14" />{transfers.running ? `传输 ${transfers.running} 进行中` : transfers.items.length ? `传输 ${transfers.items.length} 项` : '传输'}{transfers.waiting ? ` · ${transfers.waiting} 等待` : ''}{transfers.failed ? ` · ${transfers.failed} 失败` : ''}{transfers.error ? ' · 加载失败' : ''}</button></>}>
      {storageError && <div className="storage-error error" role="alert">{storageError}<Button size="sm" onPress={() => { UseSessionStorage().then(async()=>{await reload();await recovery.refresh();}).catch(e => setStorageError(String(e))); }}>使用会话存储</Button></div>}
      {!dialog && (attempt.busy || (attempt.error && !current?.rdp)) && <div className="connection-feedback" role={attempt.error ? 'alert' : 'status'}><span className={attempt.error ? 'error' : ''}>{attempt.target} · {attempt.error || '正在连接…'}</span>{attempt.busy && <Button size="sm" variant="light" onPress={attempt.cancel}>取消连接</Button>}{!attempt.busy && <button className="icon-button" aria-label="关闭连接错误" onClick={attempt.clearError}><Icon name="close" /></button>}</div>}
      {settings && <SettingsView key={settingsSection} initialSection={settingsSection} recovery={recovery} fontSize={fontSize} onFontSize={setFontSize} onRestore={() => void reload()} onClose={() => setSettings(false)} shortcuts={shortcuts} onShortcuts={saveShortcuts} shortcutError={shortcutError} automaticBackup={automaticBackup} />}
      {preferenceError && <div role="alert" className="connection-feedback error">{preferenceError}</div>}
      {(automaticBackup.error || automaticBackup.status?.error) && !settings && <div className="connection-feedback error" role="alert"><button className="session-tool" onClick={() => { setSettingsSection('backup'); setSettings(true); }}>自动备份失败 · 查看详情</button></div>}
      <div className="connection-center-page" hidden={settings || !!current}><ConnectionCenter connections={catalog?.connections || []} groups={catalog?.groups || []} preferences={preferences} sessions={Object.fromEntries((catalog?.connections || []).map(c => [c.id, workspaces.filter(w => w.connectionID === c.id).map(w => w.state || '连接中')]))} onOpen={openSaved} onEdit={c => openDialog(false, c)} onNew={openDialog} onReload={() => void reload()} busy={attempt.busy} loading={catalogLoading} loadError={storageError} systemRDP={systemRDP} /></div>
      {workspaces.map(w => <div className="workspace" hidden={settings || active !== w.id} key={w.id}>{w.rdp ? <RDPView target={`${w.rdp.connection.username}@${w.rdp.connection.host}:${w.rdp.connection.port}`} environment={preferences[w.connectionID]?.environment || ''} grant={w.rdp.grant} failure={w.rdp.error} busy={attempt.busy} pending={attempt.busy&&attempt.workspaceID===w.id} options={w.rdp.options} onResolution={value=>saveRDPResolution(w.connectionID,value)} onRetry={() => retryRDP(w)} onEdit={() => editRDP(w)} ref={w.view} visible={!settings && active === w.id} onState={state => workspaceState(w.id, state)} /> : w.sessionID ?
        <SSHWorkspace onSnippets={()=>{setPaletteScope('command');setPaletteQuery('插入片段 ');setPalette(true);}} id={w.id} sessionID={w.sessionID} initialLayout={w.restore} connectionID={w.connectionID} target={`${w.connection?.username}@${w.connection?.host}:${w.connection?.port}`} environment={preferences[w.connectionID]?.environment || ''} state={w.state || '连接中'} shortcuts={shortcuts} ref={w.ssh} fontSize={fontSize} busy={attempt.busy} onStateChange={()=>notifyLocalState()} onReconnect={()=>reconnectSSH(w)} onAutomaticReconnect={() => automaticReconnectSSH(w)} onCancelReconnect={() => attempt.cancelWorkspace(w.id)} visible={!settings && active === w.id} onDirtyChange={dirty => setWorkspaces(prev => prev.map(item => item.id === w.id ? { ...item, dirty } : item))} onState={state => workspaceState(w.id, state)} /> :
        <div className="restored-workspace"><h2>尚未连接</h2><p>{w.connection?.username}@{w.connection?.host}:{w.connection?.port}</p><div className="button-row"><Button size="sm" color="primary" isDisabled={attempt.busy} onPress={()=>reconnectSSH(w)}>连接</Button><Button size="sm" variant="light" isDisabled={attempt.busy} onPress={()=>{if(w.connection)setDialog({connection:{...w.connection,id:'',credential_id:''},temporary:true,workspaceID:w.id});}}>重新填写连接</Button></div><ul>{(w.restore?.tabs||[]).filter(t=>t.kind==='file').map(t=><li className="file-path" key={t.path}>{t.path}</li>)}</ul></div>}
      </div>)}
      {transfersOpen && <TransferPanel tasks={transfers} height={transferHeight} onHeight={setTransferHeight} onClose={() => setTransfersOpen(false)} />}
    </Workbench>
    {dialog && <ConnectionDialog {...dialog} systemRDP={systemRDP} preference={preferences[dialog.connection?.id || '']} groups={catalog?.groups || []} connections={catalog?.connections||[]} busy={attempt.busy} connectionError={attempt.error} onConnect={(connection, auth, options) => connect(connection, auth, dialog.workspaceID, options)} onSaved={() => void reload()} onClose={() => { setDialog(undefined); attempt.clearError(); }} onCancel={attempt.cancel} />}
    <Modal isOpen={!!rdpStart} onClose={()=>setRDPStart(undefined)} className="app-dialog"><ModalContent><ModalHeader>连接远程桌面</ModalHeader><ModalBody>{rdpStart && <><p>{rdpStart.connection.name}</p><label className="form-field">连接方式<SelectControl value={rdpStart.options.client || 'internal'} onChange={e=>setRDPStart({...rdpStart,options:{...rdpStart.options,client:e.target.value}})}><option value="internal">内置客户端</option><option value="system" disabled={!systemRDP}>系统客户端（mstsc）</option></SelectControl></label><label className="checkbox-label"><input type="checkbox" checked={rdpStart.options.clipboard} onChange={e=>setRDPStart({...rdpStart,options:{...rdpStart.options,clipboard:e.target.checked}})} />文本剪贴板</label><label className="form-field">远端分辨率<SelectControl value={rdpStart.options.resolution} onChange={e=>setRDPStart({...rdpStart,options:{...rdpStart.options,resolution:e.target.value}})}><option value="dynamic">适应窗口</option><option value="1280x800">1280 × 800</option><option value="1920x1080">1920 × 1080</option></SelectControl></label></>}</ModalBody><ModalFooter><Button variant="light" onPress={()=>setRDPStart(undefined)}>取消</Button><Button color="primary" onPress={async()=>{if(!rdpStart)return;const launch=rdpStart;setRDPStart(undefined);try{await saveRDPResolution(launch.connection.id,launch.options.resolution);await SetRDPClient(launch.connection.id, launch.options.client || 'internal');setPreferences(prev=>({...prev,[launch.connection.id]:{...prev[launch.connection.id]!,rdp_client:launch.options.client || 'internal'}}));await attempt.start(launch.connection,undefined,undefined,launch.options);}catch(e){setPreferenceError(String(e));}}}>连接</Button></ModalFooter></ModalContent></Modal>
    <HostTrustDialog target={attempt.trust} onConfirm={attempt.confirm} />
    {attempt.challenge && <SSHChallengeDialog key={attempt.challenge.id} challenge={attempt.challenge} target={attempt.target} onAnswer={attempt.answer} onCancel={attempt.cancel} />}
    {batchCommandOpen && <BatchCommandDialog targets={workspaces.filter(w => w.sessionID && w.state === '已连接').map(w => ({ id: w.sessionID!, name: w.name, address: `${w.connection?.username}@${w.connection?.host}:${w.connection?.port}` }))} initial={current?.sessionID} snippets={snippets} onClose={() => setBatchCommandOpen(false)} />}
    {restoreDialog&&<WorkspaceRestoreDialog layout={restoreDialog} connections={catalog?.connections||[]} openIDs={workspaces.map(w=>w.id)} onRestore={restoreWorkspaces} onClose={()=>setRestoreDialog(undefined)}/>}
    {palette && <CommandPalette commands={commands} initialScope={paletteScope} initialQuery={paletteQuery} onClose={() => { setPalette(false); setPaletteQuery(''); }} error={snippetError} />}
    {snippetInsert&&<SnippetInsertDialog snippet={snippetInsert.snippet} onClose={()=>setSnippetInsert(undefined)} onInsert={text=>active===snippetInsert.workspace&&!!current?.ssh?.current?.insert(text,snippetInsert.terminal)}/>}
    <Modal isOpen={!!closing || quitConfirm} onClose={() => { if (!savingClose) { setClosing(''); setQuitConfirm(false); setCloseError('');setExitPersistenceError(false); } }} isDismissable={!savingClose} isKeyboardDismissDisabled={savingClose} className="app-dialog"><ModalContent><ModalHeader>{exitPersistenceError?'本地状态保存失败':'未保存文件'}</ModalHeader><ModalBody><p>{exitPersistenceError?'最新本地状态尚未保存。':quitConfirm ? '应用中有未保存修改。' : '此工作区有未保存修改。'}</p>{closeError && <p className="error" role="alert">{closeError}</p>}</ModalBody><ModalFooter><Button variant="light" isDisabled={savingClose} onPress={() => { setClosing(''); setQuitConfirm(false); setCloseError('');setExitPersistenceError(false); }}>返回编辑</Button><Button color="danger" variant="light" isDisabled={savingClose} onPress={async () => { if(!quitConfirm){remove(closing,closingKeyboard.current);setClosing('');return;}setSavingClose(true);try{if(!exitPersistenceError)await flushLocalState();await DiscardAndQuit();}catch(e){setCloseError(String(e));setExitPersistenceError(true);}finally{setSavingClose(false);} }}>{quitConfirm?(exitPersistenceError?'忽略本地保存错误并退出':recovery.enabled?'保留本地草稿并退出':'放弃修改并退出'):'放弃修改并关闭'}</Button><Button color="primary" isLoading={savingClose} onPress={async () => {
      setSavingClose(true); setCloseError('');
      try {
        const targets = quitConfirm ? workspaces.filter(w => w.ssh?.current?.hasDirty()) : workspaces.filter(w => w.id === closing);
        for (const w of targets) { if (!await w.ssh?.current?.saveAll()) { select(w.id); setCloseError('保存未完成，请返回编辑处理文件错误。'); return; } }
        if (quitConfirm) {try{await flushLocalState();}catch(e){setExitPersistenceError(true);throw e;}await DiscardAndQuit();} else { remove(closing, closingKeyboard.current); setClosing(''); }
      } catch (e) { setCloseError(String(e)); } finally { setSavingClose(false); }
    }}>保存并{quitConfirm ? '退出' : '关闭'}</Button></ModalFooter></ModalContent></Modal>
  </>;
}
