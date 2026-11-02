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
import Workbench, { type SidebarMode } from './components/layout/Workbench';
import WorkspaceTabs from './components/layout/WorkspaceTabs';
import ConnectionSidebar from './features/connections/ConnectionSidebar';
import ConnectionDialog from './features/connections/ConnectionDialog';
import HostTrustDialog from './features/connections/HostTrustDialog';
import useConnectionAttempt from './features/connections/useConnectionAttempt';
import Icon from './components/Icon';
import CommandPalette, { type WorkbenchCommand } from './components/CommandPalette';

type Workspace = { id: string; connectionID: string; name: string; rdp?: Grant; view?: RefObject<RDPHandle>; ssh?: RefObject<SSHWorkspaceHandle>; dirty?: boolean };

export default function App() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [active, setActive] = useState('');
  const [catalog, setCatalog] = useState<{ groups: Group[]; connections: Connection[]; session_only: boolean }>();
  const [storageError, setStorageError] = useState('');
  const [dialog, setDialog] = useState<{ connection?: Connection; temporary: boolean }>();
  const [sidebar, setSidebar] = useState<SidebarMode>(localStorage.getItem('termquay.layout.sidebar') === 'closed' ? null : 'connections');
  const [sidebarWidth, setSidebarWidth] = useState(Number(localStorage.getItem('termquay.layout.sidebar-width')) || 248);
  const [sidebarHost, setSidebarHost] = useState<HTMLDivElement | null>(null);
  const [settings, setSettings] = useState(false);
  const [focus, setFocus] = useState(false);
  const [closing, setClosing] = useState('');
  const [quitConfirm, setQuitConfirm] = useState(false);
  const [savingClose, setSavingClose] = useState(false);
  const [closeError, setCloseError] = useState('');
  const [transfersOpen, setTransfersOpen] = useState(false);
  const [transferHeight, setTransferHeight] = useState(Number(localStorage.getItem('termquay.layout.transfer-height')) || 220);
  const transfers = useTransfers();
  const [monitorOpen, setMonitorOpen] = useState(localStorage.getItem('termquay.layout.monitor') === 'true');
  const [fontSize, setFontSize] = useState(Math.max(11, Math.min(24, Number(localStorage.getItem('termquay.terminal.font-size')) || 14)));
  const [palette, setPalette] = useState(false);
  const [narrow, setNarrow] = useState(window.innerWidth <= 1100);
  const current = workspaces.find(w => w.id === active);
  const latestWorkspaces = useRef(workspaces); latestWorkspaces.current = workspaces;
  const tabNavigation = useRef(false);

  function remove(id: string) {
    setWorkspaces(prev => prev.filter(w => w.id !== id));
    setActive(prev => prev === id ? latestWorkspaces.current.find(w => w.id !== id)?.id || '' : prev);
  }
  function select(id: string, keyboard = false) { tabNavigation.current = keyboard; setActive(id); setSettings(false); }
  const attempt = useConnectionAttempt((id, connection) => {
    setWorkspaces(prev => [...prev, { id, connectionID: connection.id, name: connection.name, ssh: createRef<SSHWorkspaceHandle>() }]); select(id);
  }, async (grant, connection, username, password, domain) => {
    const view = createRef<RDPHandle>();
    flushSync(() => { setWorkspaces(prev => [...prev, { id: grant.id, connectionID: connection.id, name: connection.name, rdp: grant, view }]); select(grant.id); });
    await view.current!.connect(username, password, domain);
  }, remove);

  async function reload() { try { const data = await GetCatalog(); setCatalog({ ...data, groups: data.groups ?? [], connections: data.connections ?? [] }); setStorageError(''); } catch (e) { setStorageError(String(e)); } }
  useEffect(() => { void reload(); }, []);
  useEffect(() => Events.On('app:close-requested', () => setQuitConfirm(true)), []);
  useEffect(() => { localStorage.setItem('termquay.layout.sidebar-width', String(sidebarWidth)); }, [sidebarWidth]);
  useEffect(() => { localStorage.setItem('termquay.layout.monitor', String(monitorOpen)); }, [monitorOpen]);
  useEffect(() => { localStorage.setItem('termquay.layout.transfer-height', String(transferHeight)); }, [transferHeight]);
  useEffect(() => { localStorage.setItem('termquay.terminal.font-size', String(fontSize)); }, [fontSize]);
  useEffect(() => { const media = window.matchMedia('(max-width: 1100px)'); const update = () => setNarrow(media.matches); media.addEventListener('change', update); return () => media.removeEventListener('change', update); }, []);
  useEffect(() => { if (narrow && active) setSidebar(null); }, [narrow, active]);
  useEffect(() => { if ((!current || current.rdp) && sidebar === 'files') setSidebar('connections'); }, [current?.id, sidebar]);
  useEffect(() => {
    if (dialog || attempt.trust || closing || quitConfirm || palette || settings) return;
    if (tabNavigation.current) { tabNavigation.current = false; return; }
    const frame = requestAnimationFrame(() => document.querySelector<HTMLElement>('.workspace:not([hidden]) .terminal-tab:not([hidden]) .xterm-helper-textarea, .workspace:not([hidden]) .editor-tab:not([hidden]) .cm-content, .workspace:not([hidden]) .rdp-canvas iron-remote-desktop')?.focus());
    return () => cancelAnimationFrame(frame);
  }, [active, dialog, attempt.trust, closing, quitConfirm, palette, settings]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || !event.shiftKey || event.key.toLowerCase() !== 'p' || dialog || attempt.trust || closing || quitConfirm) return;
      if (event.composedPath().some(target => target instanceof HTMLElement && target.matches('.terminal-view, .rdp-view, .code-editor'))) return;
      event.preventDefault(); setPalette(prev => !prev);
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [dialog, attempt.trust, closing, quitConfirm]);
  function changeSidebar(mode: SidebarMode) { setSettings(false); setFocus(false); setSidebar(mode); localStorage.setItem('termquay.layout.sidebar', mode || 'closed'); }
  function openDialog(temporary: boolean, connection?: Connection) { if (attempt.busy) return; attempt.clearError(); setDialog({ temporary, connection }); }
  function openSaved(c: Connection, another = false) {
    const existing = !another && workspaces.find(w => w.connectionID === c.id);
    if (existing) { select(existing.id); return; }
    if (!attempt.busy) void attempt.start(c);
  }
  const tools = <>
    <Tooltip content="命令搜索 · Ctrl/⌘ Shift P"><button className="icon-button" aria-label="命令搜索" onClick={() => setPalette(true)}><Icon name="search" /></button></Tooltip>
    <Tooltip content="连接侧栏"><button className="icon-button" aria-label="切换侧栏" aria-pressed={!!sidebar && !focus} onClick={() => changeSidebar(sidebar ? null : 'connections')}><Icon name="sidebar" /></button></Tooltip>
    <Tooltip content="服务器监控"><button className="icon-button" aria-label="服务器监控" aria-pressed={monitorOpen && !focus} disabled={!current || !!current.rdp} onClick={() => setMonitorOpen(!monitorOpen)}><Icon name="monitor" /></button></Tooltip>
    <Tooltip content="专注模式"><button className="icon-button" aria-label="专注模式" aria-pressed={focus} onClick={() => setFocus(!focus)}><Icon name="focus" /></button></Tooltip>
  </>;
  const commands: WorkbenchCommand[] = [
    ...workspaces.map(w => ({ id: `workspace-${w.id}`, label: w.name, detail: w.rdp ? 'RDP' : 'SSH', kind: 'workspace' as const, run: () => select(w.id) })),
    ...(catalog?.connections || []).map(c => ({ id: `connection-${c.id}`, label: c.name, detail: `${c.protocol.toUpperCase()} · ${c.host}`, kind: 'connection' as const, run: () => openSaved(c) })),
    { id: 'new', label: '新建连接', kind: 'command', run: () => openDialog(false) },
    { id: 'quick', label: '快速连接', kind: 'command', run: () => openDialog(true) },
    { id: 'connections', label: '显示连接侧栏', kind: 'command', run: () => changeSidebar('connections') },
    ...(current && !current.rdp ? [{ id: 'files', label: '显示文件侧栏', kind: 'command' as const, run: () => changeSidebar('files') }, { id: 'monitor', label: monitorOpen ? '收起监控' : '打开监控', kind: 'command' as const, run: () => { setFocus(false); setMonitorOpen(!monitorOpen); } }] : []),
    { id: 'transfers', label: '查看传输任务', kind: 'command', run: () => setTransfersOpen(true) },
    { id: 'focus', label: focus ? '退出专注模式' : '进入专注模式', kind: 'command', run: () => setFocus(!focus) },
    { id: 'settings', label: '打开设置', kind: 'command', run: () => setSettings(true) },
  ];
  return <>
    <Workbench tabs={<WorkspaceTabs items={workspaces} active={active} onSelect={select} onClose={id => workspaces.find(w => w.id === id)?.dirty ? setClosing(id) : remove(id)} onNew={() => openDialog(false)} />} tools={tools} sidebarMode={sidebar} sidebarWidth={sidebarWidth} onSidebarWidth={setSidebarWidth} hasSSH={!!current && !current.rdp} settings={settings} onSettings={() => setSettings(!settings)} focus={focus} onSidebar={changeSidebar}
      sidebar={<><div hidden={sidebar !== 'connections'} className="sidebar-content"><ConnectionSidebar connections={catalog?.connections || []} groups={catalog?.groups || []} onOpen={openSaved} onEdit={c => openDialog(false, c)} onNew={openDialog} onReload={() => void reload()} busy={attempt.busy} /></div><div className="sidebar-content" hidden={sidebar !== 'files'} ref={setSidebarHost} /></>}
      status={<><span>{catalog?.session_only ? '会话存储' : '本地工作台'}</span><span>{workspaces.length} 个工作区</span><div className="status-spacer" /><button className={transfers.failed || transfers.error ? 'error' : ''} aria-expanded={transfersOpen} onClick={() => setTransfersOpen(!transfersOpen)}><Icon name="transfer" width="14" />{transfers.running ? `传输 ${transfers.running} 进行中` : transfers.items.length ? `传输 ${transfers.items.length} 项` : '传输'}{transfers.failed ? ` · ${transfers.failed} 失败` : ''}{transfers.error ? ' · 加载失败' : ''}</button></>}>
      {storageError && <div className="storage-error error" role="alert">{storageError}<Button size="sm" onPress={() => { UseSessionStorage().then(reload).catch(e => setStorageError(String(e))); }}>使用会话存储</Button></div>}
      {!dialog && (attempt.busy || attempt.error) && <div className="connection-feedback" role={attempt.error ? 'alert' : 'status'}><span className={attempt.error ? 'error' : ''}>{attempt.target} · {attempt.error || '正在连接…'}</span>{attempt.busy && <Button size="sm" variant="light" onPress={attempt.cancel}>取消连接</Button>}{!attempt.busy && <button className="icon-button" aria-label="关闭连接错误" onClick={attempt.clearError}><Icon name="close" /></button>}</div>}
      {settings && <SettingsView fontSize={fontSize} onFontSize={setFontSize} onRestore={() => void reload()} onClose={() => setSettings(false)} />}
      {!current && !settings && <div className="workspace-empty"><div className="button-row"><Button variant="bordered" onPress={() => openDialog(false)}>新建连接</Button><Button variant="light" onPress={() => openDialog(true)}>快速连接</Button></div></div>}
      {workspaces.map(w => <div className="workspace" hidden={settings || active !== w.id} key={w.id}>{w.rdp ? <RDPView grant={w.rdp} ref={w.view} visible={!settings && active === w.id} /> : <SSHWorkspace id={w.id} ref={w.ssh} fontSize={fontSize} visible={!settings && active === w.id} sidebarHost={sidebarHost} filesVisible={sidebar === 'files' && !focus && !settings && active === w.id} monitorVisible={monitorOpen && !focus && !settings && active === w.id} onMonitorClose={() => setMonitorOpen(false)} onDirtyChange={dirty => setWorkspaces(prev => prev.map(item => item.id === w.id ? { ...item, dirty } : item))} />}</div>)}
      {transfersOpen && <TransferPanel tasks={transfers} height={transferHeight} onHeight={setTransferHeight} onClose={() => setTransfersOpen(false)} />}
    </Workbench>
    {dialog && <ConnectionDialog {...dialog} groups={catalog?.groups || []} busy={attempt.busy} connectionError={attempt.error} onConnect={attempt.start} onSaved={() => void reload()} onClose={() => { setDialog(undefined); attempt.clearError(); }} onCancel={attempt.cancel} />}
    <HostTrustDialog target={attempt.trust} onConfirm={attempt.confirm} />
    {palette && <CommandPalette commands={commands} onClose={() => setPalette(false)} />}
    <Modal isOpen={!!closing || quitConfirm} onClose={() => { if (!savingClose) { setClosing(''); setQuitConfirm(false); setCloseError(''); } }} isDismissable={!savingClose} isKeyboardDismissDisabled={savingClose} className="app-dialog"><ModalContent><ModalHeader>未保存文件</ModalHeader><ModalBody><p>{quitConfirm ? '应用中有未保存修改。' : '此工作区有未保存修改。'}</p>{closeError && <p className="error" role="alert">{closeError}</p>}</ModalBody><ModalFooter><Button variant="light" isDisabled={savingClose} onPress={() => { setClosing(''); setQuitConfirm(false); setCloseError(''); }}>返回编辑</Button><Button color="danger" variant="light" isDisabled={savingClose} onPress={() => { if (quitConfirm) void DiscardAndQuit(); else remove(closing); setClosing(''); }}>放弃修改并{quitConfirm ? '退出' : '关闭'}</Button><Button color="primary" isLoading={savingClose} onPress={async () => {
      setSavingClose(true); setCloseError('');
      try {
        const targets = quitConfirm ? workspaces.filter(w => w.dirty) : workspaces.filter(w => w.id === closing);
        for (const w of targets) { if (!await w.ssh?.current?.saveAll()) { select(w.id); setCloseError('保存未完成，请返回编辑处理文件错误。'); return; } }
        if (quitConfirm) await DiscardAndQuit(); else { remove(closing); setClosing(''); }
      } catch (e) { setCloseError(String(e)); } finally { setSavingClose(false); }
    }}>保存并{quitConfirm ? '退出' : '关闭'}</Button></ModalFooter></ModalContent></Modal>
  </>;
}
