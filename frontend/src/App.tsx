import Modal from './components/Modal';
import { statusLabel } from './i18n/status';
import { eventError, errorMessage } from './lib/errors.ts';
import { connectionStateLabel } from './i18n/connectionState';
import { t as translate, currentLocale } from './i18n/index.ts';
import { message as uiMessage } from './i18n/messages.ts';
import { useMessageState } from './i18n/useMessageState.ts';
import { useTranslation } from 'react-i18next';

import SelectControl from './components/SelectControl';
import { createRef, lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { AnimatePresence } from 'framer-motion';
import { Browser, Events, System } from '@wailsio/runtime';
import { Button, DropdownTrigger, DropdownMenu, DropdownItem, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@heroui/react';
import { Dropdown } from './components/Popover';
import Tooltip from './components/Tooltip';
import { GetCatalog, GetConnectionPreferences, RecordConnectionSuccess, SetRDPResolution, SetRDPClient, SystemRDPAvailable, ListSnippets } from '../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { ConnectionResource, Snippet, TunnelPreset, WorkspaceLayout, WorkspaceLayoutEntry } from '../bindings/github.com/Sanjeever/termquay/internal/app/models';
import { ListServiceEntries, ListTunnels, StartTunnel } from '../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { Connection, ConnectionPreference, Group } from '../bindings/github.com/Sanjeever/termquay/internal/store/models';
import type { SSHWorkspaceHandle } from './features/files/SSHWorkspace';
import type { RDPHandle, RDPOptions } from './features/rdp/RDPView';
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
import type { CommandTarget } from './features/terminal/CommandTargets';
import useCommandRuns from './features/terminal/useCommandRuns';
import type { CommandTasksRequest } from './features/terminal/CommandTasksWorkspace';
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
import useApplicationLock from './features/settings/useApplicationLock';
import ApplicationLockScreen from './features/settings/ApplicationLockScreen';

const loadSSHWorkspace = () => import('./features/files/SSHWorkspace');
const loadTerminalView = () => import('./features/terminal/TerminalView');
const loadRDPView = () => import('./features/rdp/RDPView');
const RDPView = lazy(loadRDPView);
const SSHWorkspace = lazy(loadSSHWorkspace);
const TerminalView = lazy(loadTerminalView);
const ConnectionDialog = lazy(() => import('./features/connections/ConnectionDialog'));
const TransferPanel = lazy(() => import('./features/files/TransferPanel'));
const SettingsView = lazy(() => import('./features/settings/SettingsView'));
const DemoWorkbench = lazy(() => import('./features/demo/DemoWorkbench'));
const WorkspaceSetsDialog = lazy(() => import('./features/workspaces/WorkspaceSetsDialog'));
const FileCompareDialog = lazy(() => import('./features/files/FileCompareDialog'));
const CommandTasksWorkspace = lazy(() => import('./features/terminal/CommandTasksWorkspace'));
const LogWorkspace = lazy(() => import('./features/logs/LogWorkspace'));
const RecordingPlayer = lazy(() => import('./features/terminal/RecordingPlayer'));
const DockerDialog = lazy(() => import('./features/docker/DockerDialog'));
const StorageAccess = lazy(() => import('./features/settings/StorageAccess'));
const ServicesDialog = lazy(() => import('./features/tunnels/ServicesDialog'));
const ConnectionPlaybookDialog = lazy(() => import('./features/connections/ConnectionPlaybookDialog'));
const DiagnosticSnapshotsDialog = lazy(() => import('./features/monitor/DiagnosticSnapshotsDialog'));
const commandTasksTabID = 'multi-host-operations';
const logsTabID = 'multi-source-logs';

export default function App() {
  useTranslation();
  const { appearance, update: updateAppearance, beginPreview, endPreview } = useAppearance();
  const [demoScene, setDemoScene] = useState<DemoScene|null>(null);
  const [demoRevision, setDemoRevision] = useState(0);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [active, setActive] = useState('');
  const [catalog, setCatalog] = useState<{ groups: Group[]; connections: Connection[]; session_only: boolean }>();
  const appLock = useApplicationLock(!!catalog);
  const [storageError, setStorageError] = useMessageState('');
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
  const [preferenceError, setPreferenceError] = useMessageState('');
  const [preferenceLoadError, setPreferenceLoadError] = useMessageState('');
  const [portableError, setPortableError] = useMessageState('');
  const [portableFailure, setPortableFailure] = useState(0);
  const [dismissedPortable, setDismissedPortable] = useState(0);
  const portableGeneration = useRef(0);
  const [dialog, setDialog] = useState<{ connection?: Connection; temporary: boolean; workspaceID?: string; rdpOptions?: RDPOptions }>();
  const [rdpStart, setRDPStart] = useState<{connection:Connection;options:RDPOptions}>();
  const [systemRDP, setSystemRDP] = useState(false);
  useEffect(() => { SystemRDPAvailable().then(setSystemRDP).catch(e => setPreferenceError(e)); return Events.On('rdp:system-error', event => setPreferenceError(eventError((event.data as {error:string})))); }, []);
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
  const [snippetError,setSnippetError]=useMessageState('');
  const [snippetInsert,setSnippetInsert]=useState<{snippet:Snippet;workspace:string;terminal:string}>();
  const [fileCompareOpen, setFileCompareOpen] = useState(false);
  const [recordingOpen, setRecordingOpen] = useState(false);
  const [commandTasksTab, setCommandTasksTab] = useState(false);
  const [logsTab, setLogsTab] = useState(false);
  const logsOpen = logsTab && active === logsTabID && !settings && !demoScene && !appLock.status?.locked;
  const [logsInitial, setLogsInitial] = useState<string>();
  const commandTasksOpen = commandTasksTab && active === commandTasksTabID && !settings && !demoScene;
  const [commandTasksRequest, setCommandTasksRequest] = useState<CommandTasksRequest>();
  const commandTasksRequestID = useRef(0);
  const [commandTasksCreated, setCommandTasksCreated] = useState(false);
  const commandRuns = useCommandRuns(backgroundReady || commandTasksOpen);
  useEffect(() => { if (commandTasksOpen) setCommandTasksCreated(true); }, [commandTasksOpen]);
  const [dockerOpen, setDockerOpen] = useState(false);
  const [diagnosticSnapshotsOpen, setDiagnosticSnapshotsOpen] = useState(false);
  const [dockerResource, setDockerResource] = useState<{ workspace: string; container: string }>();
  const [playbookConnection, setPlaybookConnection] = useState<Connection>();
  const [resourceRequest, setResourceRequest] = useState<{ session: string; resource: ConnectionResource }>();
  const [servicesOpen, setServicesOpen] = useState(false);
  const [services, setServices] = useState<TunnelPreset[]>([]);
  const [serviceError, setServiceError] = useMessageState('');
  const serviceOpening = useRef(false);
  const serviceRequest = useRef<ReturnType<typeof StartTunnel>>();
  const lastSSH = useRef<{ id: string; connectionID: string }>();
  useEffect(() => { if (!catalog || (!backgroundReady && !palette && !servicesOpen)) return; let ended = false; const request = ListServiceEntries(); request.then(values => { if (!ended) { setServices(values || []); setServiceError(''); } }).catch(e => { if (!ended) setServiceError(e); }); return () => { ended = true; request.cancel(); }; }, [catalog, palette, servicesOpen, backgroundReady]);
  useEffect(() => () => { serviceRequest.current?.cancel(); }, []);
  const [localShells,setLocalShells]=useState<LocalShell[]>([]);
  const [openingLocal,setOpeningLocal]=useState(false);
  const localOpening=useRef(false);
  useEffect(()=>{ListLocalShells().then(values=>setLocalShells(values||[])).catch(e=>setPreferenceError(e));},[]);
  async function openLocalShell(kind:string){if(localOpening.current||latestWorkspaces.current.length>=16)return;localOpening.current=true;setOpeningLocal(true);try{await loadTerminalView();const terminal=await OpenLocalTerminal(kind,100,30);if(latestWorkspaces.current.length>=16){await CloseLocalTerminal(terminal.id);throw uiMessage('common:openWorkspaceLimitReached16');}setWorkspaces(previous=>[...previous,{id:terminal.id,sessionID:terminal.id,connectionID:'',name:terminal.name,local:{shell:terminal.name,terminal:createRef<TerminalHandle>()}}]);select(terminal.id);}catch(e){setPreferenceError(e);}finally{localOpening.current=false;setOpeningLocal(false);}}
  const [shortcuts, setShortcuts] = useState<Shortcuts>({ ...defaultShortcuts });
  const [shortcutError, setShortcutError] = useMessageState('');
  const current = workspaces.find(w => w.id === active);
  const connectionSessions = useMemo(() => {
    const sessions = new Map<string, string[]>();
    for (const workspace of workspaces) {
      const states = sessions.get(workspace.connectionID) || [];
      states.push(connectionStateLabel(workspace.state || 'connecting'));
      sessions.set(workspace.connectionID, states);
    }
    return Object.fromEntries(sessions);
  }, [workspaces, currentLocale()]);
  const rdpGateways=workspaces.filter(workspace=>workspace.ssh&&workspace.sessionID&&workspace.state==='connected').map(workspace=>({id:workspace.sessionID!,name:workspace.name}));
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
    if (!layout) { setPreferenceError(uiMessage('common:workspaceLayoutIsNotReadyTryAgainShortly')); return; }
    setWorkspaceSetLayout(layout);
  }
  async function flushLocalState(){if(!catalog)return;notifyLocalState();await workspaceRestore.flush();await recovery.flush();++portableGeneration.current;await SavePortableUI(capturePortableUI());setPortableError('');}
  const workbenchClose = useWorkbenchClose({
    locked: !!appLock.status?.locked,
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
  function closeWorkspace(id = active, keyboard = true) {
    if (id === logsTabID) { setLogsTab(false); if (active === id) select(recentWorkspaces.current.find(value => workspaces.some(workspace => workspace.id === value) || (commandTasksTab && value === commandTasksTabID)) || '', keyboard); return; }
    if (id === commandTasksTabID) { setCommandTasksTab(false); if (active === id) select(recentWorkspaces.current.find(value => workspaces.some(workspace => workspace.id === value)) || '', keyboard); return; }
    if (id) workbenchClose.requestClose(id, keyboard);
  }
  function openCommandTasks(section: CommandTasksRequest['section'] = 'execute', targets?: string[], task?: string) {
    setCommandTasksTab(true);
    setCommandTasksRequest({ id: ++commandTasksRequestID.current, section, targets: targets ?? (section !== 'history' && current?.ssh && current.sessionID ? [current.sessionID] : undefined), task });
    select(commandTasksTabID);
  }
  function openLogs() { if (!logsTab) setLogsInitial(current?.ssh ? current.sessionID : undefined); setLogsTab(true); select(logsTabID); }
  function closeCurrentTab() { if (settings) { setSettings(false); return; } if (current?.ssh?.current?.workspaceAction('closeContent')) return; closeWorkspace(); }
  function newTerminal() { if (current?.ssh && !settings) { current.ssh.current?.workspaceAction('newTerminal'); return; } const shell = localShells.find(shell=>shell.name===current?.local?.shell) || localShells[0]; if(shell)void openLocalShell(shell.id); }
  function moveWorkspace(id: string, target: string) {
    setWorkspaces(prev => { const from = prev.findIndex(w => w.id === id); const to = prev.findIndex(w => w.id === target); if (from < 0 || to < 0 || from === to) return prev; const next = [...prev]; next.splice(to, 0, next.splice(from, 1)[0]); return next; });
  }
  function workspaceState(id: string, state: string) { setWorkspaces(prev => prev.map(w => w.id === id && w.state !== state ? { ...w, state } : w)); }
  function workspaceAttention(id: string, attention?: CommandAttention) { setWorkspaces(prev => prev.some(w => w.id === id && w.attention !== attention) ? prev.map(w => w.id === id ? { ...w, attention } : w) : prev); }
  async function recordSuccess(id: string) { if (!id) return; try { await RecordConnectionSuccess(id); setPreferences(await GetConnectionPreferences() || {}); } catch (e) { setPreferenceError(uiMessage('common:couldNotRecordTheRecentConnection', { value1: e })); } }
  async function saveRDPResolution(id: string, value: string) { if (!id) return; await SetRDPResolution(id,value); setPreferences(await GetConnectionPreferences() || {}); }
  const attempt = useConnectionAttempt((id, connection, reuse, automatic, route) => {
    if(reuse&&!latestWorkspaces.current.some(w=>w.id===reuse))throw uiMessage('common:workspaceClosed');
    if(!reuse&&latestWorkspaces.current.length>=16)throw uiMessage('common:openWorkspaceLimitReached16');
    lastSSH.current = { id, connectionID: connection.id };
    setWorkspaces(prev => reuse?prev.map(w=>w.id===reuse?{...w,sessionID:id,connection,route,connectionID:connection.id,restored:false}:w):[...prev, { id, sessionID:id, connection,route, connectionID: connection.id, name: connection.name, ssh: createRef<SSHWorkspaceHandle>() }]); if (!automatic) select(reuse||id);
    void recordSuccess(connection.id);
  }, (connection, reuse, options = {clipboard:false,resolution:preferences[connection.id]?.rdp_resolution || 'dynamic'}) => {
    if(!reuse&&latestWorkspaces.current.length>=16)throw uiMessage('common:openWorkspaceLimitReached16');
    const id = reuse || crypto.randomUUID();
    flushSync(() => {
      setWorkspaces(prev => reuse ? prev.map(w => w.id === id ? { ...w, connection,connectionID: connection.id,restored:false, rdp: { connection, options } } : w) : [...prev, { id, connectionID: connection.id, name: connection.name, rdp: { connection, options }, view: createRef<RDPHandle>() }]);
      select(id);
    });
    return id;
  }, async (id, grant, username, password, domain) => {
    flushSync(() => setWorkspaces(prev => prev.map(w => w.id === id ? { ...w, rdp: { ...w.rdp!, grant } } : w)));
    const view = latestWorkspaces.current.find(w => w.id === id)?.view?.current;
    if (!view) throw uiMessage('common:workspaceClosed');
    await view.connect(username, password, domain);
    const connectionID = latestWorkspaces.current.find(w => w.id === id)?.connectionID;
    if (connectionID) void recordSuccess(connectionID);
  }, (id, error) => setWorkspaces(prev => prev.map(w => w.id === id ? { ...w, rdp: { ...w.rdp!, error } } : w)), id => latestWorkspaces.current.find(w => w.id === id)?.view?.current?.cancel(), remove, loadSSHWorkspace, loadRDPView);

  async function reload() { setCatalogLoading(true); try { const data = await GetCatalog(); try { setPreferences(await GetConnectionPreferences() || {}); setPreferenceLoadError(''); } catch (e) { setPreferenceLoadError(e); } setCatalog({ ...data, groups: data.groups ?? [], connections: data.connections ?? [] }); setStorageError(''); } catch (e) { setStorageError(e); } finally { setCatalogLoading(false); } }
  function showDemo(scene: DemoScene = 'connections') { if(attempt.busy||openingLocal||dialog||rdpStart||restoreDialog||snippetInsert||attempt.trust||closing||quitConfirm||restarting||document.querySelector('[role=dialog][aria-modal=true]:not(.command-palette)'))return;if(!demoScene)beginPreview();setPalette(false);selectDemoScene(scene); }
  function selectDemoScene(scene: DemoScene) { setDemoScene(scene);setDemoRevision(value=>value+1); }
  function exitDemo() { setDemoScene(null);endPreview(); }
  useEffect(() => { void reload(); }, []);
  useEffect(()=>{if(!palette&&!commandTasksOpen){setSnippets([]);return;}let ended=false;const request=ListSnippets();request.then(values=>{if(!ended){setSnippets(values||[]);setSnippetError('');}}).catch(e=>{if(!ended)setSnippetError(e);});return()=>{ended=true;request.cancel();};},[palette,commandTasksOpen]);
  useEffect(() => {
    try {
      const stored = localStorage.getItem(shortcutStorageKey); if (!stored) return;
      const values = mergeShortcuts(JSON.parse(stored));
      for (const d of shortcutDefinitions) { if (typeof values[d.id] !== 'string' || shortcutConflict(d.id, values[d.id], values)) throw uiMessage('common:invalidShortcutConfigurationResetItInSettings'); }
      setShortcuts(values);
    } catch (e) { setShortcutError(e); }
  }, []);
  function saveShortcuts(values: Shortcuts) { try { localStorage.setItem(shortcutStorageKey, JSON.stringify(values)); setShortcuts(values); setShortcutError(''); window.dispatchEvent(new Event('termquay:portable-changed')); } catch (e) { setShortcutError(e); } }
  async function savePortable() {
    const request = ++portableGeneration.current;
    try { await SavePortableUI(capturePortableUI()); if (request === portableGeneration.current) setPortableError(''); }
    catch (error) { if (request === portableGeneration.current) {setPortableError(error);setPortableFailure(value=>value+1);} }
  }
  useEffect(() => {
    if (!catalog) return;
    let ended = false; let changed=false; let timer: ReturnType<typeof setTimeout>;
    const restored = () => { try { setShortcuts(mergeShortcuts(JSON.parse(localStorage.getItem(shortcutStorageKey) || '{}'))); } catch (e) { setShortcutError(e); } };
    const save = () => { changed=true;clearTimeout(timer); timer = setTimeout(() => {if(!ended)void savePortable();}, 300); };
    window.addEventListener('termquay:portable-restored', restored); window.addEventListener('termquay:portable-changed', save);
    GetPortableUI().then(async values => { if (ended||changed) return; if (Object.keys(values || {}).length) applyPortableUI(values); else await savePortable(); }).catch(e => { if (!ended) setPreferenceError(uiMessage('common:couldNotReadInterfaceSettings', { value1: e })); });
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
      if (appLock.locked.current || demoScene || event.isComposing || event.repeat || dialog || attempt.trust || closing || quitConfirm || restarting) return;
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
      else if (action.id === 'nextWorkspace' || action.id === 'previousWorkspace') { const ids = ['', ...workspaces.map(w=>w.id), ...(commandTasksTab ? [commandTasksTabID] : []), ...(logsTab ? [logsTabID] : [])]; select(ids[(ids.indexOf(active) + (action.id === 'nextWorkspace' ? 1 : -1) + ids.length) % ids.length]); }
      else if (action.scope === 'workspace') current?.ssh?.current?.workspaceAction(action.id);
      else if(action.scope==='terminal'){if(current?.local)current.local.terminal.current?.action(action.id);else current?.ssh?.current?.terminalAction(action.id);}
    };
    window.addEventListener('keydown', key, true); return () => window.removeEventListener('keydown', key, true);
  }, [dialog, attempt.trust, closing, quitConfirm, restarting, shortcuts, settings, current, workspaces, active,demoScene,commandTasksTab,logsTab]);
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
    if(saved&&saved.protocol!=='rdp'){setPreferenceError(uiMessage('common:theSavedProtocolHasChangedOpenANew'));return;}
    if(saved&&w.restored&&w.rdp&&!sameTarget(saved,w.rdp.connection)){setPreferenceError(uiMessage('common:theSavedDestinationHasChangedEditTheRecovery'));return;}
    if (saved) void attempt.start(saved, undefined, w.id, w.view?.current?.options() || w.rdp?.options); else editRDP(w);
  }
  async function connect(connection:Connection, auth?:Parameters<typeof attempt.start>[1], reuse?:string, options?:RDPOptions){
    const workspace=reuse?latestWorkspaces.current.find(w=>w.id===reuse):undefined;
    if(reuse&&!workspace)return false;
    if(workspace&&(workspace.rdp?'rdp':workspace.connection?.protocol)!==connection.protocol){setPreferenceError(uiMessage('common:theWorkspaceProtocolCannotChangeOpenANew'));return false;}
    if(workspace?.ssh?.current&&!await workspace.ssh.current.prepareReconnect())return false;
    return attempt.start(connection,auth,reuse,options);
  }
  function sameTarget(a:Connection,b:Connection){return a.protocol===b.protocol&&a.host===b.host&&a.port===b.port&&a.username===b.username&&(a.domain||'')===(b.domain||'')&&(a.jump_id||'')===(b.jump_id||'')&&(a.proxy_address||'')===(b.proxy_address||'');}
  const taskTargets = useMemo<CommandTarget[]>(() => {
    const connected = workspaces.filter(workspace => workspace.ssh && workspace.sessionID && workspace.state === 'connected').map(workspace => ({ id: workspace.sessionID!, name: workspace.name, address: `${workspace.connection?.username}@${workspace.connection?.host?.includes(':') ? `[${workspace.connection.host}]` : workspace.connection?.host}:${workspace.connection?.port}`, connection: workspace.connection, preference: preferences[workspace.connectionID] }));
    return [...connected, ...(catalog?.connections || []).filter(connection => connection.protocol === 'ssh' && !connected.some(target => target.connection?.id === connection.id && sameTarget(target.connection, connection))).map(connection => ({ id: `saved:${connection.id}`, name: connection.name, address: `${connection.username}@${connection.host.includes(':') ? `[${connection.host}]` : connection.host}:${connection.port}`, connection, preference: preferences[connection.id], disconnected: true }))];
  }, [workspaces, catalog, preferences]);
  function openConnectionTasks(ids: string[]) {
    openCommandTasks('execute', ids.flatMap(id => {
      const connection = catalog?.connections.find(item => item.id === id);
      const target = taskTargets.find(item => item.connection?.id === id && connection && sameTarget(item.connection, connection));
      return target ? [target.id] : [];
    }));
  }
  async function connectTaskTargets(targets: CommandTarget[]) {
    if (attempt.busy || localOpening.current) throw uiMessage('common:waitForTheCurrentConnectionToFinish');
    const connected: { before: string; target: CommandTarget }[] = [], failures: string[] = [];
    try {
      for (const target of targets) {
        const connection = catalog?.connections.find(item => item.id === target.connection?.id && item.protocol === 'ssh');
        if (!connection) { failures.push(translate('common:savedConnectionDeleted', { value1: target.name })); continue; }
        const existing = latestWorkspaces.current.find(item => item.ssh && item.sessionID && item.state === 'connected' && item.connectionID === connection.id && item.connection && sameTarget(item.connection, connection));
        let session = existing?.sessionID;
        if (!session) {
          if (!await connect(connection)) {
            const message = attempt.lastError() || translate('common:connectionCanceled'); failures.push(`${target.name}：${message}`);
            if (attempt.wasCanceled()) { failures.push(translate('common:remainingDestinationsWereNotConnected')); break; }
            continue;
          }
          session = lastSSH.current?.connectionID === connection.id ? lastSSH.current.id : undefined;
        }
        if (session) connected.push({ before: target.id, target: { ...target, id: session, disconnected: false } });
        else failures.push(translate('common:connectionWasNotHandedOverToTheWorkspace', { value1: target.name }));
      }
      return { connected, failures };
    } finally { setCommandTasksTab(true); select(commandTasksTabID); }
  }
  function reconnectSSH(w:Workspace){const saved=catalog?.connections.find(c=>c.id===w.connectionID);if(saved&&saved.protocol!=='ssh'){setPreferenceError(uiMessage('common:theSavedProtocolHasChangedOpenANew'));return;}if(saved&&w.restored&&w.connection&&!sameTarget(saved,w.connection)){setPreferenceError(uiMessage('common:theSavedDestinationHasChangedReenterTheRecovery'));return;}if(saved)void connect(saved,undefined,w.id);else if(w.connection)setDialog({connection:{...w.connection,id:'',credential_id:''},temporary:true,workspaceID:w.id});}
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
    if (serviceOpening.current || attempt.busy) throw uiMessage('common:waitForTheCurrentConnectionOrServiceStartup');
    const connection = catalog?.connections.find(c => c.id === entry.connection_id && c.protocol === 'ssh');
    if (!connection) throw uiMessage('common:theServiceSSSHConnectionWasDeleted');
    serviceOpening.current = true;
    try {
      const workspace = latestWorkspaces.current.find(w => w.connectionID === entry.connection_id && w.ssh && w.sessionID && w.state === 'connected' && w.connection && sameTarget(w.connection, connection));
      let session = workspace?.sessionID;
      if (!session) {
        setServicesOpen(false);
        const previous = latestWorkspaces.current.find(w => w.connectionID === entry.connection_id && w.ssh);
        if (!await connect(connection, undefined, previous?.id) || lastSSH.current?.connectionID !== connection.id) throw uiMessage('common:theServiceHostIsNotConnected');
        session = lastSSH.current.id;
      }
      const tunnels = await ListTunnels(session) || [];
      let tunnel = tunnels.find(t => t.info.state === 'running' && t.spec.kind === 'local' && t.spec.bind_host === entry.spec.bind_host && t.spec.bind_port === entry.spec.bind_port && t.spec.target_host === entry.spec.target_host && t.spec.target_port === entry.spec.target_port && !t.spec.allow_public);
      if (!tunnel) { const request = StartTunnel(session, entry.spec); serviceRequest.current = request; tunnel = await request; }
      if (entry.service_type === 'address') await navigator.clipboard.writeText(tunnel.info.address);
      else { const url = new URL(`${entry.service_type}://${tunnel.info.address}`); const path = new URL(entry.url_path || '/', url); if (path.origin !== url.origin) throw uiMessage('common:theServiceURLPathChangedTheDestination'); await Browser.OpenURL(path.toString()); }
      setServiceError('');
    } catch (e) { setPreferenceError(e); throw e; }
    finally { serviceRequest.current = undefined; serviceOpening.current = false; }
  }
  async function openPlaybookResource(resource: ConnectionResource) {
    if (!playbookConnection) return;
    const connection = catalog?.connections.find(item => item.id === playbookConnection.id);
    if (!connection || connection.protocol !== 'ssh') throw uiMessage('common:quickResourcesRequireAValidSSHConnection');
    if (resource.kind === 'tunnel') {
      const entry = services.find(item => item.connection_id === connection.id && item.name === resource.target);
      if (!entry) throw uiMessage('common:theRemoteServiceReferenceIsNoLongerValid');
      setPlaybookConnection(undefined); await openService(entry); return;
    }
    if (resource.kind === 'task') { setPlaybookConnection(undefined); openCommandTasks('execute', undefined, resource.target); return; }
    const workspace = latestWorkspaces.current.find(item => item.ssh && item.connectionID === connection.id && item.state === 'connected' && item.connection && sameTarget(item.connection, connection));
    let session = workspace?.sessionID;
    if (!workspace) {
      setPlaybookConnection(undefined);
      if (!await connect(connection)) throw uiMessage('common:connectionIncompleteReviewTheConnectionError');
      session = lastSSH.current?.connectionID === connection.id ? lastSSH.current.id : undefined;
    }
    if (!session) throw uiMessage('common:theQuickResourceSSSHSessionIsNo');
    setResourceRequest({ session, resource });
  }
  useEffect(() => {
    if (!resourceRequest) return;
    const workspace = workspaces.find(item => item.ssh && item.sessionID === resourceRequest.session);
    if (workspace?.state === 'disconnected') { setResourceRequest(undefined); setPreferenceError(uiMessage('common:theQuickResourceSSSHSessionDisconnected')); return; }
    if (workspace?.state !== 'connected' || !workspace.ssh?.current) return;
    setResourceRequest(undefined); select(workspace.id);
    const resource = resourceRequest.resource;
    if (resource.kind === 'container') { setDockerResource({ workspace: workspace.sessionID!, container: resource.target }); setDockerOpen(true); }
    else if (resource.kind === 'snippet') {
      void ListSnippets().then(items => {
        const snippet = items?.find(item => item.id === resource.target);
        const terminal = workspace.ssh?.current?.insertionTarget();
        if (!snippet) throw uiMessage('common:theSnippetReferenceIsNoLongerValidEdit');
        if (!terminal) throw uiMessage('common:selectAnInteractiveTerminalBeforeOpeningASnippet');
        setSnippetInsert({ snippet, workspace: workspace.id, terminal });
      }).catch(e => setPreferenceError(e));
    } else void workspace.ssh.current.openResource(resource.kind, resource.target).catch(e => setPreferenceError(e));
  }, [resourceRequest, workspaces]);
  async function restoreWorkspaces(entries:WorkspaceLayoutEntry[], preferredActive=restoreDialog?.active){await recovery.flush();const currentIDs=new Set(latestWorkspaces.current.map(w=>w.id));const values=entries.filter(e=>!currentIDs.has(e.id));if(values.length+currentIDs.size>16)throw uiMessage('common:openWorkspaceLimitReached16');const restored:Workspace[]=values.map(e=>{const c:Connection={...e.target,id:e.connection_id,group_id:'',credential_id:''};return {id:e.id,connectionID:e.connection_id,connection:c,name:e.name,state:'not-connected',restored:true,...(c.protocol==='ssh'?{ssh:createRef<SSHWorkspaceHandle>(),restore:e.ssh||undefined}:{rdp:{connection:c,options:{clipboard:false,resolution:preferences[c.id]?.rdp_resolution||'dynamic'}},view:createRef<RDPHandle>()})};});setWorkspaces(prev=>[...prev,...restored]);if(restored.length)select(restored.some(w=>w.id===preferredActive)?preferredActive!:restored[0].id);}
  async function openWorkspaceSet(layout: WorkspaceLayout) {
    if (attempt.busy || localOpening.current) throw uiMessage('common:waitForTheCurrentConnectionOrLocalTerminal');
    const entries = layout.entries || [];
    const ids = new Map(entries.map(entry => [entry.id, crypto.randomUUID()]));
    await restoreWorkspaces(entries.map(entry => ({ ...entry, id: ids.get(entry.id)! })), ids.get(layout.active));
  }
  const tools = <>
    {appLock.status?.available && <button className="session-tool" onClick={() => void appLock.lock()}>{translate('common:lock')}</button>}
    {current?.connectionID && <Tooltip content={translate('common:connectionPlaybook')}><button className="icon-button" aria-label={translate('common:connectionPlaybook')} onClick={() => setPlaybookConnection(catalog?.connections.find(item => item.id === current.connectionID))}><Icon name="files" /></button></Tooltip>}
    <Tooltip content={translate('common:namedWorkingSets')}><button className="icon-button" aria-label={translate('common:namedWorkingSets')} disabled={attempt.busy || openingLocal || !catalog} onClick={manageWorkspaceSets}><Icon name="list" /></button></Tooltip>
    <Dropdown><DropdownTrigger><button className="session-tool" aria-label={translate('common:workbenchTools')}>{translate('common:tools')}<Icon name="chevron" width="11" style={{ transform: 'rotate(90deg)' }} /></button></DropdownTrigger><DropdownMenu aria-label={translate('common:workbenchTools')} onAction={key => { if (key === 'execute') openCommandTasks(); else if (key === 'inspect') openCommandTasks('inspect'); else if (key === 'history') openCommandTasks('history'); else if (key === 'logs') openLogs(); else if (key === 'recording') setRecordingOpen(true); }}><DropdownItem key="execute">{translate('common:multiHostOperations')}</DropdownItem><DropdownItem key="inspect">{translate('common:multiHostInspection')}</DropdownItem><DropdownItem key="history">{translate('common:taskHistory')}</DropdownItem><DropdownItem key="logs">{translate('common:multiSourceLogs')}</DropdownItem><DropdownItem key="recording" showDivider>{translate('common:openTerminalRecording')}</DropdownItem></DropdownMenu></Dropdown>
    <Tooltip content={translate('common:commandSearch', { value1: shortcutLabel(shortcuts.palette) })}><button className="icon-button" aria-label={translate('common:commandSearch2')} onClick={() => { setPaletteScope('all'); setPaletteQuery(''); setPalette(true); }}><Icon name="search" /></button></Tooltip>
    <Tooltip content={updates.status?.version ? translate('common:settingsUpdateAvailable') : translate('common:settings')}><button className="icon-button relative" aria-label={updates.status?.version ? translate('common:settingsUpdateAvailable2') : translate('common:settings')} aria-pressed={settings} onClick={() => { if(updates.status?.version)setSettingsSection('about');setSettings(!settings); }}><Icon name="settings" />{updates.status?.version && <span className="update-indicator" aria-hidden="true" />}</button></Tooltip>
  </>;
  const commands: WorkbenchCommand[] = [
    ...(logsTab ? [{ id: 'workspace-logs', label: translate('common:multiSourceLogs2'), kind: 'workspace' as const, run: () => select(logsTabID) }] : []),
    ...(commandTasksTab ? [{ id: 'workspace-multi-host', label: translate('common:multiHostOperations2'), kind: 'workspace' as const, run: () => select(commandTasksTabID) }] : []),
    ...workspaces.map(w => { const c = w.rdp?.connection || w.connection; return { id: `workspace-${w.id}`, label: w.name, detail: w.local ? translate('common:localTerminal') : c ? `${c.protocol.toUpperCase()} · ${c.username}@${c.host}:${c.port}` : undefined, search: catalog?.groups.find(g=>g.id===c?.group_id)?.name, kind: 'workspace' as const, run: () => select(w.id) }; }),
    ...(palette ? (catalog?.connections || []).map(c => ({ id: `connection-${c.id}`, label: c.name, detail: `${c.protocol.toUpperCase()} · ${c.username}@${c.host}:${c.port}`, search: catalog?.groups.find(g=>g.id===c.group_id)?.name, kind: 'connection' as const, run: () => openSaved(c) })) : []),
    { id: 'new', label: translate('common:newConnection'), shortcut: shortcutLabel(shortcuts.newConnection), kind: 'command', run: () => openDialog(false) },
    { id: 'quick', label: translate('common:quickConnect'), kind: 'command', run: () => openDialog(true) },
    ...demoScenes.map(scene=>({id:`demo-${scene.id}`,label:scene.label,search:translate('common:demoMode'),kind:'command' as const,run:()=>showDemo(scene.id)})),
    ...localShells.map(shell=>({id:`local-${shell.id}`,label:translate('common:localTerminal2', { value1: shell.name }),kind:'command' as const,run:()=>{void openLocalShell(shell.id);}})),
    { id: 'connections', label: translate('common:openConnectionCenter'), kind: 'command', run: () => select('') },
    { id: 'workspace-sets', label: translate('common:manageNamedWorkingSets'), kind: 'command', run: manageWorkspaceSets },
    ...(appLock.status?.available ? [{ id: 'lock-application', label: translate('common:lockApplication'), kind: 'command' as const, run: () => { void appLock.lock(); } }] : []),
    ...(current?.connectionID && catalog?.connections.find(item => item.id === current.connectionID) ? [{ id: 'playbook', label: translate('common:openConnectionPlaybook'), kind: 'command' as const, run: () => setPlaybookConnection(catalog.connections.find(item => item.id === current.connectionID)) }] : []),
    ...(current?.ssh ? [{ id: 'files', label: translate('common:showRemoteFiles'), kind: 'command' as const, run: () => current.ssh?.current?.showFiles() }, { id: 'monitor', label: translate('common:toggleMonitoringPanel'), kind: 'command' as const, run: () => current.ssh?.current?.toggleMonitor() }, { id: 'focus', label: translate('common:toggleFocusMode'), kind: 'command' as const, run: () => current.ssh?.current?.toggleFocus() }] : []),
    ...(current?.ssh||current?.local ? shortcutDefinitions.filter(d => d.scope === 'terminal').map(d => ({ id: `terminal-${d.id}`, label: d.label, detail: shortcutLabel(shortcuts[d.id]), kind: 'command' as const, run: () => {if(current.local)current.local.terminal.current?.action(d.id);else current.ssh?.current?.terminalAction(d.id);} })) : []),
    ...(current?.ssh ? shortcutDefinitions.filter(d=>d.scope==='workspace').map(d=>({id:d.id,label:d.label,detail:shortcutLabel(shortcuts[d.id]),kind:'command' as const,run:()=>current.ssh?.current?.workspaceAction(d.id)})) : []),
    { id: 'transfers', label: translate('common:viewTransfers'), kind: 'command', run: () => setTransfersOpen(true) },
    { id: 'command-tasks', label: translate('common:multiHostOperations2'), search: translate('common:executeCommandBatchManageTask'), kind: 'command', run: () => openCommandTasks() },
    { id: 'inspections', label: translate('common:multiHostInspection2'), search: translate('common:inspectBaselineCompare'), kind: 'command', run: () => openCommandTasks('inspect') },
    { id: 'command-history', label: translate('common:viewTaskHistory'), kind: 'command', run: () => openCommandTasks('history') },
    { id: 'multi-source-logs', label: translate('common:multiSourceLogs2'), search: translate('common:logsFilesSystemdDockerCrossHostSideBy'), kind: 'command', run: openLogs },
    { id: 'services', label: translate('common:manageRemoteServices'), kind: 'command', run: () => setServicesOpen(true) },
    ...services.map(entry => ({ id: `service-${entry.connection_id}-${entry.name}`, label: translate('common:openService', { value1: entry.name }), detail: catalog?.connections.find(c => c.id === entry.connection_id)?.name, search: translate('common:remoteServiceTunnel'), kind: 'command' as const, run: () => { void openService(entry).catch(e => setPreferenceError(e)); } })),
    { id: 'docker', label: translate('common:dockerContainerWorkspace'), kind: 'command', run: () => setDockerOpen(true) },
    { id: 'diagnostic-snapshots', label: translate('common:collectAndCompareDiagnosticSnapshots'), kind: 'command', run: () => setDiagnosticSnapshotsOpen(true) },
    { id: 'file-compare', label: translate('common:manageCompareAndCopyFilesAcrossWorkspaces'), kind: 'command', run: () => setFileCompareOpen(true) },
    { id: 'recording-playback', label: translate('common:openTerminalRecording'), search: translate('common:playbackCastLocal'), kind: 'command', run: () => setRecordingOpen(true) },
    ...(current?.ssh ? [{ id: 'sudo-edit', label: translate('common:editFileWithSudo'), kind: 'command' as const, run: () => current.ssh?.current?.sudoEdit() }] : []),
    { id: 'diagnostics', label: translate('common:exportRedactedDiagnostics'), kind: 'command', run: () => { ExportDiagnostics().catch(e => setPreferenceError(e)); } },
    ...(attempt.steps.length ? [{ id: 'connection-diagnostics', label: translate('common:viewLastSSHConnectionDiagnostics'), kind: 'command' as const, run: () => setConnectionDiagnosticsOpen(true) }] : []),
    { id: 'settings', label: translate('common:openSettings'), shortcut: shortcutLabel(shortcuts.settings), kind: 'command', run: () => setSettings(true) },
    { id: 'about', label: translate('common:aboutTermQuay'), kind: 'command', run: () => { setSettingsSection('about'); setSettings(true); } },
    { id: 'palette', label: translate('common:commandSearch2'), shortcut: shortcutLabel(shortcuts.palette), kind: 'command', run: () => { setPaletteScope('all'); setPaletteQuery(''); setPalette(true); } },
    ...(current?.ssh || localShells.length ? [{ id: 'newTerminal', label: translate('common:newTerminal'), shortcut: shortcutLabel(shortcuts.newTerminal), kind: 'command' as const, run: newTerminal }] : []),
    ...(current || settings || commandTasksOpen || logsOpen ? [{ id: 'closeTab', label: translate('common:closeCurrentTab'), shortcut: shortcutLabel(shortcuts.closeTab), kind: 'command' as const, run: closeCurrentTab }] : []),
    ...(current ? [{ id: 'closeWorkspace', label: translate('common:closeWorkspace'), shortcut: shortcutLabel(shortcuts.closeWorkspace), kind: 'command' as const, run: () => closeWorkspace() }] : []),
    ...(['nextWorkspace','previousWorkspace'] as const).filter(()=>workspaces.length>0||commandTasksTab||logsTab).map(id=>({id,label:id==='nextWorkspace'?translate('common:nextWorkspace'):translate('common:previousWorkspace'),shortcut:shortcutLabel(shortcuts[id]),kind:'command' as const,run:()=>{const ids=['',...workspaces.map(workspace=>workspace.id),...(commandTasksTab?[commandTasksTabID]:[]),...(logsTab?[logsTabID]:[])];select(ids[(ids.indexOf(active)+(id==='nextWorkspace'?1:-1)+ids.length)%ids.length]);}})),
    ...(['uiZoomIn','uiZoomOut','uiZoomReset'] as const).filter(id=>id==='uiZoomIn'?appearance.uiZoom<uiZoomLevels[uiZoomLevels.length-1]:id==='uiZoomOut'?appearance.uiZoom>1:appearance.uiZoom!==1).map(id=>({id,label:id==='uiZoomIn'?translate('common:zoomInInterface'):id==='uiZoomOut'?translate('common:zoomOutInterface'):translate('common:actualInterfaceSize'),kind:'command' as const,run:()=>updateAppearance({...appearance,uiZoom:id==='uiZoomReset'?1:uiZoomLevels[uiZoomLevels.indexOf(appearance.uiZoom)+(id==='uiZoomIn'?1:-1)]})})),
    ...(workspaceRestore.startup?.entries?.length?[{id:'restore-layout',label:translate('common:restorePreviousLayout'),kind:'command' as const,run:()=>setRestoreDialog(workspaceRestore.startup)}]:[]),
    ...(current?.ssh?.current?.insertionTarget()||current?.local?snippets.map(snippet=>({id:`snippet-${snippet.id}`,label:translate('common:insertSnippet', { value1: snippet.name }),detail:snippet.group,kind:'command' as const,run:()=>{const target=current?.local?current.id:current?.ssh?.current?.insertionTarget();if(target&&current)setSnippetInsert({snippet,workspace:current.id,terminal:target});}})):[]),
  ];
  const menuCommand = useRef<(id:string)=>void>(()=>{});
  menuCommand.current = id => { if (appLock.locked.current || demoScene || dialog || rdpStart || restoreDialog || snippetInsert || attempt.trust || closing || quitConfirm || restarting || document.querySelector('[role=dialog]')) return; commands.find(command=>command.id===id)?.run(); };
  useEffect(()=>Events.On('app:menu-command',event=>menuCommand.current(event.data as string)),[]);
  const menuState = JSON.stringify(appLock.status?.locked || dialog || rdpStart || restoreDialog || workspaceSetLayout || snippetInsert || attempt.trust || closing || quitConfirm || restarting || palette ? {} : Object.fromEntries(commands.map(command=>[command.id,command.shortcut===translate('common:unassigned')?'':command.shortcut||''])));
  useEffect(()=>{if(!demoScene&&System.IsMac())void Events.Emit('app:menu-state',JSON.parse(menuState) as Record<string,string>).catch(error=>setPreferenceError(uiMessage('common:couldNotUpdateMenu', { value1: error })));},[menuState,demoScene]);
  return <>
    <div className="live-workbench" hidden={demoScene!==null}>
    <Workbench tabs={<WorkspaceTabs items={[...workspaces.map(workspace => ({ ...workspace, environment: preferences[workspace.connectionID]?.environment })), ...(commandTasksTab ? [{ id: commandTasksTabID, name: translate('common:multiHostOperations2'), tool: true }] : []), ...(logsTab ? [{ id: logsTabID, name: translate('common:multiSourceLogs2'), tool: true }] : [])]} active={active} onSelect={select} onClose={closeWorkspace} onSearch={() => { setPaletteScope('workspace'); setPalette(true); }} onNew={() => openDialog(false)} onMove={moveWorkspace} onRename={(id, name) => setWorkspaces(prev => prev.map(w => w.id === id ? { ...w, name } : w))} />} tools={tools} settings={settings}
      status={<><span>{catalog?.session_only ? translate('common:sessionStorage') : translate('common:localWorkbench')}</span><span>{translate('common:workspaceCount', { count: workspaces.length })}</span><div className="status-spacer" />{errorMessage(eventError(recovery))&&<button className="error" onClick={()=>{setSettingsSection('recovery');setSettings(true);}}>{translate('common:couldNotSaveLocalDrafts')}</button>}{portableError&&<button className="error" onClick={()=>setDismissedPortable(0)}>{translate('common:interfaceSettingsNotSaved')}</button>}{(errorMessage(eventError(automaticBackup))||errorMessage(eventError(automaticBackup.status)))&&<button className="error" onClick={()=>{setSettingsSection('backup');setSettings(true);}}>{translate('common:backupFailed')}</button>}
        <button className={errorMessage(eventError(commandRuns)) ? 'error' : ''} aria-expanded={commandTasksOpen} onClick={() => openCommandTasks('history')}><Icon name="list" width="14" />{commandRuns.waiting ? translate('common:tasksAwaitingConfirmation', { value1: commandRuns.waiting }) : commandRuns.active ? translate('common:tasksRunning', { value1: commandRuns.active }) : translate('common:taskHistory')}{errorMessage(eventError(commandRuns)) ? translate('common:readFailed') : ''}</button>
        <Tooltip content={transfers.summary}><button className={transfers.failed || errorMessage(eventError(transfers)) ? 'error' : ''} aria-expanded={transfersOpen} onClick={() => setTransfersOpen(!transfersOpen)}><Icon name="transfer" width="14" />{transfers.running ? translate('common:transfersActive', { value1: transfers.running }) : transfers.waiting ? translate('common:transfers') : transfers.items.length ? translate('common:transfersFinished') : translate('common:transfers')}{transfers.running > 0 && <span aria-hidden="true"> · {bytes(transfers.speed)}/s</span>}{transfers.waiting ? translate('common:waiting', { value1: transfers.waiting }) : !transfers.running && transfers.items.length ? ` · ${transfers.summary}` : ''}{transfers.running > 0 && transfers.failed ? translate('common:failed', { value1: transfers.failed }) : ''}{errorMessage(eventError(transfers)) ? translate('common:loadFailed') : ''}</button></Tooltip></>}>
      {storageError && !catalog && <Suspense fallback={<div role="status">{translate('common:readingStorageProtection')}</div>}><StorageAccess error={storageError} onOpened={async () => { await reload(); await recovery.refresh(); }} /></Suspense>}
      {storageError && catalog && <ErrorNotice message={storageError} />}
      {!dialog && (attempt.busy || (errorMessage(eventError(attempt)) && !current?.rdp)) && <div className="connection-feedback" role={errorMessage(eventError(attempt)) ? 'alert' : 'status'}><span className={errorMessage(eventError(attempt)) ? 'error' : ''}>{attempt.target} · {errorMessage(eventError(attempt)) || statusLabel(attempt.steps[attempt.steps.length - 1]?.stage_code, attempt.steps[attempt.steps.length - 1]?.stage) || translate('common:connecting2')}</span><div className="button-row">{!!attempt.steps.length && <Button size="sm" variant="light" onPress={() => setConnectionDiagnosticsOpen(true)}>{translate('common:connectionDiagnostics')}</Button>}{attempt.busy && <Button size="sm" variant="light" onPress={attempt.cancel}>{translate('common:cancelConnection')}</Button>}{!attempt.busy && <button className="icon-button" aria-label={translate('common:dismissConnectionError')} onClick={attempt.clearError}><Icon name="close" /></button>}</div></div>}
      {settings && <Suspense fallback={<div className="view-loading" role="status">{translate('common:loadingSettings')}</div>}><SettingsView section={settingsSection} onSectionChange={setSettingsSection} recovery={recovery} fontSize={fontSize} onFontSize={setFontSize} onRestore={() => void reload()} onClose={() => setSettings(false)} shortcuts={shortcuts} onShortcuts={saveShortcuts} shortcutError={shortcutError} automaticBackup={automaticBackup} updates={updates} onRestart={workbenchClose.restart} activeWorkspaces={workspaces.length} activeTransfers={transfers.items.filter(item => ['queued','running'].includes(item.state)).length} onDemo={()=>showDemo()} demoDisabled={attempt.busy||openingLocal} connections={catalog?.connections || []} onEditConnection={id => { const connection = catalog?.connections.find(item => item.id === id); if (connection) openDialog(false, connection); }} /></Suspense>}
      <ErrorNotice message={preferenceError} onDismiss={()=>setPreferenceError('')} className="connection-feedback"/>
      <ErrorNotice message={errorMessage(eventError(appLock))} className="connection-feedback" />
      <ErrorNotice message={preferenceLoadError} className="connection-feedback"><button className="session-tool" onClick={()=>void reload()}>{translate('common:reloadConnectionPreferences')}</button></ErrorNotice>
      {portableError && portableFailure!==dismissedPortable && <ErrorNotice message={translate('common:interfaceSettingsNotSaved2', { value1: portableError })} onDismiss={()=>setDismissedPortable(portableFailure)} className="connection-feedback"><button className="session-tool" onClick={()=>void savePortable()}>{translate('common:retrySaving')}</button></ErrorNotice>}
      {automaticBackup.bannerVisible && !settings && <ErrorNotice message={translate('common:backupFailed')} onDismiss={automaticBackup.dismiss} className="connection-feedback"><button className="session-tool" onClick={() => { setSettingsSection('backup'); setSettings(true); }}>{translate('common:viewDetails')}</button></ErrorNotice>}
      <div className="connection-center-page" hidden={settings || active !== ''}><ConnectionCenter connections={catalog?.connections || []} groups={catalog?.groups || []} preferences={preferences} sessions={connectionSessions} onOpen={openSaved} onEdit={c => openDialog(false, c)} onNew={openDialog} onReload={() => void reload()} onPlaybook={setPlaybookConnection} onMultiHost={openConnectionTasks} busy={attempt.busy||openingLocal} loading={catalogLoading} loadError={storageError} systemRDP={systemRDP} shells={localShells} onLocal={kind=>{void openLocalShell(kind);}} active={!demoScene && !settings && active === ''} /></div>
      {commandTasksCreated && <div className="workspace" hidden={!commandTasksOpen}><Suspense fallback={commandTasksOpen ? <div className="view-loading" role="status">{translate('common:loadingMultiHostOperations')}</div> : null}><CommandTasksWorkspace request={commandTasksRequest} open={commandTasksOpen} runs={commandRuns.items} historyError={errorMessage(eventError(commandRuns))} onRefresh={commandRuns.refresh} onRun={commandRuns.update} groups={catalog?.groups} targets={taskTargets} snippets={snippets} snippetError={snippetError} onConnectTargets={connectTaskTargets} onNewConnection={() => openDialog(false)} /></Suspense></div>}
      {logsTab && <div className="workspace" hidden={!logsOpen}><Suspense fallback={logsOpen ? <div className="view-loading" role="status">{translate('common:loadingLogWorkspace')}</div> : null}><LogWorkspace open={logsOpen} initial={logsInitial} targets={workspaces.filter(workspace => workspace.ssh && workspace.sessionID && workspace.state === 'connected').map(workspace => ({ id: workspace.sessionID!, name: workspace.name, address: `${workspace.connection?.username}@${workspace.connection?.host}:${workspace.connection?.port}` }))} /></Suspense></div>}
      {workspaces.map(w => <div className="workspace" hidden={settings || active !== w.id} key={w.id}><Suspense fallback={<div className="view-loading" role="status">{translate('common:loadingWorkspace')}</div>}>{w.rdp ? <RDPView target={`${w.rdp.connection.username}@${w.rdp.connection.host}:${w.rdp.connection.port}`} environment={preferences[w.connectionID]?.environment || ''} grant={w.rdp.grant} failure={errorMessage(eventError(w.rdp))} busy={attempt.busy} pending={attempt.busy&&attempt.workspaceID===w.id} options={w.rdp.options} onResolution={value=>saveRDPResolution(w.connectionID,value)} onRetry={() => retryRDP(w)} onEdit={() => editRDP(w)} ref={w.view} visible={!demoScene && !settings && active === w.id} onState={state => workspaceState(w.id, state)} /> : w.local && w.sessionID ? <div className="local-workspace"><TerminalView local id={w.sessionID} workspace={w.sessionID} ref={w.local.terminal} visible={!demoScene&&!settings&&active===w.id} fontSize={fontSize} onAttention={value => workspaceAttention(w.id, value)} onActivate={() => select(w.id)} onSnippets={()=>{setPaletteScope('command');setPaletteQuery(translate('common:insertSnippet2'));setPalette(true);}} onConnectionChange={()=>workspaceState(w.id,w.local?.terminal.current?.ended()?'exited':'running')}/></div> : w.sessionID ?
        <SSHWorkspace onSnippets={()=>{setPaletteScope('command');setPaletteQuery(translate('common:insertSnippet2'));setPalette(true);}} id={w.id} sessionID={w.sessionID} initialLayout={w.restore} connectionID={w.connectionID} target={`${w.connection?.username}@${w.connection?.host}:${w.connection?.port}`} environment={preferences[w.connectionID]?.environment || ''} state={w.state || 'connecting'} shortcuts={shortcuts} ref={w.ssh} fontSize={fontSize} busy={attempt.busy} onAttention={value => workspaceAttention(w.id, value)} onActivate={() => select(w.id)} onStateChange={()=>notifyLocalState()} onReconnect={()=>reconnectSSH(w)} onAutomaticReconnect={() => automaticReconnectSSH(w)} automaticReconnect={canAutomaticallyReconnectSSH(w)} onCancelReconnect={() => attempt.cancelWorkspace(w.id)} visible={!demoScene && !settings && active === w.id} onDirtyChange={dirty => setWorkspaces(prev => prev.map(item => item.id === w.id ? { ...item, dirty } : item))} onState={state => workspaceState(w.id, state)} /> :
        <div className="restored-workspace"><h2>{translate('common:notYetConnected')}</h2><p>{w.connection?.username}@{w.connection?.host}:{w.connection?.port}</p><div className="button-row"><Button size="sm" color="primary" isDisabled={attempt.busy} onPress={()=>reconnectSSH(w)}>{translate('common:connect')}</Button><Button size="sm" variant="light" isDisabled={attempt.busy} onPress={()=>{if(w.connection)setDialog({connection:{...w.connection,id:'',credential_id:''},temporary:true,workspaceID:w.id});}}>{translate('common:reenterConnection')}</Button></div><ul>{(w.restore?.tabs||[]).filter(t=>t.kind==='file').map(t=><li className="file-path" key={t.path}>{t.path}</li>)}</ul></div>}
      </Suspense></div>)}
      <Suspense fallback={<div role="status">{translate('common:loadingTransfers')}</div>}><AnimatePresence initial={false}>{transfersOpen && <TransferPanel tasks={transfers} reveal={transferReveal} height={transferHeight} onHeight={setTransferHeight} onClose={() => setTransfersOpen(false)} onLocate={(workspace, directory) => { const target = workspaces.find(item => item.sessionID === workspace); if (target) { select(target.id); target.ssh?.current?.locateDirectory(directory); } }} workspaces={workspaces.filter(workspace=>workspace.sessionID&&workspace.state==='connected').map(workspace=>({id:workspace.sessionID!,name:workspace.name,target:`${workspace.connection?.username}@${workspace.connection?.host?.includes(':')?'['+workspace.connection.host+']':workspace.connection?.host}:${workspace.connection?.port}`}))} />}</AnimatePresence></Suspense>
    </Workbench>
    <UploadDialog workspaces={workspaces.filter(workspace => workspace.sessionID && workspace.state === 'connected').map(workspace => workspace.sessionID!)} onSubmitted={items => { transfers.accept(items); setTransferReveal(items[0].id); setTransfersOpen(true); }} />
    {!demoScene&&<>
    {playbookConnection && <Suspense fallback={<p role="status">{translate('common:loadingPlaybook')}</p>}><ConnectionPlaybookDialog connection={playbookConnection} onOpen={openPlaybookResource} onClose={() => setPlaybookConnection(undefined)} /></Suspense>}
    {dialog && <Suspense fallback={<div role="status">{translate('common:loadingConnectionForm')}</div>}><ConnectionDialog {...dialog} systemRDP={systemRDP} gateways={rdpGateways} preference={preferences[dialog.connection?.id || '']} groups={catalog?.groups || []} connections={catalog?.connections||[]} busy={attempt.busy} connectionError={errorMessage(eventError(attempt))} connectionSteps={attempt.busy || errorMessage(eventError(attempt)) ? attempt.steps : []} onConnect={(connection, auth, options) => connect(connection, auth, dialog.workspaceID, options)} onSaved={() => void reload()} onClose={() => { setDialog(undefined); attempt.clearError(); }} onCancel={attempt.cancel} /></Suspense>}
    <Modal isOpen={connectionDiagnosticsOpen} onClose={() => setConnectionDiagnosticsOpen(false)} size="2xl" className="app-dialog" scrollBehavior="inside"><ModalContent><ModalHeader>{translate('common:sSHConnectionDiagnostics')}{attempt.target}</ModalHeader><ModalBody><ConnectionDiagnostics steps={attempt.steps} workspace={attempt.connectedWorkspace} busy={attempt.busy} /></ModalBody><ModalFooter><Button variant="light" onPress={() => setConnectionDiagnosticsOpen(false)}>{translate('common:close')}</Button></ModalFooter></ModalContent></Modal>
    <Modal isOpen={!!rdpStart} onClose={()=>setRDPStart(undefined)} className="app-dialog"><ModalContent><ModalHeader>{translate('common:connectToRemoteDesktop')}</ModalHeader><ModalBody>{rdpStart && <><p>{rdpStart.connection.name}</p><label className="form-field">{translate('common:client')}<SelectControl value={rdpStart.options.client || 'internal'} onChange={e=>setRDPStart({...rdpStart,options:{...rdpStart.options,client:e.target.value,gateway:e.target.value==='system'?'':rdpStart.options.gateway,resolution:e.target.value!=='system'&&rdpStart.options.resolution==='multimon'?'dynamic':rdpStart.options.resolution}})}><option value="internal">{translate('common:builtInClient')}</option><option value="system" disabled={!systemRDP}>{translate('common:systemClientMstsc')}</option></SelectControl></label>{rdpStart.options.client!=='system'&&<label className="form-field">{translate('common:connectionRoute')}<SelectControl value={rdpStart.options.gateway||''} onChange={event=>setRDPStart({...rdpStart,options:{...rdpStart.options,gateway:event.target.value}})}><option value="">{translate('common:direct')}</option>{rdpGateways.map(gateway=><option key={gateway.id} value={gateway.id}>{translate('common:viaSSH')}{gateway.name}</option>)}</SelectControl></label>}<label className="checkbox-label"><input type="checkbox" checked={rdpStart.options.clipboard} onChange={e=>setRDPStart({...rdpStart,options:{...rdpStart.options,clipboard:e.target.checked}})} />{translate('common:textClipboard')}</label><label className="form-field">{translate('common:remoteResolution')}<SelectControl value={rdpStart.options.resolution} onChange={e=>setRDPStart({...rdpStart,options:{...rdpStart.options,resolution:e.target.value}})}><option value="dynamic">{translate('common:fitWindow')}</option><option value="1280x800">1280 × 800</option><option value="1920x1080">1920 × 1080</option>{rdpStart.options.client==='system'&&<option value="multimon">{translate('common:allMonitors')}</option>}</SelectControl></label></>}</ModalBody><ModalFooter><Button variant="light" onPress={()=>setRDPStart(undefined)}>{translate('common:cancel')}</Button><Button color="primary" onPress={async()=>{if(!rdpStart)return;const launch=rdpStart;setRDPStart(undefined);try{await saveRDPResolution(launch.connection.id,launch.options.resolution);await SetRDPClient(launch.connection.id, launch.options.client || 'internal');setPreferences(prev=>({...prev,[launch.connection.id]:{...prev[launch.connection.id]!,rdp_client:launch.options.client || 'internal'}}));await attempt.start(launch.connection,undefined,undefined,launch.options);}catch(e){setPreferenceError(e);}}}>{translate('common:connect')}</Button></ModalFooter></ModalContent></Modal>
    <HostTrustDialog target={attempt.trust} onConfirm={attempt.confirm} />
    {servicesOpen && <Suspense fallback={<div role="status">{translate('common:loadingRemoteServices')}</div>}><ServicesDialog entries={services} connections={catalog?.connections || []} initial={current?.connectionID} error={serviceError} onChanged={values => { setServices(values); setServiceError(''); }} onOpen={openService} onClose={() => setServicesOpen(false)} /></Suspense>}
    {attempt.challenge && <SSHChallengeDialog key={attempt.challenge.id} challenge={attempt.challenge} target={attempt.target} onAnswer={attempt.answer} onCancel={attempt.cancel} />}
    {recordingOpen && <Suspense fallback={<div role="status">{translate('common:loadingRecordingPlayback')}</div>}><RecordingPlayer onClose={() => setRecordingOpen(false)} /></Suspense>}
    {diagnosticSnapshotsOpen && <Suspense fallback={<p role="status">{translate('common:loadingDiagnosticSnapshots')}</p>}><DiagnosticSnapshotsDialog targets={workspaces.filter(workspace => workspace.ssh && workspace.sessionID && workspace.state === 'connected').map(workspace => ({ id: workspace.sessionID!, name: workspace.name }))} initial={current?.ssh ? current.sessionID : undefined} onClose={() => setDiagnosticSnapshotsOpen(false)} /></Suspense>}
    {fileCompareOpen && <Suspense fallback={<div role="status">{translate('common:loadingFileComparison')}</div>}><FileCompareDialog targets={workspaces.filter(w => !w.local && !w.rdp && w.sessionID && w.state === 'connected').map(w => ({ id: w.sessionID!, name: w.name }))} initial={current?.ssh ? current.sessionID : undefined} onTransfer={item => { transfers.accept([item]); setTransferReveal(item.id); setTransfersOpen(true); }} onClose={() => setFileCompareOpen(false)} /></Suspense>}
    {dockerOpen && <Suspense fallback={<div role="status">{translate('common:loadingDocker')}</div>}><DockerDialog targets={workspaces.filter(w => w.ssh && w.sessionID && w.state === 'connected').map(w => ({ id: w.sessionID!, name: w.name }))} initial={dockerResource?.workspace || (current?.ssh ? current.sessionID : undefined)} initialContainer={dockerResource?.container} fontSize={fontSize} onDirectory={(session, path) => { const target = workspaces.find(value => value.sessionID === session); if (target) { setActive(target.id); target.ssh?.current?.locateDirectory(path); setDockerOpen(false); setDockerResource(undefined); } }} onClose={() => { setDockerOpen(false); setDockerResource(undefined); }} /></Suspense>}
    {restoreDialog&&<WorkspaceRestoreDialog layout={restoreDialog} connections={catalog?.connections||[]} openIDs={workspaces.map(w=>w.id)} onRestore={restoreWorkspaces} onClose={()=>setRestoreDialog(undefined)}/>}
    {workspaceSetLayout && <Suspense fallback={<div className="session-status" role="status">{translate('common:loadingWorkingSets')}</div>}><WorkspaceSetsDialog layout={workspaceSetLayout} localCount={workspaces.filter(workspace => !!workspace.local).length} connections={catalog?.connections || []} onOpen={openWorkspaceSet} onClose={() => setWorkspaceSetLayout(undefined)} /></Suspense>}
    {palette && <CommandPalette commands={commands} initialScope={paletteScope} initialQuery={paletteQuery} onClose={() => { setPalette(false); setPaletteQuery(''); }} error={snippetError} />}
    {snippetInsert&&<SnippetInsertDialog snippet={snippetInsert.snippet} onClose={()=>setSnippetInsert(undefined)} onInsert={text=>active===snippetInsert.workspace&&(current?.local?!!current.local.terminal.current?.insert(text):!!current?.ssh?.current?.insert(text,snippetInsert.terminal))}/>}
    <WorkbenchCloseDialog close={workbenchClose} keepDrafts={recovery.enabled} />
    </>}
    </div>
    {demoScene&&<Suspense fallback={<div className="view-loading demo-loading" role="status">{translate('common:preparingDemo')}</div>}><DemoWorkbench key={`${demoScene}-${demoRevision}`} scene={demoScene} onScene={selectDemoScene} onExit={exitDemo} shortcuts={shortcuts} fontSize={fontSize} /></Suspense>}
    {appLock.status?.locked && <ApplicationLockScreen onUnlock={appLock.update} />}
  </>;
}
