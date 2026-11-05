import { errorMessage } from "./lib/errors";
import SelectControl from './components/SelectControl';
import { createRef, lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { AnimatePresence } from 'framer-motion';
import { Browser, Events, System } from '@wailsio/runtime';
import { Button, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@heroui/react';
import Tooltip from './components/Tooltip';
import { GetCatalog, GetConnectionPreferences, RecordConnectionSuccess, SetRDPResolution, SetRDPClient, SystemRDPAvailable, ListSnippets } from '../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { Snippet, TunnelPreset, WorkspaceLayout, WorkspaceLayoutEntry } from '../bindings/github.com/Sanjeever/termquay/internal/app/models';
import { ListServiceEntries, ListTunnels, StartTunnel } from '../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { Connection, ConnectionPreference, Group } from '../bindings/github.com/Sanjeever/termquay/internal/store/models';
import type { SSHWorkspaceHandle } from './features/files/SSHWorkspace';
import RDPView, { type RDPHandle, type RDPOptions } from './features/rdp/RDPView';
import UploadDialog from './features/files/UploadDialog';
import useTransfers from './features/files/useTransfers';
import { bytes } from './features/files/transferFormat';
import Workbench from './components/layout/Workbench';
import WorkspaceTabs from './components/layout/WorkspaceTabs';
import ConnectionCenter from './features/connections/ConnectionCenter';
import HostTrustDialog from './features/connections/HostTrustDialog';
import SSHChallengeDialog from './features/connections/SSHChallengeDialog';
import { GetPortableUI, SavePortableUI } from '../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import { applyPortableUI, capturePortableUI } from './features/settings/portable';
import useAutomaticBackup from './features/settings/useAutomaticBackup';
import useUpdates from './features/settings/useUpdates';
import { ExportDiagnostics } from '../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import { ListLocalShells, OpenLocalTerminal, CloseLocalTerminal } from '../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { LocalShell } from '../bindings/github.com/Sanjeever/termquay/internal/app/models';
import type { TerminalHandle } from './features/terminal/TerminalView';
import type { CommandAttention } from './features/terminal/commandAttention';
import useCommandRuns from './features/terminal/useCommandRuns';
import useConnectionAttempt from './features/connections/useConnectionAttempt';
import ConnectionDiagnostics from './features/connections/ConnectionDiagnostics';
import Icon from './components/Icon';
import ErrorNotice from './components/ErrorNotice';
import CommandPalette, { type WorkbenchCommand } from './components/CommandPalette';
import { defaultShortcuts, mergeShortcuts, eventShortcut, shortcutConflict, shortcutDefinitions, shortcutLabel, shortcutStorageKey, type Shortcuts } from './lib/shortcuts';
import SnippetInsertDialog from './features/terminal/SnippetInsertDialog';
import useDraftRecovery from './features/workspaces/useDraftRecovery';
import useWorkspaceRestore from './features/workspaces/useWorkspaceRestore';
import WorkspaceRestoreDialog from './features/workspaces/WorkspaceRestoreDialog';
import { nextWorkspaceAfterClose } from './lib/workspaces';
import type { CommandKind } from './lib/commands';
import { useAppearance } from './features/settings/AppearanceProvider';
import { uiZoomLevels } from './features/settings/appearance';
import { demoScenes, type DemoScene } from './features/demo/scenes';
import type { Workspace } from './features/workspaces/workspace';
import { captureWorkspaceLayout as captureLayout } from './features/workspaces/workspaceLayout';
import useWorkbenchClose from './features/workspaces/useWorkbenchClose';
import WorkbenchCloseDialog from './features/workspaces/WorkbenchCloseDialog';

const loadSSHWorkspace = () => import('./features/files/SSHWorkspace');
const loadTerminalView = () => import('./features/terminal/TerminalView');
const SSHWorkspace = lazy(loadSSHWorkspace);
const TerminalView = lazy(loadTerminalView);
const ConnectionDialog = lazy(() => import('./features/connections/ConnectionDialog'));
const BatchCommandDialog = lazy(() => import('./features/terminal/BatchCommandDialog'));
const TransferPanel = lazy(() => import('./features/files/TransferPanel'));
const SettingsView = lazy(() => import('./features/settings/SettingsView'));
const DemoWorkbench = lazy(() => import('./features/demo/DemoWorkbench'));
const WorkspaceSetsDialog = lazy(() => import('./features/workspaces/WorkspaceSetsDialog'));
const FileCompareDialog = lazy(() => import('./features/files/FileCompareDialog'));
const CommandTasksDialog = lazy(() => import('./features/terminal/CommandTasksDialog'));
const RecordingPlayer = lazy(() => import('./features/terminal/RecordingPlayer'));
const DockerDialog = lazy(() => import('./features/docker/DockerDialog'));
const StorageAccess = lazy(() => import('./features/settings/StorageAccess'));
const ServicesDialog = lazy(() => import('./features/tunnels/ServicesDialog'));

export default function App() {
  const { appearance, update: updateAppearance, beginPreview, endPreview } = useAppearance();
  const [demoScene, setDemoScene] = useState<DemoScene|null>(null);
  const [demoRevision, setDemoRevision] = useState(0);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [active, setActive] = useState('');
  const [catalog, setCatalog] = useState<{ groups: Group[]; connections: Connection[]; session_only: boolean }>();
  const [storageError, setStorageError] = useState('');
  const [connectionDiagnosticsOpen, setConnectionDiagnosticsOpen] = useState(false);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [backgroundReady, setBackgroundReady] = useState(false);
  useEffect(() => {
    if (!catalog || catalogLoading || backgroundReady) return;
    let next = 0;
    const frame = requestAnimationFrame(() => { next = requestAnimationFrame(() => setBackgroundReady(true)); });
    return () => { cancelAnimationFrame(frame); cancelAnimationFrame(next); };
  }, [catalog, catalogLoading, backgroundReady]);
  const automaticBackup = useAutomaticBackup(backgroundReady);
  const updates = useUpdates(backgroundReady);
  const [preferences, setPreferences] = useState<Record<string, ConnectionPreference | undefined>>({});
  const [preferenceError, setPreferenceError] = useState('');
  const [preferenceLoadError, setPreferenceLoadError] = useState('');
  const [portableError, setPortableError] = useState('');
  const [portableFailure, setPortableFailure] = useState(0);
  const [dismissedPortable, setDismissedPortable] = useState(0);
  const portableGeneration = useRef(0);
  const [dialog, setDialog] = useState<{ connection?: Connection; temporary: boolean; workspaceID?: string; rdpOptions?: RDPOptions }>();
  const [rdpStart, setRDPStart] = useState<{connection:Connection;options:RDPOptions}>();
  const [systemRDP, setSystemRDP] = useState(false);
  useEffect(() => { SystemRDPAvailable().then(setSystemRDP).catch(e => setPreferenceError(errorMessage(e))); return Events.On('rdp:system-error', event => setPreferenceError((event.data as {error:string}).error)); }, []);
  const [settings, setSettings] = useState(false);
  const [settingsSection,setSettingsSection]=useState('appearance');
  const [transfersOpen, setTransfersOpen] = useState(false);
  const [transferReveal, setTransferReveal] = useState('');
  const [transferHeight, setTransferHeight] = useState(Number(localStorage.getItem('termquay.layout.transfer-height')) || 220);
  const transfers = useTransfers(backgroundReady);
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
  const [fileCompareOpen, setFileCompareOpen] = useState(false);
  const [recordingOpen, setRecordingOpen] = useState(false);
  const [commandTasksOpen, setCommandTasksOpen] = useState(false);
  const [commandTasksCreated, setCommandTasksCreated] = useState(false);
  const commandRuns = useCommandRuns(backgroundReady || commandTasksOpen);
  useEffect(() => { if (commandTasksOpen) setCommandTasksCreated(true); }, [commandTasksOpen]);
  const [dockerOpen, setDockerOpen] = useState(false);
  const [servicesOpen, setServicesOpen] = useState(false);
  const [services, setServices] = useState<TunnelPreset[]>([]);
  const [serviceError, setServiceError] = useState('');
  const serviceOpening = useRef(false);
  const serviceRequest = useRef<ReturnType<typeof StartTunnel>>();
  const lastSSH = useRef<{ id: string; connectionID: string }>();
  useEffect(() => { if (!catalog || (!backgroundReady && !palette && !servicesOpen)) return; let ended = false; const request = ListServiceEntries(); request.then(values => { if (!ended) { setServices(values || []); setServiceError(''); } }).catch(e => { if (!ended) setServiceError(errorMessage(e)); }); return () => { ended = true; request.cancel(); }; }, [catalog, palette, servicesOpen, backgroundReady]);
  useEffect(() => () => { serviceRequest.current?.cancel(); }, []);
  const [localShells,setLocalShells]=useState<LocalShell[]>([]);
  const [openingLocal,setOpeningLocal]=useState(false);
  const localOpening=useRef(false);
  useEffect(()=>{ListLocalShells().then(values=>setLocalShells(values||[])).catch(e=>setPreferenceError(errorMessage(e)));},[]);
  async function openLocalShell(kind:string){if(localOpening.current||latestWorkspaces.current.length>=16)return;localOpening.current=true;setOpeningLocal(true);try{await loadTerminalView();const terminal=await OpenLocalTerminal(kind,100,30);if(latestWorkspaces.current.length>=16){await CloseLocalTerminal(terminal.id);throw new Error('打开工作区达到上限（16 个）');}setWorkspaces(previous=>[...previous,{id:terminal.id,sessionID:terminal.id,connectionID:'',name:terminal.name,local:{shell:terminal.name,terminal:createRef<TerminalHandle>()}}]);select(terminal.id);}catch(e){setPreferenceError(errorMessage(e));}finally{localOpening.current=false;setOpeningLocal(false);}}
  const [shortcuts, setShortcuts] = useState<Shortcuts>({ ...defaultShortcuts });
  const [shortcutError, setShortcutError] = useState('');
  const current = workspaces.find(w => w.id === active);
  const connectionSessions = useMemo(() => {
    const sessions = new Map<string, string[]>();
    for (const workspace of workspaces) {
      const states = sessions.get(workspace.connectionID) || [];
      states.push(workspace.state || '连接中');
      sessions.set(workspace.connectionID, states);
    }
    return Object.fromEntries(sessions);
  }, [workspaces]);
  const rdpGateways=workspaces.filter(workspace=>workspace.ssh&&workspace.sessionID&&workspace.state==='已连接').map(workspace=>({id:workspace.sessionID!,name:workspace.name}));
  const latestWorkspaces = useRef(workspaces); latestWorkspaces.current = workspaces;
  const tabNavigation = useRef(false);
  const recovery=useDraftRecovery(!!catalog);
  const workspaceRestore=useWorkspaceRestore(!!catalog);
  const [restoreDialog,setRestoreDialog]=useState<WorkspaceLayout>();
  const [workspaceSetLayout, setWorkspaceSetLayout] = useState<WorkspaceLayout>();
  const restorePrompted=useRef(false);
  function notifyRecovery(items=latestWorkspaces.current){if(!recovery.enabled)return;recovery.queue(items.flatMap(w=>{const documents=w.ssh?.current?.recoveryDrafts();return documents?[{workspace:w.id,name:w.name,documents}]:[];}));}
  function captureWorkspaceLayout(items=latestWorkspaces.current) { return captureLayout(items, active); }
  function notifyLocalState(items=latestWorkspaces.current){notifyRecovery(items);const layout=captureWorkspaceLayout(items);if(layout)workspaceRestore.queue(layout);}
  function manageWorkspaceSets() {
    const layout = captureWorkspaceLayout();
    if (!layout) { setPreferenceError('工作区布局尚未就绪，请稍后重试'); return; }
    setWorkspaceSetLayout(layout);
  }
  async function flushLocalState(){if(!catalog)return;notifyLocalState();await workspaceRestore.flush();await recovery.flush();++portableGeneration.current;await SavePortableUI(capturePortableUI());setPortableError('');}
  const workbenchClose = useWorkbenchClose({
    workspaces,
    activeTasks: commandRuns.active,
    flushLocalState,
    beforeQuit: () => { if (demoScene) exitDemo(); },
    remove,
    select,
    onError: setPreferenceError,
  });
  const { closing, quitConfirm, restarting } = workbenchClose;
  useEffect(()=>{notifyLocalState();},[workspaces,active,recovery.enabled,workspaceRestore.startup]);
  useEffect(()=>{if(demoScene||workspaceSetLayout||restorePrompted.current||!catalog||!workspaceRestore.startup)return;restorePrompted.current=true;if(workspaceRestore.startup.entries?.length&&!workspaces.length&&!dialog&&!settings)setRestoreDialog(workspaceRestore.startup);},[catalog,workspaceRestore.startup,demoScene,workspaceSetLayout]);

  function remove(id: string, keyboard = false) {
    attempt.cancelWorkspace(id);
    latestWorkspaces.current.find(w => w.id === id)?.view?.current?.cancel();
    notifyLocalState(latestWorkspaces.current.filter(w=>w.id!==id));
    setWorkspaces(prev => prev.filter(w => w.id !== id));
    setActive(prev => nextWorkspaceAfterClose(latestWorkspaces.current, prev, id, recentWorkspaces.current));
    if (keyboard) { tabNavigation.current = true; requestAnimationFrame(() => document.querySelector<HTMLElement>('.workspace-tabs [role=tab][aria-selected=true]')?.focus()); }
  }
  function select(id: string, keyboard = false) { tabNavigation.current = keyboard; setActive(id); setSettings(false); }
  function closeWorkspace(id = active, keyboard = true) { if (id) workbenchClose.requestClose(id, keyboard); }
  function closeCurrentTab() { if (settings) { setSettings(false); return; } if (current?.ssh?.current?.workspaceAction('closeContent')) return; closeWorkspace(); }
  function newTerminal() { if (current?.ssh && !settings) { current.ssh.current?.workspaceAction('newTerminal'); return; } const shell = localShells.find(shell=>shell.name===current?.local?.shell) || localShells[0]; if(shell)void openLocalShell(shell.id); }
  function moveWorkspace(id: string, target: string) {
    setWorkspaces(prev => { const from = prev.findIndex(w => w.id === id); const to = prev.findIndex(w => w.id === target); if (from < 0 || to < 0 || from === to) return prev; const next = [...prev]; next.splice(to, 0, next.splice(from, 1)[0]); return next; });
  }
  function workspaceState(id: string, state: string) { setWorkspaces(prev => prev.map(w => w.id === id && w.state !== state ? { ...w, state } : w)); }
  function workspaceAttention(id: string, attention?: CommandAttention) { setWorkspaces(prev => prev.some(w => w.id === id && w.attention !== attention) ? prev.map(w => w.id === id ? { ...w, attention } : w) : prev); }
  async function recordSuccess(id: string) { if (!id) return; try { await RecordConnectionSuccess(id); setPreferences(await GetConnectionPreferences() || {}); } catch (e) { setPreferenceError(`记录最近连接失败：${errorMessage(e)}`); } }
  async function saveRDPResolution(id: string, value: string) { if (!id) return; await SetRDPResolution(id,value); setPreferences(await GetConnectionPreferences() || {}); }
  const attempt = useConnectionAttempt((id, connection, reuse, automatic, route) => {
    if(reuse&&!latestWorkspaces.current.some(w=>w.id===reuse))throw new Error('工作区已关闭');
    if(!reuse&&latestWorkspaces.current.length>=16)throw new Error('打开工作区达到上限（16 个）');
    lastSSH.current = { id, connectionID: connection.id };
    setWorkspaces(prev => reuse?prev.map(w=>w.id===reuse?{...w,sessionID:id,connection,route,connectionID:connection.id,restored:false}:w):[...prev, { id, sessionID:id, connection,route, connectionID: connection.id, name: connection.name, ssh: createRef<SSHWorkspaceHandle>() }]); if (!automatic) select(reuse||id);
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
  }, (id, error) => setWorkspaces(prev => prev.map(w => w.id === id ? { ...w, rdp: { ...w.rdp!, error } } : w)), id => latestWorkspaces.current.find(w => w.id === id)?.view?.current?.cancel(), remove, loadSSHWorkspace);

  async function reload() { setCatalogLoading(true); try { const data = await GetCatalog(); try { setPreferences(await GetConnectionPreferences() || {}); setPreferenceLoadError(''); } catch (e) { setPreferenceLoadError(errorMessage(e)); } setCatalog({ ...data, groups: data.groups ?? [], connections: data.connections ?? [] }); setStorageError(''); } catch (e) { setStorageError(errorMessage(e)); } finally { setCatalogLoading(false); } }
  function showDemo(scene: DemoScene = 'connections') { if(attempt.busy||openingLocal||dialog||rdpStart||restoreDialog||snippetInsert||attempt.trust||closing||quitConfirm||restarting||document.querySelector('[role=dialog][aria-modal=true]:not(.command-palette)'))return;if(!demoScene)beginPreview();setPalette(false);selectDemoScene(scene); }
  function selectDemoScene(scene: DemoScene) { setDemoScene(scene);setDemoRevision(value=>value+1); }
  function exitDemo() { setDemoScene(null);endPreview(); }
  useEffect(() => { void reload(); }, []);
  useEffect(()=>{if(!palette&&!batchCommandOpen){setSnippets([]);return;}let ended=false;const request=ListSnippets();request.then(values=>{if(!ended){setSnippets(values||[]);setSnippetError('');}}).catch(e=>{if(!ended)setSnippetError(errorMessage(e));});return()=>{ended=true;request.cancel();};},[palette,active,batchCommandOpen]);
  useEffect(() => {
    try {
      const stored = localStorage.getItem(shortcutStorageKey); if (!stored) return;
      const values = mergeShortcuts(JSON.parse(stored));
      for (const d of shortcutDefinitions) { if (typeof values[d.id] !== 'string' || shortcutConflict(d.id, values[d.id], values)) throw new Error('快捷键配置无效，请在设置中复位'); }
      setShortcuts(values);
    } catch (e) { setShortcutError(errorMessage(e)); }
  }, []);
  function saveShortcuts(values: Shortcuts) { try { localStorage.setItem(shortcutStorageKey, JSON.stringify(values)); setShortcuts(values); setShortcutError(''); window.dispatchEvent(new Event('termquay:portable-changed')); } catch (e) { setShortcutError(errorMessage(e)); } }
  async function savePortable() {
    const request = ++portableGeneration.current;
    try { await SavePortableUI(capturePortableUI()); if (request === portableGeneration.current) setPortableError(''); }
    catch (error) { if (request === portableGeneration.current) {setPortableError(errorMessage(error));setPortableFailure(value=>value+1);} }
  }
  useEffect(() => {
    if (!catalog) return;
    let ended = false; let changed=false; let timer: ReturnType<typeof setTimeout>;
    const restored = () => { try { setShortcuts(mergeShortcuts(JSON.parse(localStorage.getItem(shortcutStorageKey) || '{}'))); } catch (e) { setShortcutError(errorMessage(e)); } };
    const save = () => { changed=true;clearTimeout(timer); timer = setTimeout(() => {if(!ended)void savePortable();}, 300); };
    window.addEventListener('termquay:portable-restored', restored); window.addEventListener('termquay:portable-changed', save);
    GetPortableUI().then(async values => { if (ended||changed) return; if (Object.keys(values || {}).length) applyPortableUI(values); else await savePortable(); }).catch(e => { if (!ended) setPreferenceError(`读取界面设置失败：${errorMessage(e)}`); });
    return () => { ended = true; ++portableGeneration.current; clearTimeout(timer); window.removeEventListener('termquay:portable-restored', restored); window.removeEventListener('termquay:portable-changed', save); };
  }, [catalog?.session_only]);
  useEffect(() => { localStorage.setItem('termquay.layout.transfer-height', String(transferHeight)); }, [transferHeight]);
  useEffect(() => { localStorage.setItem('termquay.terminal.font-size', String(fontSize)); }, [fontSize]);
  useEffect(() => {
    if (demoScene || dialog || rdpStart || restoreDialog || workspaceSetLayout || snippetInsert || attempt.trust || closing || quitConfirm || palette || settings) return;
    if (tabNavigation.current) { tabNavigation.current = false; return; }
    const frame = requestAnimationFrame(() => { if (current?.rdp) current.view?.current?.focus(); else current?.ssh?.current?.focus(); });
    return () => cancelAnimationFrame(frame);
  }, [active, dialog, rdpStart, restoreDialog, workspaceSetLayout, snippetInsert, attempt.trust, closing, quitConfirm, palette, settings,demoScene]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (demoScene || event.isComposing || event.repeat || dialog || attempt.trust || closing || quitConfirm || restarting) return;
      const path = event.composedPath();
      if (path.some(target => target instanceof HTMLElement && target.matches('[role=dialog], .shortcut-recorder'))) return;
      if (path.some(target => target instanceof HTMLElement && target.matches('.rdp-canvas')) && path.some(target => target instanceof HTMLElement && target.matches('.rdp-view[data-keyboard-target=remote]'))) return;
      const key = eventShortcut(event); if (!key) return;
      const terminal = !settings && !!(current?.ssh||current?.local) && path.some(target => target instanceof HTMLElement && target.matches('.xterm'));
      const action = shortcutDefinitions.find(d => shortcuts[d.id] === key && (d.scope === 'app' || (d.scope === 'workspace' && !settings && current?.ssh) || (terminal&&d.scope==='terminal')));
      if (!action) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (action.id === 'palette') { setPaletteScope('all'); setPaletteQuery(''); setPalette(prev => !prev); }
      else if (action.id === 'settings') setSettings(true);
      else if (action.id === 'newConnection') openDialog(false);
      else if (action.id === 'newTerminal') newTerminal();
      else if (action.id === 'closeTab') closeCurrentTab();
      else if (action.id === 'closeWorkspace') closeWorkspace();
      else if (action.id === 'nextWorkspace' || action.id === 'previousWorkspace') { const ids = ['', ...workspaces.map(w=>w.id)]; select(ids[(ids.indexOf(active) + (action.id === 'nextWorkspace' ? 1 : -1) + ids.length) % ids.length]); }
      else if (action.scope === 'workspace') current?.ssh?.current?.workspaceAction(action.id);
      else if(action.scope==='terminal'){if(current?.local)current.local.terminal.current?.action(action.id);else current?.ssh?.current?.terminalAction(action.id);}
    };
    window.addEventListener('keydown', key, true); return () => window.removeEventListener('keydown', key, true);
  }, [dialog, attempt.trust, closing, quitConfirm, restarting, shortcuts, settings, current, workspaces, active,demoScene]);
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
  function sameTarget(a:Connection,b:Connection){return a.protocol===b.protocol&&a.host===b.host&&a.port===b.port&&a.username===b.username&&(a.domain||'')===(b.domain||'')&&(a.jump_id||'')===(b.jump_id||'')&&(a.proxy_address||'')===(b.proxy_address||'');}
  function reconnectSSH(w:Workspace){const saved=catalog?.connections.find(c=>c.id===w.connectionID);if(saved&&saved.protocol!=='ssh'){setPreferenceError('保存配置的协议已改变，请新建工作区');return;}if(saved&&w.restored&&w.connection&&!sameTarget(saved,w.connection)){setPreferenceError('保存配置目标已改变，请重新填写恢复入口后确认连接');return;}if(saved)void connect(saved,undefined,w.id);else if(w.connection)setDialog({connection:{...w.connection,id:'',credential_id:''},temporary:true,workspaceID:w.id});}
  function canAutomaticallyReconnectSSH(w: Workspace) {
    const saved = catalog?.connections.find(c => c.id === w.connectionID);
    if (!saved || !w.connection || !sameTarget(saved, w.connection) || !w.route?.length) return false;
    let hop: Connection | undefined = saved;
    for (let depth = 0; hop && depth < 5; depth++) {
      const original = w.route[w.route.length - 1 - depth];
      if (!original || hop.protocol !== 'ssh' || hop.host !== original.host || hop.port !== original.port || hop.username !== original.username || (hop.jump_id || '') !== original.jump_id || (hop.proxy_address || '') !== original.proxy_address || (hop.auth_method || '') !== original.auth_method || (hop.identity_agent || '') !== original.identity_agent || !!hop.mfa !== original.mfa || (hop.certificate || '') !== original.certificate) return false;
      if (hop.mfa || hop.auth_method === 'keyboard_interactive') return false;
      if (!hop.jump_id) return depth + 1 === w.route.length;
      const jumpID = hop.jump_id;
      hop = catalog?.connections.find(c => c.id === jumpID);
    }
    return false;
  }
  async function automaticReconnectSSH(w: Workspace) {
    if (!canAutomaticallyReconnectSSH(w)) return { ok: false, retryable: false };
    const saved = catalog!.connections.find(c => c.id === w.connectionID)!;
    if (!await w.ssh?.current?.prepareReconnect()) return { ok: false, retryable: false };
    const ok = await attempt.start(saved, undefined, w.id, undefined, true, w.route);
    return { ok, retryable: attempt.canRetry() };
  }
  async function openService(entry: TunnelPreset) {
    if (serviceOpening.current || attempt.busy) throw new Error('请等待当前连接或服务启动完成');
    const connection = catalog?.connections.find(c => c.id === entry.connection_id && c.protocol === 'ssh');
    if (!connection) throw new Error('服务所属 SSH 连接已删除');
    serviceOpening.current = true;
    try {
      const workspace = latestWorkspaces.current.find(w => w.connectionID === entry.connection_id && w.ssh && w.sessionID && w.state === '已连接' && w.connection && sameTarget(w.connection, connection));
      let session = workspace?.sessionID;
      if (!session) {
        setServicesOpen(false);
        const previous = latestWorkspaces.current.find(w => w.connectionID === entry.connection_id && w.ssh);
        if (!await connect(connection, undefined, previous?.id) || lastSSH.current?.connectionID !== connection.id) throw new Error('服务主机连接未完成');
        session = lastSSH.current.id;
      }
      const tunnels = await ListTunnels(session) || [];
      let tunnel = tunnels.find(t => t.info.state === 'running' && t.spec.kind === 'local' && t.spec.bind_host === entry.spec.bind_host && t.spec.bind_port === entry.spec.bind_port && t.spec.target_host === entry.spec.target_host && t.spec.target_port === entry.spec.target_port && !t.spec.allow_public);
      if (!tunnel) { const request = StartTunnel(session, entry.spec); serviceRequest.current = request; tunnel = await request; }
      if (entry.service_type === 'address') await navigator.clipboard.writeText(tunnel.info.address);
      else { const url = new URL(`${entry.service_type}://${tunnel.info.address}`); const path = new URL(entry.url_path || '/', url); if (path.origin !== url.origin) throw new Error('服务 URL 路径改变了访问目标'); await Browser.OpenURL(path.toString()); }
      setServiceError('');
    } catch (e) { setPreferenceError(errorMessage(e)); throw e; }
    finally { serviceRequest.current = undefined; serviceOpening.current = false; }
  }
  async function restoreWorkspaces(entries:WorkspaceLayoutEntry[], preferredActive=restoreDialog?.active){await recovery.flush();const currentIDs=new Set(latestWorkspaces.current.map(w=>w.id));const values=entries.filter(e=>!currentIDs.has(e.id));if(values.length+currentIDs.size>16)throw new Error('打开工作区达到上限（16 个）');const restored:Workspace[]=values.map(e=>{const c:Connection={...e.target,id:e.connection_id,group_id:'',credential_id:''};return {id:e.id,connectionID:e.connection_id,connection:c,name:e.name,state:'未连接',restored:true,...(c.protocol==='ssh'?{ssh:createRef<SSHWorkspaceHandle>(),restore:e.ssh||undefined}:{rdp:{connection:c,options:{clipboard:false,resolution:preferences[c.id]?.rdp_resolution||'dynamic'}},view:createRef<RDPHandle>()})};});setWorkspaces(prev=>[...prev,...restored]);if(restored.length)select(restored.some(w=>w.id===preferredActive)?preferredActive!:restored[0].id);}
  async function openWorkspaceSet(layout: WorkspaceLayout) {
    if (attempt.busy || localOpening.current) throw new Error('请等待当前连接或本地终端创建完成');
    const entries = layout.entries || [];
    const ids = new Map(entries.map(entry => [entry.id, crypto.randomUUID()]));
    await restoreWorkspaces(entries.map(entry => ({ ...entry, id: ids.get(entry.id)! })), ids.get(layout.active));
  }
  const tools = <>
    <Tooltip content="命名工作集"><button className="icon-button" aria-label="命名工作集" disabled={attempt.busy || openingLocal || !catalog} onClick={manageWorkspaceSets}><Icon name="list" /></button></Tooltip>
    <Tooltip content={`命令搜索 · ${shortcutLabel(shortcuts.palette)}`}><button className="icon-button" aria-label="命令搜索" onClick={() => { setPaletteScope('all'); setPaletteQuery(''); setPalette(true); }}><Icon name="search" /></button></Tooltip>
    <Tooltip content={updates.status?.version ? '设置 · 有可用更新' : '设置'}><button className="icon-button relative" aria-label={updates.status?.version ? '设置，有可用更新' : '设置'} aria-pressed={settings} onClick={() => { if(updates.status?.version)setSettingsSection('about');setSettings(!settings); }}><Icon name="settings" />{updates.status?.version && <span className="update-indicator" aria-hidden="true" />}</button></Tooltip>
  </>;
  const commands: WorkbenchCommand[] = [
    ...workspaces.map(w => { const c = w.rdp?.connection || w.connection; return { id: `workspace-${w.id}`, label: w.name, detail: w.local ? '本地终端' : c ? `${c.protocol.toUpperCase()} · ${c.username}@${c.host}:${c.port}` : undefined, search: catalog?.groups.find(g=>g.id===c?.group_id)?.name, kind: 'workspace' as const, run: () => select(w.id) }; }),
    ...(palette ? (catalog?.connections || []).map(c => ({ id: `connection-${c.id}`, label: c.name, detail: `${c.protocol.toUpperCase()} · ${c.username}@${c.host}:${c.port}`, search: catalog?.groups.find(g=>g.id===c.group_id)?.name, kind: 'connection' as const, run: () => openSaved(c) })) : []),
    { id: 'new', label: '新建连接', shortcut: shortcutLabel(shortcuts.newConnection), kind: 'command', run: () => openDialog(false) },
    { id: 'quick', label: '快速连接', kind: 'command', run: () => openDialog(true) },
    ...demoScenes.map(scene=>({id:`demo-${scene.id}`,label:scene.label,search:'demo 演示模式',kind:'command' as const,run:()=>showDemo(scene.id)})),
    ...localShells.map(shell=>({id:`local-${shell.id}`,label:`本地终端 · ${shell.name}`,kind:'command' as const,run:()=>{void openLocalShell(shell.id);}})),
    { id: 'connections', label: '进入连接中心', kind: 'command', run: () => select('') },
    { id: 'workspace-sets', label: '管理命名工作集', kind: 'command', run: manageWorkspaceSets },
    ...(current?.ssh ? [{ id: 'files', label: '显示远端文件', kind: 'command' as const, run: () => current.ssh?.current?.showFiles() }, { id: 'monitor', label: '切换监控面板', kind: 'command' as const, run: () => current.ssh?.current?.toggleMonitor() }, { id: 'focus', label: '切换专注模式', kind: 'command' as const, run: () => current.ssh?.current?.toggleFocus() }] : []),
    ...(current?.ssh||current?.local ? shortcutDefinitions.filter(d => d.scope === 'terminal').map(d => ({ id: `terminal-${d.id}`, label: d.label, detail: shortcutLabel(shortcuts[d.id]), kind: 'command' as const, run: () => {if(current.local)current.local.terminal.current?.action(d.id);else current.ssh?.current?.terminalAction(d.id);} })) : []),
    ...(current?.ssh ? shortcutDefinitions.filter(d=>d.scope==='workspace').map(d=>({id:d.id,label:d.label,detail:shortcutLabel(shortcuts[d.id]),kind:'command' as const,run:()=>current.ssh?.current?.workspaceAction(d.id)})) : []),
    { id: 'transfers', label: '查看传输任务', kind: 'command', run: () => setTransfersOpen(true) },
    { id: 'batch-command', label: '多主机执行命令', kind: 'command', run: () => setBatchCommandOpen(true) },
    { id: 'command-tasks', label: '管理与执行多主机任务', kind: 'command', run: () => setCommandTasksOpen(true) },
    { id: 'inspections', label: '多主机巡检与基线比较', kind: 'command', run: () => setCommandTasksOpen(true) },
    { id: 'services', label: '管理远端服务', kind: 'command', run: () => setServicesOpen(true) },
    ...services.map(entry => ({ id: `service-${entry.connection_id}-${entry.name}`, label: `打开服务 ${entry.name}`, detail: catalog?.connections.find(c => c.id === entry.connection_id)?.name, search: '远端服务 隧道', kind: 'command' as const, run: () => { void openService(entry).catch(e => setPreferenceError(errorMessage(e))); } })),
    { id: 'docker', label: 'Docker 容器工作区', kind: 'command', run: () => setDockerOpen(true) },
    { id: 'file-compare', label: '文件管理、对比与跨工作区复制', kind: 'command', run: () => setFileCompareOpen(true) },
    { id: 'recording-playback', label: '打开本机终端录制回放', kind: 'command', run: () => setRecordingOpen(true) },
    ...(current?.ssh ? [{ id: 'sudo-edit', label: '以 sudo 编辑文件', kind: 'command' as const, run: () => current.ssh?.current?.sudoEdit() }] : []),
    { id: 'diagnostics', label: '导出脱敏诊断信息', kind: 'command', run: () => { ExportDiagnostics().catch(e => setPreferenceError(errorMessage(e))); } },
    ...(attempt.steps.length ? [{ id: 'connection-diagnostics', label: '查看上次 SSH 连接诊断', kind: 'command' as const, run: () => setConnectionDiagnosticsOpen(true) }] : []),
    { id: 'settings', label: '打开设置', shortcut: shortcutLabel(shortcuts.settings), kind: 'command', run: () => setSettings(true) },
    { id: 'about', label: '关于 TermQuay', kind: 'command', run: () => { setSettingsSection('about'); setSettings(true); } },
    { id: 'palette', label: '命令搜索', shortcut: shortcutLabel(shortcuts.palette), kind: 'command', run: () => { setPaletteScope('all'); setPaletteQuery(''); setPalette(true); } },
    ...(current?.ssh || localShells.length ? [{ id: 'newTerminal', label: '新建终端', shortcut: shortcutLabel(shortcuts.newTerminal), kind: 'command' as const, run: newTerminal }] : []),
    ...(current || settings ? [{ id: 'closeTab', label: '关闭当前标签', shortcut: shortcutLabel(shortcuts.closeTab), kind: 'command' as const, run: closeCurrentTab }] : []),
    ...(current ? [{ id: 'closeWorkspace', label: '关闭工作区', shortcut: shortcutLabel(shortcuts.closeWorkspace), kind: 'command' as const, run: () => closeWorkspace() }] : []),
    ...(['nextWorkspace','previousWorkspace'] as const).filter(()=>workspaces.length>0).map(id=>({id,label:id==='nextWorkspace'?'下一个工作区':'上一个工作区',shortcut:shortcutLabel(shortcuts[id]),kind:'command' as const,run:()=>{const ids=['',...workspaces.map(workspace=>workspace.id)];select(ids[(ids.indexOf(active)+(id==='nextWorkspace'?1:-1)+ids.length)%ids.length]);}})),
    ...(['uiZoomIn','uiZoomOut','uiZoomReset'] as const).filter(id=>id==='uiZoomIn'?appearance.uiZoom<uiZoomLevels[uiZoomLevels.length-1]:id==='uiZoomOut'?appearance.uiZoom>1:appearance.uiZoom!==1).map(id=>({id,label:id==='uiZoomIn'?'放大界面':id==='uiZoomOut'?'缩小界面':'界面实际大小',kind:'command' as const,run:()=>updateAppearance({...appearance,uiZoom:id==='uiZoomReset'?1:uiZoomLevels[uiZoomLevels.indexOf(appearance.uiZoom)+(id==='uiZoomIn'?1:-1)]})})),
    ...(workspaceRestore.startup?.entries?.length?[{id:'restore-layout',label:'恢复上次工作布局',kind:'command' as const,run:()=>setRestoreDialog(workspaceRestore.startup)}]:[]),
    ...(current?.ssh?.current?.insertionTarget()||current?.local?snippets.map(snippet=>({id:`snippet-${snippet.id}`,label:`插入片段 ${snippet.name}`,detail:snippet.group,kind:'command' as const,run:()=>{const target=current?.local?current.id:current?.ssh?.current?.insertionTarget();if(target&&current)setSnippetInsert({snippet,workspace:current.id,terminal:target});}})):[]),
  ];
  const menuCommand = useRef<(id:string)=>void>(()=>{});
  menuCommand.current = id => { if (demoScene || dialog || rdpStart || restoreDialog || snippetInsert || attempt.trust || closing || quitConfirm || restarting || document.querySelector('[role=dialog]')) return; commands.find(command=>command.id===id)?.run(); };
  useEffect(()=>Events.On('app:menu-command',event=>menuCommand.current(event.data as string)),[]);
  const menuState = JSON.stringify(dialog || rdpStart || restoreDialog || workspaceSetLayout || snippetInsert || attempt.trust || closing || quitConfirm || restarting || palette || batchCommandOpen ? {} : Object.fromEntries(commands.map(command=>[command.id,command.shortcut==='未分配'?'':command.shortcut||''])));
  useEffect(()=>{if(!demoScene&&System.IsMac())void Events.Emit('app:menu-state',JSON.parse(menuState) as Record<string,string>).catch(error=>setPreferenceError(`菜单更新失败：${errorMessage(error)}`));},[menuState,demoScene]);
  return <>
    <div className="live-workbench" hidden={demoScene!==null}>
    <Workbench tabs={<WorkspaceTabs items={workspaces} active={active} onSelect={select} onClose={closeWorkspace} onSearch={() => { setPaletteScope('workspace'); setPalette(true); }} onNew={() => openDialog(false)} onMove={moveWorkspace} onRename={(id, name) => setWorkspaces(prev => prev.map(w => w.id === id ? { ...w, name } : w))} />} tools={tools} settings={settings}
      status={<><span>{catalog?.session_only ? '会话存储' : '本地工作台'}</span><span>{workspaces.length} 个工作区</span><div className="status-spacer" />{recovery.error&&<button className="error" onClick={()=>{setSettingsSection('recovery');setSettings(true);}}>本地草稿保存失败</button>}{portableError&&<button className="error" onClick={()=>setDismissedPortable(0)}>界面设置未保存</button>}{(automaticBackup.error||automaticBackup.status?.error)&&<button className="error" onClick={()=>{setSettingsSection('backup');setSettings(true);}}>备份失败</button>}
        <button className={commandRuns.error ? 'error' : ''} aria-expanded={commandTasksOpen} onClick={() => setCommandTasksOpen(true)}><Icon name="list" width="14" />{commandRuns.waiting ? `任务 · ${commandRuns.waiting} 等待确认` : commandRuns.active ? `任务 · ${commandRuns.active} 进行中` : '任务'}{commandRuns.error ? ' · 读取失败' : ''}</button>
        <Tooltip content={transfers.summary}><button className={transfers.failed || transfers.error ? 'error' : ''} aria-expanded={transfersOpen} onClick={() => setTransfersOpen(!transfersOpen)}><Icon name="transfer" width="14" />{transfers.running ? `传输 ${transfers.running} 进行中` : transfers.waiting ? '传输' : transfers.items.length ? '传输结束' : '传输'}{transfers.running > 0 && <span aria-hidden="true"> · {bytes(transfers.speed)}/s</span>}{transfers.waiting ? ` · ${transfers.waiting} 等待` : !transfers.running && transfers.items.length ? ` · ${transfers.summary}` : ''}{transfers.running > 0 && transfers.failed ? ` · ${transfers.failed} 失败` : ''}{transfers.error ? ' · 加载失败' : ''}</button></Tooltip></>}>
      {storageError && !catalog && <Suspense fallback={<div role="status">正在读取存储保护…</div>}><StorageAccess error={storageError} onOpened={async () => { await reload(); await recovery.refresh(); }} /></Suspense>}
      {storageError && catalog && <ErrorNotice message={storageError} />}
      {!dialog && (attempt.busy || (attempt.error && !current?.rdp)) && <div className="connection-feedback" role={attempt.error ? 'alert' : 'status'}><span className={attempt.error ? 'error' : ''}>{attempt.target} · {attempt.error || attempt.steps[attempt.steps.length - 1]?.stage || '正在连接…'}</span><div className="button-row">{!!attempt.steps.length && <Button size="sm" variant="light" onPress={() => setConnectionDiagnosticsOpen(true)}>连接诊断</Button>}{attempt.busy && <Button size="sm" variant="light" onPress={attempt.cancel}>取消连接</Button>}{!attempt.busy && <button className="icon-button" aria-label="关闭连接错误" onClick={attempt.clearError}><Icon name="close" /></button>}</div></div>}
      {settings && <Suspense fallback={<div className="view-loading" role="status">正在载入设置…</div>}><SettingsView section={settingsSection} onSectionChange={setSettingsSection} recovery={recovery} fontSize={fontSize} onFontSize={setFontSize} onRestore={() => void reload()} onClose={() => setSettings(false)} shortcuts={shortcuts} onShortcuts={saveShortcuts} shortcutError={shortcutError} automaticBackup={automaticBackup} updates={updates} onRestart={workbenchClose.restart} activeWorkspaces={workspaces.length} activeTransfers={transfers.items.filter(item => ['queued','running'].includes(item.state)).length} onDemo={()=>showDemo()} demoDisabled={attempt.busy||openingLocal} connections={catalog?.connections || []} onEditConnection={id => { const connection = catalog?.connections.find(item => item.id === id); if (connection) openDialog(false, connection); }} /></Suspense>}
      <ErrorNotice message={preferenceError} onDismiss={()=>setPreferenceError('')} className="connection-feedback"/>
      <ErrorNotice message={preferenceLoadError} className="connection-feedback"><button className="session-tool" onClick={()=>void reload()}>重新读取连接偏好</button></ErrorNotice>
      {portableError && portableFailure!==dismissedPortable && <ErrorNotice message={`界面设置未保存：${portableError}`} onDismiss={()=>setDismissedPortable(portableFailure)} className="connection-feedback"><button className="session-tool" onClick={()=>void savePortable()}>重试保存</button></ErrorNotice>}
      {automaticBackup.bannerVisible && !settings && <ErrorNotice message="备份失败" onDismiss={automaticBackup.dismiss} className="connection-feedback"><button className="session-tool" onClick={() => { setSettingsSection('backup'); setSettings(true); }}>查看详情</button></ErrorNotice>}
      <div className="connection-center-page" hidden={settings || !!current}><ConnectionCenter connections={catalog?.connections || []} groups={catalog?.groups || []} preferences={preferences} sessions={connectionSessions} onOpen={openSaved} onEdit={c => openDialog(false, c)} onNew={openDialog} onReload={() => void reload()} busy={attempt.busy||openingLocal} loading={catalogLoading} loadError={storageError} systemRDP={systemRDP} shells={localShells} onLocal={kind=>{void openLocalShell(kind);}} active={!demoScene && !settings && !current} /></div>
      {workspaces.map(w => <div className="workspace" hidden={settings || active !== w.id} key={w.id}><Suspense fallback={<div className="view-loading" role="status">正在载入工作区…</div>}>{w.rdp ? <RDPView target={`${w.rdp.connection.username}@${w.rdp.connection.host}:${w.rdp.connection.port}`} environment={preferences[w.connectionID]?.environment || ''} grant={w.rdp.grant} failure={w.rdp.error} busy={attempt.busy} pending={attempt.busy&&attempt.workspaceID===w.id} options={w.rdp.options} onResolution={value=>saveRDPResolution(w.connectionID,value)} onRetry={() => retryRDP(w)} onEdit={() => editRDP(w)} ref={w.view} visible={!demoScene && !settings && active === w.id} onState={state => workspaceState(w.id, state)} /> : w.local && w.sessionID ? <div className="local-workspace"><TerminalView local id={w.sessionID} workspace={w.sessionID} ref={w.local.terminal} visible={!demoScene&&!settings&&active===w.id} fontSize={fontSize} onAttention={value => workspaceAttention(w.id, value)} onActivate={() => select(w.id)} onSnippets={()=>{setPaletteScope('command');setPaletteQuery('插入片段 ');setPalette(true);}} onConnectionChange={()=>workspaceState(w.id,w.local?.terminal.current?.ended()?'已退出':'运行中')}/></div> : w.sessionID ?
        <SSHWorkspace onSnippets={()=>{setPaletteScope('command');setPaletteQuery('插入片段 ');setPalette(true);}} id={w.id} sessionID={w.sessionID} initialLayout={w.restore} connectionID={w.connectionID} target={`${w.connection?.username}@${w.connection?.host}:${w.connection?.port}`} environment={preferences[w.connectionID]?.environment || ''} state={w.state || '连接中'} shortcuts={shortcuts} ref={w.ssh} fontSize={fontSize} busy={attempt.busy} onAttention={value => workspaceAttention(w.id, value)} onActivate={() => select(w.id)} onStateChange={()=>notifyLocalState()} onReconnect={()=>reconnectSSH(w)} onAutomaticReconnect={() => automaticReconnectSSH(w)} automaticReconnect={canAutomaticallyReconnectSSH(w)} onCancelReconnect={() => attempt.cancelWorkspace(w.id)} visible={!demoScene && !settings && active === w.id} onDirtyChange={dirty => setWorkspaces(prev => prev.map(item => item.id === w.id ? { ...item, dirty } : item))} onState={state => workspaceState(w.id, state)} /> :
        <div className="restored-workspace"><h2>尚未连接</h2><p>{w.connection?.username}@{w.connection?.host}:{w.connection?.port}</p><div className="button-row"><Button size="sm" color="primary" isDisabled={attempt.busy} onPress={()=>reconnectSSH(w)}>连接</Button><Button size="sm" variant="light" isDisabled={attempt.busy} onPress={()=>{if(w.connection)setDialog({connection:{...w.connection,id:'',credential_id:''},temporary:true,workspaceID:w.id});}}>重新填写连接</Button></div><ul>{(w.restore?.tabs||[]).filter(t=>t.kind==='file').map(t=><li className="file-path" key={t.path}>{t.path}</li>)}</ul></div>}
      </Suspense></div>)}
      <Suspense fallback={<div role="status">正在载入传输任务…</div>}><AnimatePresence initial={false}>{transfersOpen && <TransferPanel tasks={transfers} reveal={transferReveal} height={transferHeight} onHeight={setTransferHeight} onClose={() => setTransfersOpen(false)} onLocate={(workspace, directory) => { const target = workspaces.find(item => item.sessionID === workspace); if (target) { select(target.id); target.ssh?.current?.locateDirectory(directory); } }} workspaces={workspaces.filter(workspace=>workspace.sessionID&&workspace.state==='已连接').map(workspace=>({id:workspace.sessionID!,name:workspace.name,target:`${workspace.connection?.username}@${workspace.connection?.host?.includes(':')?'['+workspace.connection.host+']':workspace.connection?.host}:${workspace.connection?.port}`}))} />}</AnimatePresence></Suspense>
    </Workbench>
    <UploadDialog workspaces={workspaces.filter(workspace => workspace.sessionID && workspace.state === '已连接').map(workspace => workspace.sessionID!)} onSubmitted={items => { transfers.accept(items); setTransferReveal(items[0].id); setTransfersOpen(true); }} />
    {!demoScene&&<>
    {dialog && <Suspense fallback={<div role="status">正在载入连接表单…</div>}><ConnectionDialog {...dialog} systemRDP={systemRDP} gateways={rdpGateways} preference={preferences[dialog.connection?.id || '']} groups={catalog?.groups || []} connections={catalog?.connections||[]} busy={attempt.busy} connectionError={attempt.error} connectionSteps={attempt.busy || attempt.error ? attempt.steps : []} onConnect={(connection, auth, options) => connect(connection, auth, dialog.workspaceID, options)} onSaved={() => void reload()} onClose={() => { setDialog(undefined); attempt.clearError(); }} onCancel={attempt.cancel} /></Suspense>}
    <Modal isOpen={connectionDiagnosticsOpen} onClose={() => setConnectionDiagnosticsOpen(false)} size="2xl" className="app-dialog" scrollBehavior="inside"><ModalContent><ModalHeader>SSH 连接诊断 · {attempt.target}</ModalHeader><ModalBody><ConnectionDiagnostics steps={attempt.steps} workspace={attempt.connectedWorkspace} busy={attempt.busy} /></ModalBody><ModalFooter><Button variant="light" onPress={() => setConnectionDiagnosticsOpen(false)}>关闭</Button></ModalFooter></ModalContent></Modal>
    <Modal isOpen={!!rdpStart} onClose={()=>setRDPStart(undefined)} className="app-dialog"><ModalContent><ModalHeader>连接远程桌面</ModalHeader><ModalBody>{rdpStart && <><p>{rdpStart.connection.name}</p><label className="form-field">连接方式<SelectControl value={rdpStart.options.client || 'internal'} onChange={e=>setRDPStart({...rdpStart,options:{...rdpStart.options,client:e.target.value,gateway:e.target.value==='system'?'':rdpStart.options.gateway,resolution:e.target.value!=='system'&&rdpStart.options.resolution==='multimon'?'dynamic':rdpStart.options.resolution}})}><option value="internal">内置客户端</option><option value="system" disabled={!systemRDP}>系统客户端（mstsc）</option></SelectControl></label>{rdpStart.options.client!=='system'&&<label className="form-field">连接路径<SelectControl value={rdpStart.options.gateway||''} onChange={event=>setRDPStart({...rdpStart,options:{...rdpStart.options,gateway:event.target.value}})}><option value="">直连</option>{rdpGateways.map(gateway=><option key={gateway.id} value={gateway.id}>经 SSH · {gateway.name}</option>)}</SelectControl></label>}<label className="checkbox-label"><input type="checkbox" checked={rdpStart.options.clipboard} onChange={e=>setRDPStart({...rdpStart,options:{...rdpStart.options,clipboard:e.target.checked}})} />文本剪贴板</label><label className="form-field">远端分辨率<SelectControl value={rdpStart.options.resolution} onChange={e=>setRDPStart({...rdpStart,options:{...rdpStart.options,resolution:e.target.value}})}><option value="dynamic">适应窗口</option><option value="1280x800">1280 × 800</option><option value="1920x1080">1920 × 1080</option>{rdpStart.options.client==='system'&&<option value="multimon">全部显示器</option>}</SelectControl></label></>}</ModalBody><ModalFooter><Button variant="light" onPress={()=>setRDPStart(undefined)}>取消</Button><Button color="primary" onPress={async()=>{if(!rdpStart)return;const launch=rdpStart;setRDPStart(undefined);try{await saveRDPResolution(launch.connection.id,launch.options.resolution);await SetRDPClient(launch.connection.id, launch.options.client || 'internal');setPreferences(prev=>({...prev,[launch.connection.id]:{...prev[launch.connection.id]!,rdp_client:launch.options.client || 'internal'}}));await attempt.start(launch.connection,undefined,undefined,launch.options);}catch(e){setPreferenceError(errorMessage(e));}}}>连接</Button></ModalFooter></ModalContent></Modal>
    <HostTrustDialog target={attempt.trust} onConfirm={attempt.confirm} />
    {servicesOpen && <Suspense fallback={<div role="status">正在载入远端服务…</div>}><ServicesDialog entries={services} connections={catalog?.connections || []} initial={current?.connectionID} error={serviceError} onChanged={values => { setServices(values); setServiceError(''); }} onOpen={openService} onClose={() => setServicesOpen(false)} /></Suspense>}
    {attempt.challenge && <SSHChallengeDialog key={attempt.challenge.id} challenge={attempt.challenge} target={attempt.target} onAnswer={attempt.answer} onCancel={attempt.cancel} />}
    {recordingOpen && <Suspense fallback={<div role="status">正在载入录制回放…</div>}><RecordingPlayer onClose={() => setRecordingOpen(false)} /></Suspense>}
    {batchCommandOpen && <Suspense fallback={<div role="status">正在载入批量命令…</div>}><BatchCommandDialog groups={catalog?.groups} targets={workspaces.filter(w => w.sessionID && w.state === '已连接').map(w => ({ id: w.sessionID!, name: w.name, address: `${w.connection?.username}@${w.connection?.host}:${w.connection?.port}`, connection: w.connection, preference: preferences[w.connectionID] }))} initial={current?.sessionID} snippets={snippets} onClose={() => setBatchCommandOpen(false)} /></Suspense>}
    {fileCompareOpen && <Suspense fallback={<div role="status">正在载入文件对比…</div>}><FileCompareDialog targets={workspaces.filter(w => !w.local && !w.rdp && w.sessionID && w.state === '已连接').map(w => ({ id: w.sessionID!, name: w.name }))} initial={current?.ssh ? current.sessionID : undefined} onTransfer={item => { transfers.accept([item]); setTransferReveal(item.id); setTransfersOpen(true); }} onClose={() => setFileCompareOpen(false)} /></Suspense>}
    {(commandTasksOpen || commandTasksCreated) && <Suspense fallback={commandTasksOpen ? <div role="status">正在载入命令任务…</div> : null}><CommandTasksDialog open={commandTasksOpen} runs={commandRuns.items} historyError={commandRuns.error} onRefresh={commandRuns.refresh} onRun={commandRuns.update} groups={catalog?.groups} targets={workspaces.filter(w => w.ssh && w.sessionID && w.state === '已连接').map(w => ({ id: w.sessionID!, name: w.name, address: `${w.connection?.username}@${w.connection?.host}:${w.connection?.port}`, connection: w.connection, preference: preferences[w.connectionID] }))} onClose={() => setCommandTasksOpen(false)} /></Suspense>}
    {dockerOpen && <Suspense fallback={<div role="status">正在载入 Docker…</div>}><DockerDialog targets={workspaces.filter(w => w.ssh && w.sessionID && w.state === '已连接').map(w => ({ id: w.sessionID!, name: w.name }))} initial={current?.ssh ? current.sessionID : undefined} fontSize={fontSize} onDirectory={(session, path) => { const target = workspaces.find(value => value.sessionID === session); if (target) { setActive(target.id); target.ssh?.current?.locateDirectory(path); setDockerOpen(false); } }} onClose={() => setDockerOpen(false)} /></Suspense>}
    {restoreDialog&&<WorkspaceRestoreDialog layout={restoreDialog} connections={catalog?.connections||[]} openIDs={workspaces.map(w=>w.id)} onRestore={restoreWorkspaces} onClose={()=>setRestoreDialog(undefined)}/>}
    {workspaceSetLayout && <Suspense fallback={<div className="session-status" role="status">正在载入工作集…</div>}><WorkspaceSetsDialog layout={workspaceSetLayout} localCount={workspaces.filter(workspace => !!workspace.local).length} connections={catalog?.connections || []} onOpen={openWorkspaceSet} onClose={() => setWorkspaceSetLayout(undefined)} /></Suspense>}
    {palette && <CommandPalette commands={commands} initialScope={paletteScope} initialQuery={paletteQuery} onClose={() => { setPalette(false); setPaletteQuery(''); }} error={snippetError} />}
    {snippetInsert&&<SnippetInsertDialog snippet={snippetInsert.snippet} onClose={()=>setSnippetInsert(undefined)} onInsert={text=>active===snippetInsert.workspace&&(current?.local?!!current.local.terminal.current?.insert(text):!!current?.ssh?.current?.insert(text,snippetInsert.terminal))}/>}
    <WorkbenchCloseDialog close={workbenchClose} keepDrafts={recovery.enabled} />
    </>}
    </div>
    {demoScene&&<Suspense fallback={<div className="view-loading demo-loading" role="status">正在准备演示…</div>}><DemoWorkbench key={`${demoScene}-${demoRevision}`} scene={demoScene} onScene={selectDemoScene} onExit={exitDemo} shortcuts={shortcuts} fontSize={fontSize} /></Suspense>}
  </>;
}
