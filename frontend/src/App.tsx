import { createRef, useEffect, useRef, useState, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import { Events } from '@wailsio/runtime';
import { Button, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Tooltip } from '@heroui/react';
import { GetCatalog, GetConnectionPreferences, RecordConnectionSuccess, SetRDPResolution, UseSessionStorage, DiscardAndQuit } from '../bindings/github.com/Sanjeever/termquay/appservice';
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
import useConnectionAttempt from './features/connections/useConnectionAttempt';
import Icon from './components/Icon';
import CommandPalette, { type WorkbenchCommand } from './components/CommandPalette';
import { defaultShortcuts, eventShortcut, shortcutConflict, shortcutDefinitions, shortcutLabel, shortcutStorageKey, type Shortcuts } from './lib/shortcuts';

type Workspace = { id: string; sessionID?: string; connection?: Connection; connectionID: string; name: string; state?: string; rdp?: { connection: Connection; grant?: Grant; error?: string; options: RDPOptions }; view?: RefObject<RDPHandle>; ssh?: RefObject<SSHWorkspaceHandle>; dirty?: boolean };

export default function App() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [active, setActive] = useState('');
  const [catalog, setCatalog] = useState<{ groups: Group[]; connections: Connection[]; session_only: boolean }>();
  const [storageError, setStorageError] = useState('');
  const [preferences, setPreferences] = useState<Record<string, ConnectionPreference | undefined>>({});
  const [preferenceError, setPreferenceError] = useState('');
  const [dialog, setDialog] = useState<{ connection?: Connection; temporary: boolean; workspaceID?: string; rdpOptions?: RDPOptions }>();
  const [rdpStart, setRDPStart] = useState<{connection:Connection;options:RDPOptions}>();
  const [settings, setSettings] = useState(false);
  const [closing, setClosing] = useState('');
  const [quitConfirm, setQuitConfirm] = useState(false);
  const [savingClose, setSavingClose] = useState(false);
  const [closeError, setCloseError] = useState('');
  const [transfersOpen, setTransfersOpen] = useState(false);
  const [transferHeight, setTransferHeight] = useState(Number(localStorage.getItem('termquay.layout.transfer-height')) || 220);
  const transfers = useTransfers();
  const [fontSize, setFontSize] = useState(Math.max(11, Math.min(24, Number(localStorage.getItem('termquay.terminal.font-size')) || 14)));
  const [palette, setPalette] = useState(false);
  const [shortcuts, setShortcuts] = useState<Shortcuts>({ ...defaultShortcuts });
  const [shortcutError, setShortcutError] = useState('');
  const current = workspaces.find(w => w.id === active);
  const latestWorkspaces = useRef(workspaces); latestWorkspaces.current = workspaces;
  const tabNavigation = useRef(false);
  const closingKeyboard = useRef(false);

  function remove(id: string, keyboard = false) {
    attempt.cancelWorkspace(id);
    latestWorkspaces.current.find(w => w.id === id)?.view?.current?.cancel();
    setWorkspaces(prev => prev.filter(w => w.id !== id));
    setActive(prev => prev === id ? latestWorkspaces.current.find(w => w.id !== id)?.id || '' : prev);
    if (keyboard) { tabNavigation.current = true; requestAnimationFrame(() => document.querySelector<HTMLElement>('.workspace-tabs [role=tab][aria-selected=true]')?.focus()); }
  }
  function select(id: string, keyboard = false) { tabNavigation.current = keyboard; setActive(id); setSettings(false); }
  function moveWorkspace(id: string, target: string) {
    setWorkspaces(prev => { const from = prev.findIndex(w => w.id === id); const to = prev.findIndex(w => w.id === target); if (from < 0 || to < 0 || from === to) return prev; const next = [...prev]; next.splice(to, 0, next.splice(from, 1)[0]); return next; });
  }
  function workspaceState(id: string, state: string) { setWorkspaces(prev => prev.map(w => w.id === id && w.state !== state ? { ...w, state } : w)); }
  async function recordSuccess(id: string) { if (!id) return; try { await RecordConnectionSuccess(id); setPreferences(await GetConnectionPreferences() || {}); } catch (e) { setPreferenceError(`记录最近连接失败：${String(e)}`); } }
  async function saveRDPResolution(id: string, value: string) { if (!id) return; await SetRDPResolution(id,value); setPreferences(await GetConnectionPreferences() || {}); }
  const attempt = useConnectionAttempt((id, connection, reuse) => {
    if(reuse&&!latestWorkspaces.current.some(w=>w.id===reuse))throw new Error('工作区已关闭');
    if(!reuse&&latestWorkspaces.current.length>=16)throw new Error('打开工作区达到上限（16 个）');
    setWorkspaces(prev => reuse?prev.map(w=>w.id===reuse?{...w,sessionID:id,connection,connectionID:connection.id}:w):[...prev, { id, sessionID:id, connection, connectionID: connection.id, name: connection.name, ssh: createRef<SSHWorkspaceHandle>() }]); select(reuse||id);
    void recordSuccess(connection.id);
  }, (connection, reuse, options = {clipboard:false,resolution:preferences[connection.id]?.rdp_resolution || 'dynamic'}) => {
    if(!reuse&&latestWorkspaces.current.length>=16)throw new Error('打开工作区达到上限（16 个）');
    const id = reuse || crypto.randomUUID();
    flushSync(() => {
      setWorkspaces(prev => reuse ? prev.map(w => w.id === id ? { ...w, connectionID: connection.id, rdp: { connection, options } } : w) : [...prev, { id, connectionID: connection.id, name: connection.name, rdp: { connection, options }, view: createRef<RDPHandle>() }]);
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

  async function reload() { try { const data = await GetCatalog(); setCatalog({ ...data, groups: data.groups ?? [], connections: data.connections ?? [] }); setStorageError(''); try { setPreferences(await GetConnectionPreferences() || {}); setPreferenceError(''); } catch (e) { setPreferenceError(String(e)); } } catch (e) { setStorageError(String(e)); } }
  useEffect(() => { void reload(); }, []);
  useEffect(() => {
    try {
      const stored = localStorage.getItem(shortcutStorageKey); if (!stored) return;
      const values = { ...defaultShortcuts, ...JSON.parse(stored) } as Shortcuts;
      for (const d of shortcutDefinitions) { if (typeof values[d.id] !== 'string' || shortcutConflict(d.id, values[d.id], values)) throw new Error('快捷键配置无效，请在设置中复位'); }
      setShortcuts(values);
    } catch (e) { setShortcutError(String(e)); }
  }, []);
  function saveShortcuts(values: Shortcuts) { try { localStorage.setItem(shortcutStorageKey, JSON.stringify(values)); setShortcuts(values); setShortcutError(''); } catch (e) { setShortcutError(String(e)); } }
  useEffect(() => Events.On('app:close-requested', () => setQuitConfirm(true)), []);
  useEffect(() => { localStorage.setItem('termquay.layout.transfer-height', String(transferHeight)); }, [transferHeight]);
  useEffect(() => { localStorage.setItem('termquay.terminal.font-size', String(fontSize)); }, [fontSize]);
  useEffect(() => {
    if (dialog || rdpStart || attempt.trust || closing || quitConfirm || palette || settings) return;
    if (tabNavigation.current) { tabNavigation.current = false; return; }
    const frame = requestAnimationFrame(() => { if (current?.rdp) current.view?.current?.focus(); else current?.ssh?.current?.focus(); });
    return () => cancelAnimationFrame(frame);
  }, [active, dialog, rdpStart, attempt.trust, closing, quitConfirm, palette, settings]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.isComposing || event.repeat || dialog || attempt.trust || closing || quitConfirm) return;
      const path = event.composedPath();
      if (path.some(target => target instanceof HTMLElement && target.matches('[role=dialog], .shortcut-recorder'))) return;
      const key = eventShortcut(event); if (!key) return;
      const terminal = !settings && !!current?.ssh && path.some(target => target instanceof HTMLElement && target.matches('.xterm'));
      const action = shortcutDefinitions.find(d => shortcuts[d.id] === key && (d.scope === 'app' || terminal));
      if (!action) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (action.id === 'palette') setPalette(prev => !prev);
      else if (action.id === 'settings') setSettings(true);
      else current?.ssh?.current?.terminalAction(action.id);
    };
    window.addEventListener('keydown', key, true); return () => window.removeEventListener('keydown', key, true);
  }, [dialog, attempt.trust, closing, quitConfirm, shortcuts, settings, current]);
  function openDialog(temporary: boolean, connection?: Connection) { if (attempt.busy) return; attempt.clearError(); setDialog({ temporary, connection, rdpOptions:{clipboard:false,resolution:preferences[connection?.id || '']?.rdp_resolution || 'dynamic'} }); }
  function openSaved(c: Connection, another = false) {
    const existing = !another && workspaces.find(w => w.connectionID === c.id);
    if (existing) { select(existing.id); return; }
    if (c.protocol === 'rdp' && !attempt.busy) { setRDPStart({connection:c,options:{clipboard:false,resolution:preferences[c.id]?.rdp_resolution || 'dynamic'}}); return; }
    if (!attempt.busy) void attempt.start(c);
  }
  function editRDP(w: Workspace) {
    if (attempt.busy || !w.rdp) return;
    const saved = catalog?.connections.find(c => c.id === w.connectionID);
    attempt.clearError();
    setDialog({ connection: saved || { ...w.rdp.connection, id: '', credential_id: '' }, temporary: !saved, workspaceID: w.id, rdpOptions:w.view?.current?.options() || w.rdp.options });
  }
  function retryRDP(w: Workspace) {
    const saved = catalog?.connections.find(c => c.id === w.connectionID);
    if (saved) void attempt.start(saved, undefined, w.id, w.view?.current?.options() || w.rdp?.options); else editRDP(w);
  }
  async function connect(connection:Connection, auth?:Parameters<typeof attempt.start>[1], reuse?:string, options?:RDPOptions){
    const workspace=reuse?latestWorkspaces.current.find(w=>w.id===reuse):undefined;
    if(reuse&&!workspace)return false;
    if(workspace?.ssh&&!await workspace.ssh.current?.prepareReconnect())return false;
    return attempt.start(connection,auth,reuse,options);
  }
  function reconnectSSH(w:Workspace){const saved=catalog?.connections.find(c=>c.id===w.connectionID);if(saved)void connect(saved,undefined,w.id);else if(w.connection)setDialog({connection:{...w.connection,id:'',credential_id:''},temporary:true,workspaceID:w.id});}
  const tools = <>
    <Tooltip content={`命令搜索 · ${shortcutLabel(shortcuts.palette)}`}><button className="icon-button" aria-label="命令搜索" onClick={() => setPalette(true)}><Icon name="search" /></button></Tooltip>
    <Tooltip content="设置"><button className="icon-button" aria-label="设置" aria-pressed={settings} onClick={() => setSettings(!settings)}><Icon name="settings" /></button></Tooltip>
  </>;
  const commands: WorkbenchCommand[] = [
    ...workspaces.map(w => ({ id: `workspace-${w.id}`, label: w.name, detail: w.rdp ? 'RDP' : 'SSH', kind: 'workspace' as const, run: () => select(w.id) })),
    ...(catalog?.connections || []).map(c => ({ id: `connection-${c.id}`, label: c.name, detail: `${c.protocol.toUpperCase()} · ${c.host}`, kind: 'connection' as const, run: () => openSaved(c) })),
    { id: 'new', label: '新建连接', kind: 'command', run: () => openDialog(false) },
    { id: 'quick', label: '快速连接', kind: 'command', run: () => openDialog(true) },
    { id: 'connections', label: '进入连接中心', kind: 'command', run: () => select('') },
    ...(current?.ssh ? [{ id: 'files', label: '显示远端文件', kind: 'command' as const, run: () => current.ssh?.current?.showFiles() }, { id: 'monitor', label: '切换监控面板', kind: 'command' as const, run: () => current.ssh?.current?.toggleMonitor() }, { id: 'focus', label: '切换专注模式', kind: 'command' as const, run: () => current.ssh?.current?.toggleFocus() }] : []),
    ...(current?.ssh ? shortcutDefinitions.filter(d => d.scope === 'terminal').map(d => ({ id: `terminal-${d.id}`, label: d.label, detail: shortcutLabel(shortcuts[d.id]), kind: 'command' as const, run: () => current.ssh?.current?.terminalAction(d.id) })) : []),
    { id: 'transfers', label: '查看传输任务', kind: 'command', run: () => setTransfersOpen(true) },
    { id: 'settings', label: '打开设置', kind: 'command', run: () => setSettings(true) },
  ];
  return <>
    <Workbench tabs={<WorkspaceTabs items={workspaces} active={active} onSelect={select} onClose={(id, keyboard) => { closingKeyboard.current = !!keyboard; if (workspaces.find(w => w.id === id)?.dirty) setClosing(id); else remove(id, keyboard); }} onNew={() => openDialog(false)} onMove={moveWorkspace} onRename={(id, name) => setWorkspaces(prev => prev.map(w => w.id === id ? { ...w, name } : w))} />} tools={tools} settings={settings}
      status={<><span>{catalog?.session_only ? '会话存储' : '本地工作台'}</span><span>{workspaces.length} 个工作区</span><div className="status-spacer" /><button className={transfers.failed || transfers.error ? 'error' : ''} aria-expanded={transfersOpen} onClick={() => setTransfersOpen(!transfersOpen)}><Icon name="transfer" width="14" />{transfers.running ? `传输 ${transfers.running} 进行中` : transfers.items.length ? `传输 ${transfers.items.length} 项` : '传输'}{transfers.failed ? ` · ${transfers.failed} 失败` : ''}{transfers.error ? ' · 加载失败' : ''}</button></>}>
      {storageError && <div className="storage-error error" role="alert">{storageError}<Button size="sm" onPress={() => { UseSessionStorage().then(reload).catch(e => setStorageError(String(e))); }}>使用会话存储</Button></div>}
      {!dialog && (attempt.busy || (attempt.error && !current?.rdp)) && <div className="connection-feedback" role={attempt.error ? 'alert' : 'status'}><span className={attempt.error ? 'error' : ''}>{attempt.target} · {attempt.error || '正在连接…'}</span>{attempt.busy && <Button size="sm" variant="light" onPress={attempt.cancel}>取消连接</Button>}{!attempt.busy && <button className="icon-button" aria-label="关闭连接错误" onClick={attempt.clearError}><Icon name="close" /></button>}</div>}
      {settings && <SettingsView fontSize={fontSize} onFontSize={setFontSize} onRestore={() => void reload()} onClose={() => setSettings(false)} shortcuts={shortcuts} onShortcuts={saveShortcuts} shortcutError={shortcutError} />}
      {preferenceError && <div role="alert" className="connection-feedback error">{preferenceError}</div>}
      <div className="connection-center-page" hidden={settings || !!current}><ConnectionCenter connections={catalog?.connections || []} groups={catalog?.groups || []} preferences={preferences} sessions={Object.fromEntries((catalog?.connections || []).map(c => [c.id, workspaces.filter(w => w.connectionID === c.id).map(w => w.state || '连接中')]))} onOpen={openSaved} onEdit={c => openDialog(false, c)} onNew={openDialog} onReload={() => void reload()} busy={attempt.busy} /></div>
      {workspaces.map(w => <div className="workspace" hidden={settings || active !== w.id} key={w.id}>{w.rdp ? <RDPView target={`${w.rdp.connection.username}@${w.rdp.connection.host}:${w.rdp.connection.port}`} grant={w.rdp.grant} failure={w.rdp.error} busy={attempt.busy} options={w.rdp.options} onResolution={value=>saveRDPResolution(w.connectionID,value)} onRetry={() => retryRDP(w)} onEdit={() => editRDP(w)} ref={w.view} visible={!settings && active === w.id} onState={state => workspaceState(w.id, state)} /> : <SSHWorkspace id={w.id} sessionID={w.sessionID!} connectionID={w.connectionID} ref={w.ssh} fontSize={fontSize} busy={attempt.busy} onReconnect={()=>reconnectSSH(w)} visible={!settings && active === w.id} onDirtyChange={dirty => setWorkspaces(prev => prev.map(item => item.id === w.id ? { ...item, dirty } : item))} onState={state => workspaceState(w.id, state)} />}</div>)}
      {transfersOpen && <TransferPanel tasks={transfers} height={transferHeight} onHeight={setTransferHeight} onClose={() => setTransfersOpen(false)} />}
    </Workbench>
    {dialog && <ConnectionDialog {...dialog} groups={catalog?.groups || []} busy={attempt.busy} connectionError={attempt.error} onConnect={(connection, auth, options) => connect(connection, auth, dialog.workspaceID, options)} onSaved={() => void reload()} onClose={() => { setDialog(undefined); attempt.clearError(); }} onCancel={attempt.cancel} />}
    <Modal isOpen={!!rdpStart} onClose={()=>setRDPStart(undefined)} className="app-dialog"><ModalContent><ModalHeader>连接远程桌面</ModalHeader><ModalBody>{rdpStart && <><p>{rdpStart.connection.name}</p><label className="checkbox-label"><input type="checkbox" checked={rdpStart.options.clipboard} onChange={e=>setRDPStart({...rdpStart,options:{...rdpStart.options,clipboard:e.target.checked}})} />文本剪贴板</label><label className="form-field">远端分辨率<select value={rdpStart.options.resolution} onChange={e=>setRDPStart({...rdpStart,options:{...rdpStart.options,resolution:e.target.value}})}><option value="dynamic">适应窗口</option><option value="1280x800">1280 × 800</option><option value="1920x1080">1920 × 1080</option></select></label></>}</ModalBody><ModalFooter><Button variant="light" onPress={()=>setRDPStart(undefined)}>取消</Button><Button color="primary" onPress={async()=>{if(!rdpStart)return;const launch=rdpStart;setRDPStart(undefined);try{await saveRDPResolution(launch.connection.id,launch.options.resolution);await attempt.start(launch.connection,undefined,undefined,launch.options);}catch(e){setPreferenceError(String(e));}}}>连接</Button></ModalFooter></ModalContent></Modal>
    <HostTrustDialog target={attempt.trust} onConfirm={attempt.confirm} />
    {palette && <CommandPalette commands={commands} onClose={() => setPalette(false)} />}
    <Modal isOpen={!!closing || quitConfirm} onClose={() => { if (!savingClose) { setClosing(''); setQuitConfirm(false); setCloseError(''); } }} isDismissable={!savingClose} isKeyboardDismissDisabled={savingClose} className="app-dialog"><ModalContent><ModalHeader>未保存文件</ModalHeader><ModalBody><p>{quitConfirm ? '应用中有未保存修改。' : '此工作区有未保存修改。'}</p>{closeError && <p className="error" role="alert">{closeError}</p>}</ModalBody><ModalFooter><Button variant="light" isDisabled={savingClose} onPress={() => { setClosing(''); setQuitConfirm(false); setCloseError(''); }}>返回编辑</Button><Button color="danger" variant="light" isDisabled={savingClose} onPress={() => { if (quitConfirm) void DiscardAndQuit(); else remove(closing, closingKeyboard.current); setClosing(''); }}>放弃修改并{quitConfirm ? '退出' : '关闭'}</Button><Button color="primary" isLoading={savingClose} onPress={async () => {
      setSavingClose(true); setCloseError('');
      try {
        const targets = quitConfirm ? workspaces.filter(w => w.dirty) : workspaces.filter(w => w.id === closing);
        for (const w of targets) { if (!await w.ssh?.current?.saveAll()) { select(w.id); setCloseError('保存未完成，请返回编辑处理文件错误。'); return; } }
        if (quitConfirm) await DiscardAndQuit(); else { remove(closing, closingKeyboard.current); setClosing(''); }
      } catch (e) { setCloseError(String(e)); } finally { setSavingClose(false); }
    }}>保存并{quitConfirm ? '退出' : '关闭'}</Button></ModalFooter></ModalContent></Modal>
  </>;
}
