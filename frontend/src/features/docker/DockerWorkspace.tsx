import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, DropdownTrigger, DropdownMenu, DropdownItem } from '@heroui/react';
import { Events } from '@wailsio/runtime';
import { ChangeContainerState, CloseContainerTerminal, InspectContainer, ListContainers, OpenContainerTerminal, SetDockerSocket, StartTunnel } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { Container, Details, Port } from '../../../bindings/github.com/Sanjeever/termquay/internal/docker/models';
import { t as translate } from '../../i18n/index.ts';
import { message as uiMessage } from '../../i18n/messages.ts';
import { useMessageState } from '../../i18n/useMessageState.ts';
import { errorMessage, eventError } from '../../lib/errors';
import ErrorNotice from '../../components/ErrorNotice';
import Icon from '../../components/Icon';
import { Dropdown } from '../../components/Popover';
import SelectControl from '../../components/SelectControl';
import ResizeHandle from '../../components/layout/ResizeHandle';
import TerminalView from '../terminal/TerminalView';
import ContainerResources from './ContainerResources';
import ContainerLogs from './ContainerLogs';
import type { LogSource } from '../logs/LogSourcePane';
import '../../styles/docker.css';

export type DockerTarget = { id: string; name: string; address: string; connectionID?: string; socket?: string };
type Console = { id: string; target: DockerTarget; socket: string; container: string; name: string; shell: string };
type Action = { target: DockerTarget; socket: string; container: Container; kind: 'start' | 'stop' | 'restart' };
const defaultSocket = '/var/run/docker.sock';
const tabs = ['overview', 'logs', 'terminal', 'mountsAndPorts'] as const;

export default function DockerWorkspace({ open, targets, request, fontSize, onDirectory, onSocketSaved, onLogs, onError }: {
  open: boolean; targets: DockerTarget[]; request?: { workspace?: string; container?: string }; fontSize: number;
  onDirectory(workspace: string, path: string): void; onSocketSaved(connection: string, socket: string): void;
  onLogs(source: LogSource): void; onError(error: unknown): void;
}) {
  useTranslation();
  const [target, setTarget] = useState(() => targets.find(item => item.id === request?.workspace) || (!request?.workspace ? targets[0] : undefined));
  const workspace = target?.id || '';
  const socket = target?.socket || defaultSocket;
  const owner = `${workspace}\0${socket}`;
  const live = targets.some(item => item.id === workspace);
  const [listing, setListing] = useState<{ owner: string; containers: Container[]; selected?: string }>();
  const containers = listing?.owner === owner ? listing.containers : [];
  const selected = containers.find(item => item.id === listing?.selected);
  const selection = `${owner}\0${selected?.id || ''}`;
  const [inspection, setInspection] = useState<{ selection: string; value: Details }>();
  const details = inspection?.selection === selection ? inspection.value : undefined;
  const [view, setView] = useState<(typeof tabs)[number]>('overview');
  const [filter, setFilter] = useState('');
  const [stateFilter, setStateFilter] = useState('all');
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [refresh, setRefresh] = useState(0);
  const [listBusy, setListBusy] = useState(false);
  const [detailBusy, setDetailBusy] = useState(false);
  const [listError, setListError] = useMessageState('');
  const [detailError, setDetailError] = useMessageState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [socketDraft, setSocketDraft] = useState(socket);
  const [saving, setSaving] = useState(false);
  const [settingsError, setSettingsError] = useMessageState('');
  const [shell, setShell] = useState('/bin/sh');
  const [consoles, setConsoles] = useState<Console[]>([]);
  const [opening, setOpening] = useState('');
  const [terminalError, setTerminalError] = useMessageState('');
  const [action, setAction] = useState<Action>();
  const [changing, setChanging] = useState(false);
  const [completedAction, setCompletedAction] = useState<Action>();
  const [actionError, setActionError] = useMessageState('');
  const [forwarding, setForwarding] = useState(false);
  const [tunnel, setTunnel] = useState<{ selection: string; address: string }>();
  const [tunnelError, setTunnelError] = useMessageState('');
  const [visible, setVisible] = useState(document.visibilityState === 'visible');
  const [minimised, setMinimised] = useState(false);
  const active = open && visible && !minimised;
  const pending = useRef(new Set<{ cancel(): void }>());
  const mounted = useRef(true);
  const current = useRef({ owner, selection, targets }); current.current = { owner, selection, targets };
  const requestedContainer = useRef(request?.container);
  const lastList = useRef('');
  const lastDetail = useRef('');
  const consoleOpening = useRef(false);
  const currentConsole = consoles.find(item => item.target.id === workspace && item.socket === socket && item.container === selected?.id);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; pending.current.forEach(item => item.cancel()); }; }, []);
  useEffect(() => { const update = () => setVisible(document.visibilityState === 'visible'); document.addEventListener('visibilitychange', update); return () => document.removeEventListener('visibilitychange', update); }, []);
  useEffect(() => { const off = [Events.On(Events.Types.Common.WindowMinimise, () => setMinimised(true)), Events.On(Events.Types.Common.WindowUnMinimise, () => setMinimised(false)), Events.On(Events.Types.Common.WindowRestore, () => setMinimised(false))]; return () => off.forEach(dispose => dispose()); }, []);
  useEffect(() => {
    if (!request?.workspace) return;
    const next = targets.find(item => item.id === request.workspace);
    if (next) setTarget(next);
    requestedContainer.current = request.container;
    setView('overview'); setRefresh(value => value + 1);
  }, [request]);
  useEffect(() => { setSocketDraft(socket); setSettingsError(''); }, [workspace, socket]);
  useEffect(() => { setTerminalError(''); setTunnelError(''); if (!changing) { setAction(undefined); setActionError(''); } }, [selection]);

  useEffect(() => {
    const key = `${owner}\0${refresh}`;
    if (!active || !live || lastList.current === key) { setListBusy(false); return; }
    let ended = false;
    setListBusy(true); setListError('');
    const call = ListContainers(workspace, socket);
    call.then(values => {
      if (ended) return;
      const items = values || [];
      const requested = requestedContainer.current;
      setListing(previous => ({ owner, containers: items, selected: requested ? items.find(item => item.id === requested || item.name === requested)?.id : previous?.owner === owner && previous.selected ? items.find(item => item.id === previous.selected)?.id : items[0]?.id }));
      if (requested && !items.some(item => item.id === requested || item.name === requested)) setListError(uiMessage('docker:theContainerLinkedInThePlaybookDoesNot'));
      requestedContainer.current = undefined;
      lastList.current = key;
    }).catch(error => { if (!ended) { lastList.current = key; setListError(error); } }).finally(() => { if (!ended) setListBusy(false); });
    return () => { ended = true; call.cancel(); };
  }, [owner, workspace, socket, refresh, active, live]);

  useEffect(() => {
    const key = `${selection}\0${refresh}`;
    if (!active || !live || !selected || lastDetail.current === key) { setDetailBusy(false); return; }
    let ended = false;
    setDetailBusy(true); setDetailError('');
    const call = InspectContainer(workspace, socket, selected.id);
    call.then(value => { if (!ended) { setInspection({ selection, value }); lastDetail.current = key; } }).catch(error => { if (!ended) { setDetailError(error); lastDetail.current = key; } }).finally(() => { if (!ended) setDetailBusy(false); });
    return () => { ended = true; call.cancel(); };
  }, [selection, workspace, socket, selected?.id, refresh, active, live]);

  function chooseTarget(id: string) {
    const next = targets.find(item => item.id === id);
    if (!next) return;
    requestedContainer.current = undefined;
    setTarget(next); setView('overview'); setSettingsOpen(false);
  }
  function chooseContainer(id: string) { setListing(previous => previous && { ...previous, selected: id }); setView('overview'); }
  async function saveSocket() {
    if (!target || saving) return;
    const before = target; const value = socketDraft.trim() || defaultSocket;
    setSaving(true); setSettingsError('');
    try {
      if (before.connectionID) {
        const call = SetDockerSocket(before.connectionID, value); pending.current.add(call);
        try { await call; } finally { pending.current.delete(call); }
        onSocketSaved(before.connectionID, value);
      } else if (!value.startsWith('/') || value.includes('\0') || value.includes('\n') || value.includes('\r')) {
        throw uiMessage('backend:dockerSocketMustBeAnAbsoluteRemoteUnix');
      }
      if (mounted.current && current.current.owner === `${before.id}\0${before.socket || defaultSocket}`) { setTarget({ ...before, socket: value }); setSettingsOpen(false); }
    } catch (error) { if (mounted.current) setSettingsError(error); }
    finally { if (mounted.current) setSaving(false); }
  }
  async function openConsole() {
    if (!selected || !target || !live || consoleOpening.current) return;
    if (currentConsole) { setView('terminal'); return; }
    const before = { target, socket, container: selected.id, name: selected.name, shell };
    const key = selection;
    consoleOpening.current = true; setOpening(key); setTerminalError('');
    const call = OpenContainerTerminal(workspace, socket, selected.id, shell); pending.current.add(call);
    try {
      const result = await call;
      if (!mounted.current || !current.current.targets.some(item => item.id === before.target.id)) await CloseContainerTerminal(result.id).catch(onError);
      else { setConsoles(previous => [...previous, { ...before, id: result.id }]); if (current.current.selection === key) setView('terminal'); }
    } catch (error) { if (mounted.current) setTerminalError(error); }
    finally { pending.current.delete(call); consoleOpening.current = false; if (mounted.current) setOpening(''); }
  }
  async function closeConsole(item: Console) {
    try { await CloseContainerTerminal(item.id); if (mounted.current) setConsoles(previous => previous.filter(value => value.id !== item.id)); }
    catch (error) { if (mounted.current) setTerminalError(error); }
  }
  function revealConsole(item: Console) {
    setTarget(item.target); requestedContainer.current = item.container;
    setListing(previous => previous?.owner === `${item.target.id}\0${item.socket}` ? { ...previous, selected: item.container } : previous);
    setRefresh(value => value + 1); setView('terminal');
  }
  async function changeState() {
    if (!action || changing || !targets.some(item => item.id === action.target.id)) return;
    const before = action;
    setChanging(true); setActionError('');
    const call = ChangeContainerState(before.target.id, before.socket, before.container.id, before.kind); pending.current.add(call);
    try {
      await call;
      if (mounted.current) { setAction(undefined); setCompletedAction(before); if (current.current.owner === `${before.target.id}\0${before.socket}`) setRefresh(value => value + 1); }
    } catch (error) { if (mounted.current) setActionError(error); }
    finally { pending.current.delete(call); if (mounted.current) setChanging(false); }
  }
  async function forward(port: Port) {
    if (!live || forwarding) return;
    const key = selection;
    setForwarding(true); setTunnelError('');
    const call = StartTunnel(workspace, { kind: 'local', bind_host: '127.0.0.1', bind_port: 0, target_host: !port.ip || port.ip === '0.0.0.0' ? '127.0.0.1' : port.ip === '::' ? '::1' : port.ip, target_port: port.public_port, allow_public: false }); pending.current.add(call);
    try { const result = await call; if (mounted.current && current.current.selection === key) setTunnel({ selection: key, address: result.info.address }); }
    catch (error) { if (mounted.current) setTunnelError(error); }
    finally { pending.current.delete(call); if (mounted.current) setForwarding(false); }
  }

  const groups = new Map<string, Container[]>();
  for (const item of containers) {
    if (stateFilter === 'running' && item.state !== 'running' || stateFilter === 'stopped' && item.state === 'running' || !`${item.name} ${item.image} ${item.project}`.toLowerCase().includes(filter.toLowerCase())) continue;
    const name = item.project || translate('docker:notInCompose');
    const group = groups.get(name); if (group) group.push(item); else groups.set(name, [item]);
  }
  const source: LogSource | undefined = target && selected ? { id: selection, workspace, host: `${target.name} · ${target.address}`, kind: 'container', target: selected.id, name: selected.name, socket } : undefined;

  return <div className="docker-workspace" style={{ '--docker-sidebar-width': `${sidebarWidth}px` } as CSSProperties}>
    <header className="docker-toolbar">
      <SelectControl aria-label={translate('docker:sSHWorkspace')} value={workspace} disabled={saving} onChange={event => chooseTarget(event.target.value)}>
        <option value="">{translate('docker:selectWorkspace')}</option>
        {target && !live && <option value={workspace}>{`${target.name} · ${translate('docker:disconnected')}`}</option>}
        {targets.map(item => <option key={item.id} value={item.id}>{`${item.name} · ${item.address}`}</option>)}
      </SelectControl>
      <Button size="sm" variant="light" isDisabled={!live || listBusy} isLoading={listBusy} onPress={() => setRefresh(value => value + 1)}><Icon name="refresh" width="14" />{translate('docker:refresh')}</Button>
      <div className="docker-toolbar-spacer" />
      {consoles.length > 0 && <Dropdown><DropdownTrigger><button className="session-tool">{translate('docker:terminal')} ({consoles.length})<Icon name="chevron" width="12" /></button></DropdownTrigger><DropdownMenu aria-label={translate('docker:openTerminals')} onAction={id => { const item = consoles.find(value => value.id === id); if (item) revealConsole(item); }}>{consoles.map(item => <DropdownItem key={item.id} description={item.target.address}>{item.target.name} / {item.name}</DropdownItem>)}</DropdownMenu></Dropdown>}
      <button className="session-tool" aria-expanded={settingsOpen} disabled={!target || saving} onClick={() => setSettingsOpen(value => !value)}><Icon name="settings" width="14" />{translate('docker:connectionSettings')}</button>
    </header>
    {settingsOpen && <form className="docker-settings" onSubmit={event => { event.preventDefault(); void saveSocket(); }}>
      <label className="form-field">Docker socket<input value={socketDraft} maxLength={4096} placeholder={defaultSocket} onChange={event => setSocketDraft(event.target.value)} disabled={saving} /></label>
      <Button size="sm" type="submit" isLoading={saving}>{translate('docker:apply')}</Button><ErrorNotice message={settingsError} />
    </form>}
    {!workspace && <div className="docker-empty" role="status">{translate(targets.length ? 'docker:selectWorkspace' : 'docker:connectSSH')}</div>}
    {workspace && !live && <div className="docker-disconnected" role="status">{translate('docker:disconnectedContent', { host: target?.name })}</div>}
    {workspace && <div className="docker-body">
      <aside className="docker-sidebar" aria-label={translate('docker:dockerContainers')}>
        <div className="docker-filters"><input aria-label={translate('docker:filter')} placeholder={translate('docker:searchContainers')} value={filter} onChange={event => setFilter(event.target.value)} /><SelectControl aria-label={translate('docker:state')} value={stateFilter} onChange={event => setStateFilter(event.target.value)}><option value="all">{translate('docker:allStates')}</option><option value="running">{translate('docker:running')}</option><option value="stopped">{translate('docker:stopped')}</option></SelectControl></div>
        <ErrorNotice message={listError && completedAction?.target.id === workspace && completedAction.socket === socket ? translate('docker:containerOperationCompletedButStateRefreshFailed') + listError : listError} />
        <div className="docker-container-list" aria-busy={listBusy}>
          {Array.from(groups, ([project, items]) => <details key={project} open className="docker-project"><summary>{project}<span>{items.length}</span></summary>{items.map(item => <button key={item.id} className="docker-container-row" aria-pressed={selected?.id === item.id} onClick={() => chooseContainer(item.id)}><span className="docker-container-name">{item.name}{consoles.some(console => console.target.id === workspace && console.socket === socket && console.container === item.id) && <Icon name="terminal" width="13" />}</span><span className="docker-container-image" title={item.image}>{item.image}</span><span className="docker-container-state" data-running={item.state === 'running'}>{stateLabel(item.state)}</span></button>)}</details>)}
          {!listBusy && !listError && !groups.size && <p className="docker-list-empty">{translate(containers.length ? 'docker:noMatches' : 'docker:noContainers')}</p>}
          {listBusy && !containers.length && <p className="docker-list-empty" role="status">{translate('docker:loadingContainers')}</p>}
        </div>
      </aside>
      <ResizeHandle label={translate('docker:resizeContainerList')} value={sidebarWidth} min={200} max={420} onChange={setSidebarWidth} />
      <section className="docker-detail" aria-label={selected?.name || translate('docker:container')}>
        {selected ? <>
          <header className="docker-container-header"><div><h2>{selected.name}<span className="docker-container-state" data-running={selected.state === 'running'}>{stateLabel(selected.state)}</span></h2><span className="file-path" title={selected.id}>{selected.image}</span></div>
            <Button size="sm" variant="light" isDisabled={!live || selected.state !== 'running' || !!opening} isLoading={opening === selection} onPress={() => void openConsole()}><Icon name="terminal" width="14" />{translate('docker:openTerminal')}</Button>
            <Dropdown><DropdownTrigger><button className="session-tool" disabled={!live || changing}>{translate('docker:actions')}<Icon name="chevron" width="12" /></button></DropdownTrigger><DropdownMenu aria-label={translate('docker:actions')} disabledKeys={selected.state === 'running' ? ['start'] : ['stop', 'restart']} onAction={kind => { setAction({ target: target!, socket, container: selected, kind: kind as Action['kind'] }); setActionError(''); }}><DropdownItem key="start">{translate('docker:start')}</DropdownItem><DropdownItem key="stop">{translate('docker:stop')}</DropdownItem><DropdownItem key="restart">{translate('docker:restart')}</DropdownItem></DropdownMenu></Dropdown>
          </header>
          <nav className="docker-tabs" aria-label={translate('docker:containerViews')}>{tabs.map(tab => <button key={tab} className="session-tool" aria-current={view === tab ? 'page' : undefined} onClick={() => setView(tab)}>{translate(`docker:${tab}`)}</button>)}</nav>
        </> : <div className="docker-empty">{translate('docker:selectContainer')}</div>}
        {action && <section className="docker-action-confirm" aria-label={translate('docker:confirmExecution')}><p>{translate('docker:confirmContainerAction', { host: `${action.target.name} · ${action.target.address}`, container: action.container.name, action: translate(`docker:${action.kind}`) })}</p><code>{action.container.id}</code><ErrorNotice message={actionError} /><div className="button-row"><Button size="sm" variant="light" isDisabled={changing} onPress={() => setAction(undefined)}>{translate('docker:cancel')}</Button><Button size="sm" color="danger" isLoading={changing} isDisabled={!targets.some(item => item.id === action.target.id)} onPress={() => void changeState()}>{translate('docker:confirmExecution')}</Button></div></section>}
        <ErrorNotice message={terminalError} />
        {selected && <div className="docker-page" hidden={view !== 'overview' && view !== 'mountsAndPorts'} aria-busy={detailBusy}>
          <ErrorNotice message={detailError && completedAction?.container.id === selected.id && completedAction.target.id === workspace && completedAction.socket === socket ? translate('docker:containerOperationCompletedButStateRefreshFailed') + detailError : detailError} />
          {detailBusy && !details && <p role="status">{translate('docker:loadingDetails')}</p>}
          {view === 'overview' && <>
            <dl className="docker-properties"><div><dt>{translate('docker:containerID')}</dt><dd className="file-path">{selected.id}</dd></div><div><dt>{translate('docker:host')}</dt><dd>{target?.address}</dd></div><div><dt>{translate('docker:state')}</dt><dd>{selected.status}</dd></div></dl>
            {details && <><dl className="docker-properties"><div><dt>{translate('docker:health')}</dt><dd>{details.health || translate('docker:noHealthCheckConfigured')}</dd></div><div><dt>{translate('docker:restartCount')}</dt><dd>{details.restart_count}</dd></div><div><dt>{translate('docker:lastExitCode')}</dt><dd>{details.exit_code}</dd></div><div><dt>{translate('docker:oOMKilled')}</dt><dd>{translate(details.oom_killed ? 'docker:yes' : 'docker:no')}</dd></div>{details.finished_at && !details.finished_at.startsWith('0001-') && <div><dt>{translate('docker:lastFinishedAt')}</dt><dd>{details.finished_at}</dd></div>}</dl><ErrorNotice message={errorMessage(eventError(details))} />{details.health_log && <details><summary>{translate('docker:recentHealthCheckOutput')}</summary><pre className="docker-health-log">{details.health_log}</pre></details>}</>}
            <ContainerResources workspace={workspace} socket={socket} id={selected.id} refresh={refresh} active={active && live && view === 'overview' && selected.state === 'running'} />
          </>}
          {view === 'mountsAndPorts' && <><h3>{translate('docker:mounts')}</h3><table><thead><tr><th>{translate('docker:source')}</th><th>{translate('docker:containerPath')}</th><th>{translate('docker:type')}</th><th>{translate('docker:permissions')}</th><th>{translate('docker:actions')}</th></tr></thead><tbody>{details?.mounts?.map((mount, index) => <tr key={index}><td className="file-path">{mount.source}</td><td className="file-path">{mount.destination}</td><td>{mount.type}</td><td>{translate(mount.writable ? 'docker:readWrite' : 'docker:readOnly')}</td><td>{mount.source.startsWith('/') && <button className="session-tool" disabled={!live} onClick={() => onDirectory(workspace, mount.source)}>{translate('docker:openDirectory')}</button>}</td></tr>)}</tbody></table>{details && !details.mounts?.length && <p className="session-status">{translate('docker:noMounts')}</p>}
            <h3>{translate('docker:portMappings')}</h3><table><thead><tr><th>{translate('docker:host')}</th><th>{translate('docker:containerPort')}</th><th>{translate('docker:protocol')}</th><th>{translate('docker:actions')}</th></tr></thead><tbody>{selected.ports?.map((port, index) => <tr key={index}><td>{port.public_port ? `${port.ip || '0.0.0.0'}:${port.public_port}` : translate('docker:notPublished')}</td><td>{port.private_port}</td><td>{port.type}</td><td>{!!port.public_port && port.type === 'tcp' && <button className="session-tool" disabled={!live || forwarding} onClick={() => void forward(port)}>{translate('docker:createLocalTunnel')}</button>}</td></tr>)}</tbody></table>{!selected.ports?.length && <p className="session-status">{translate('docker:noPorts')}</p>}<ErrorNotice message={tunnelError} />{tunnel?.selection === selection && <p className="file-path">{translate('docker:listeningLocallyAt')}{tunnel.address}</p>}
          </>}
        </div>}
        {source && <ContainerLogs key={selection} source={source} active={active && view === 'logs'} live={live} hidden={view !== 'logs'} onAdd={() => onLogs(source)} />}
        {selected && view === 'terminal' && <div className="docker-terminal-toolbar"><SelectControl aria-label={translate('docker:containerShell')} value={shell} onChange={event => setShell(event.target.value)} disabled={!!currentConsole}><option>/bin/sh</option><option>/bin/bash</option></SelectControl>{currentConsole ? <><span className="session-status">{currentConsole.target.address} / {currentConsole.name}</span><Button size="sm" variant="light" onPress={() => void closeConsole(currentConsole)}>{translate('docker:closeContainerTerminal')}</Button></> : <Button size="sm" variant="light" isDisabled={!live || selected.state !== 'running' || !!opening} isLoading={opening === selection} onPress={() => void openConsole()}>{translate('docker:openTerminal')}</Button>}</div>}
        {consoles.map(item => <div key={item.id} hidden={view !== 'terminal' || currentConsole?.id !== item.id} className="docker-terminal"><TerminalView container id={item.id} workspace={item.target.id} visible={active && view === 'terminal' && currentConsole?.id === item.id} fontSize={fontSize} onSnippets={() => {}} /></div>)}
      </section>
    </div>}
  </div>;
}

function stateLabel(state: string) {
  const keys = { running: 'docker:stateRunning', exited: 'docker:stateExited', created: 'docker:stateCreated', paused: 'docker:statePaused', restarting: 'docker:stateRestarting', removing: 'docker:stateRemoving', dead: 'docker:stateDead' } as const;
  return Object.prototype.hasOwnProperty.call(keys, state) ? translate(keys[state as keyof typeof keys]) : state;
}
