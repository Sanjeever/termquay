import { createRef, useEffect, useRef, useState, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import { Events } from '@wailsio/runtime';
import { Button, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Tooltip } from '@heroui/react';
import { GetCatalog, UseSessionStorage, DiscardAndQuit } from '../bindings/github.com/Sanjeever/termquay/appservice';
import type { Connection, Group } from '../bindings/github.com/Sanjeever/termquay/internal/store/models';
import type { Grant } from '../bindings/github.com/Sanjeever/termquay/internal/rdp/models';
import SSHWorkspace, { type SSHWorkspaceHandle } from './features/files/SSHWorkspace';
import RDPView, { type RDPHandle } from './features/rdp/RDPView';
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

type Workspace = { id: string; connectionID: string; name: string; rdp?: { connection: Connection; grant?: Grant; error?: string }; view?: RefObject<RDPHandle>; ssh?: RefObject<SSHWorkspaceHandle>; dirty?: boolean };

export default function App() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [active, setActive] = useState('');
  const [catalog, setCatalog] = useState<{ groups: Group[]; connections: Connection[]; session_only: boolean }>();
  const [storageError, setStorageError] = useState('');
  const [dialog, setDialog] = useState<{ connection?: Connection; temporary: boolean; workspaceID?: string }>();
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
  const attempt = useConnectionAttempt((id, connection) => {
    setWorkspaces(prev => [...prev, { id, connectionID: connection.id, name: connection.name, ssh: createRef<SSHWorkspaceHandle>() }]); select(id);
  }, (connection, reuse) => {
    const id = reuse || crypto.randomUUID();
    flushSync(() => {
      setWorkspaces(prev => reuse ? prev.map(w => w.id === id ? { ...w, name: connection.name, connectionID: connection.id, rdp: { connection } } : w) : [...prev, { id, connectionID: connection.id, name: connection.name, rdp: { connection }, view: createRef<RDPHandle>() }]);
      select(id);
    });
    return id;
  }, async (id, grant, username, password, domain) => {
    flushSync(() => setWorkspaces(prev => prev.map(w => w.id === id ? { ...w, rdp: { connection: w.rdp!.connection, grant } } : w)));
    const view = latestWorkspaces.current.find(w => w.id === id)?.view?.current;
    if (!view) throw new Error('工作区已关闭');
    await view.connect(username, password, domain);
  }, (id, error) => setWorkspaces(prev => prev.map(w => w.id === id ? { ...w, rdp: { connection: w.rdp!.connection, error } } : w)), id => latestWorkspaces.current.find(w => w.id === id)?.view?.current?.cancel(), remove);

  async function reload() { try { const data = await GetCatalog(); setCatalog({ ...data, groups: data.groups ?? [], connections: data.connections ?? [] }); setStorageError(''); } catch (e) { setStorageError(String(e)); } }
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
    if (dialog || attempt.trust || closing || quitConfirm || palette || settings) return;
    if (tabNavigation.current) { tabNavigation.current = false; return; }
    const frame = requestAnimationFrame(() => { if (current?.rdp) current.view?.current?.focus(); else { const search = document.querySelector<HTMLElement>('.workspace:not([hidden]) .terminal-tab:not([hidden]) .terminal-search > input'); (search || document.querySelector<HTMLElement>('.workspace:not([hidden]) .terminal-tab:not([hidden]) .xterm-helper-textarea, .workspace:not([hidden]) .editor-tab:not([hidden]) .cm-content'))?.focus(); } });
    return () => cancelAnimationFrame(frame);
  }, [active, dialog, attempt.trust, closing, quitConfirm, palette, settings]);
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
  function openDialog(temporary: boolean, connection?: Connection) { if (attempt.busy) return; attempt.clearError(); setDialog({ temporary, connection }); }
  function openSaved(c: Connection, another = false) {
    const existing = !another && workspaces.find(w => w.connectionID === c.id);
    if (existing) { select(existing.id); return; }
    if (!attempt.busy) void attempt.start(c);
  }
  function editRDP(w: Workspace) {
    if (attempt.busy || !w.rdp) return;
    const saved = catalog?.connections.find(c => c.id === w.connectionID);
    attempt.clearError();
    setDialog({ connection: saved || { ...w.rdp.connection, id: '', credential_id: '' }, temporary: !saved, workspaceID: w.id });
  }
  function retryRDP(w: Workspace) {
    const saved = catalog?.connections.find(c => c.id === w.connectionID);
    if (saved) void attempt.start(saved, undefined, w.id); else editRDP(w);
  }
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
    <Workbench tabs={<WorkspaceTabs items={workspaces} active={active} onSelect={select} onClose={(id, keyboard) => { closingKeyboard.current = !!keyboard; if (workspaces.find(w => w.id === id)?.dirty) setClosing(id); else remove(id, keyboard); }} onNew={() => openDialog(false)} />} tools={tools} settings={settings}
      status={<><span>{catalog?.session_only ? '会话存储' : '本地工作台'}</span><span>{workspaces.length} 个工作区</span><div className="status-spacer" /><button className={transfers.failed || transfers.error ? 'error' : ''} aria-expanded={transfersOpen} onClick={() => setTransfersOpen(!transfersOpen)}><Icon name="transfer" width="14" />{transfers.running ? `传输 ${transfers.running} 进行中` : transfers.items.length ? `传输 ${transfers.items.length} 项` : '传输'}{transfers.failed ? ` · ${transfers.failed} 失败` : ''}{transfers.error ? ' · 加载失败' : ''}</button></>}>
      {storageError && <div className="storage-error error" role="alert">{storageError}<Button size="sm" onPress={() => { UseSessionStorage().then(reload).catch(e => setStorageError(String(e))); }}>使用会话存储</Button></div>}
      {!dialog && (attempt.busy || (attempt.error && !current?.rdp)) && <div className="connection-feedback" role={attempt.error ? 'alert' : 'status'}><span className={attempt.error ? 'error' : ''}>{attempt.target} · {attempt.error || '正在连接…'}</span>{attempt.busy && <Button size="sm" variant="light" onPress={attempt.cancel}>取消连接</Button>}{!attempt.busy && <button className="icon-button" aria-label="关闭连接错误" onClick={attempt.clearError}><Icon name="close" /></button>}</div>}
      {settings && <SettingsView fontSize={fontSize} onFontSize={setFontSize} onRestore={() => void reload()} onClose={() => setSettings(false)} shortcuts={shortcuts} onShortcuts={saveShortcuts} shortcutError={shortcutError} />}
      <div className="connection-center-page" hidden={settings || !!current}><ConnectionCenter connections={catalog?.connections || []} groups={catalog?.groups || []} onOpen={openSaved} onEdit={c => openDialog(false, c)} onNew={openDialog} onReload={() => void reload()} busy={attempt.busy} /></div>
      {workspaces.map(w => <div className="workspace" hidden={settings || active !== w.id} key={w.id}>{w.rdp ? <RDPView target={`${w.rdp.connection.username}@${w.rdp.connection.host}:${w.rdp.connection.port}`} grant={w.rdp.grant} failure={w.rdp.error} busy={attempt.busy} onRetry={() => retryRDP(w)} onEdit={() => editRDP(w)} ref={w.view} visible={!settings && active === w.id} /> : <SSHWorkspace id={w.id} ref={w.ssh} fontSize={fontSize} visible={!settings && active === w.id} onDirtyChange={dirty => setWorkspaces(prev => prev.map(item => item.id === w.id ? { ...item, dirty } : item))} />}</div>)}
      {transfersOpen && <TransferPanel tasks={transfers} height={transferHeight} onHeight={setTransferHeight} onClose={() => setTransfersOpen(false)} />}
    </Workbench>
    {dialog && <ConnectionDialog {...dialog} groups={catalog?.groups || []} busy={attempt.busy} connectionError={attempt.error} onConnect={(connection, auth) => attempt.start(connection, auth, dialog.workspaceID)} onSaved={() => void reload()} onClose={() => { setDialog(undefined); attempt.clearError(); }} onCancel={attempt.cancel} />}
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
