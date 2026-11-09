import { t as translate } from '../../i18n/index.ts';
import { message as uiMessage } from '../../i18n/messages.ts';
import { useMessageState } from '../../i18n/useMessageState.ts';
import { useTranslation } from 'react-i18next';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@heroui/react';
import SelectControl from '../../components/SelectControl';
import { Events } from '@wailsio/runtime';
import { CloseContainerTerminal, InspectContainer, ListContainers, OpenContainerTerminal, ReadContainerLogs, StartTunnel, ChangeContainerState } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { Container, Details, Logs } from '../../../bindings/github.com/Sanjeever/termquay/internal/docker/models';
import type { Port } from '../../../bindings/github.com/Sanjeever/termquay/internal/docker/models';
import { errorMessage, eventError } from '../../lib/errors.ts';
import TerminalView from '../terminal/TerminalView';
import '../../styles/docker.css';
import ContainerResources from './ContainerResources';

type Target = { id: string; name: string };
export default function DockerWorkspace({ open, targets, initial, initialContainer, fontSize, onDirectory }: { open: boolean; targets: Target[]; initial?: string; initialContainer?: string; fontSize: number; onDirectory?(workspace: string, path: string): void }) {
  useTranslation();
  const [workspace, setWorkspace] = useState(initial || targets[0]?.id || '');
  const [socket, setSocket] = useState('/var/run/docker.sock');
  const [containers, setContainers] = useState<Container[]>([]);
  const [selected, setSelected] = useState<Container>();
  const [details, setDetails] = useState<Details>();
  const [logs, setLogs] = useState<Logs>();
  const [follow, setFollow] = useState(false);
  const [view, setView] = useState('details');
  const [shell, setShell] = useState('/bin/sh');
  const [consoleID, setConsoleID] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useMessageState('');
  const [logError, setLogError] = useMessageState('');
  const [filter, setFilter] = useState('');
  const [tunnel, setTunnel] = useState('');
  const [action, setAction] = useState('');
  const [visible, setVisible] = useState(document.visibilityState === 'visible');
  const [minimised, setMinimised] = useState(false);
  const logHost = useRef<HTMLPreElement>(null);
  const pending = useRef(new Set<{ cancel(): void }>());
  const mounted = useRef(true);
  const generation = useRef(0);
  const active = open && visible && !minimised;
  const consoleRef = useRef(consoleID); consoleRef.current = consoleID;
  useEffect(() => () => { if (consoleRef.current) void CloseContainerTerminal(consoleRef.current); }, []);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; pending.current.forEach(request => request.cancel()); }; }, []);
  useEffect(() => { const update = () => setVisible(document.visibilityState === 'visible'); document.addEventListener('visibilitychange', update); return () => document.removeEventListener('visibilitychange', update); }, []);
  useEffect(() => { const off = [Events.On(Events.Types.Common.WindowMinimise, () => setMinimised(true)), Events.On(Events.Types.Common.WindowUnMinimise, () => setMinimised(false)), Events.On(Events.Types.Common.WindowRestore, () => setMinimised(false))]; return () => off.forEach(dispose => dispose()); }, []);
  useEffect(() => { generation.current++; pending.current.forEach(request => request.cancel()); setContainers([]); setSelected(undefined); setDetails(undefined); setLogs(undefined); setFollow(false); setError(''); setTunnel(''); }, [workspace, socket]);
  useEffect(() => { if (follow) logHost.current?.scrollTo({ top: logHost.current.scrollHeight }); }, [logs, follow]);
  useEffect(() => {
    if (!follow || !active || view !== 'logs' || !selected || !targets.some(target => target.id === workspace)) return;
    let ended = false, timer: ReturnType<typeof setTimeout>;
    let request: ReturnType<typeof ReadContainerLogs> | undefined;
    async function read() {
      request = ReadContainerLogs(workspace, socket, selected!.id);
      try { const value = await request; if (!ended) { setLogs(value); setLogError(''); } }
      catch (e) { if (!ended) { setLogError(e); setFollow(false); } }
      finally { if (!ended) timer = setTimeout(read, 2000); }
    }
    void read();
    return () => { ended = true; clearTimeout(timer); request?.cancel(); };
  }, [follow, active, view, selected?.id, workspace, socket, targets.some(target => target.id === workspace)]);
  useEffect(() => { if (initialContainer) void load(); }, [initialContainer, workspace, socket]);
  async function load() {
    const epoch = generation.current; setBusy(true); setError('');
    const request = ListContainers(workspace, socket); pending.current.add(request);
    try { const values = await request; if (mounted.current && epoch === generation.current) { setContainers(values || []); setSelected(previous => previous ? values?.find(item => item.id === previous.id) : undefined); if (initialContainer) { const item = values?.find(item => item.id === initialContainer || item.name === initialContainer); if (!item) throw uiMessage('docker:theContainerLinkedInThePlaybookDoesNot'); await inspect(item); } } }
    catch (e) { if (mounted.current && epoch === generation.current) setError(e); }
    finally { pending.current.delete(request); if (mounted.current) setBusy(false); }
  }
  async function inspect(container: Container) {
    const epoch = generation.current; setSelected(container); setDetails(undefined); setLogs(undefined); setFollow(false); setLogError(''); setView('details'); setBusy(true); setError(''); setTunnel('');
    const request = InspectContainer(workspace, socket, container.id); pending.current.add(request);
    try { const value = await request; if (mounted.current && epoch === generation.current) setDetails(value); }
    catch (e) { if (mounted.current && epoch === generation.current) setError(e); }
    finally { pending.current.delete(request); if (mounted.current) setBusy(false); }
  }
  async function readLogs() {
    if (!selected) return; setBusy(true); setLogError('');
    const request = ReadContainerLogs(workspace, socket, selected.id); pending.current.add(request);
    try { const value = await request; if (mounted.current) setLogs(value); }
    catch (e) { if (mounted.current) setLogError(e); }
    finally { pending.current.delete(request); if (mounted.current) setBusy(false); }
  }
  async function openConsole() {
    if (!selected) return; setBusy(true); setError('');
    const request = OpenContainerTerminal(workspace, socket, selected.id, shell); pending.current.add(request);
    try { const result = await request; if (mounted.current) { setConsoleID(result.id); setView('terminal'); } else await CloseContainerTerminal(result.id); }
    catch (e) { if (mounted.current) setError(e); }
    finally { pending.current.delete(request); if (mounted.current) setBusy(false); }
  }
  async function forward(port: Port) {
    setBusy(true); setError('');
    try { const result = await StartTunnel(workspace, { kind: 'local', bind_host: '127.0.0.1', bind_port: 0, target_host: !port.ip || port.ip === '0.0.0.0' ? '127.0.0.1' : port.ip === '::' ? '::1' : port.ip, target_port: port.public_port, allow_public: false }); if (mounted.current) setTunnel(result.info.address); }
    catch (e) { if (mounted.current) setError(e); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function changeState() {
    if (!selected || !action || busy) return;
    const epoch = generation.current, id = selected.id; let changed = false;
    setBusy(true); setError('');
    const request = ChangeContainerState(workspace, socket, id, action); pending.current.add(request);
    try {
      await request; changed = true;
      if (!mounted.current || epoch !== generation.current) return;
      setAction('');
      const list = ListContainers(workspace, socket), detail = InspectContainer(workspace, socket, id); pending.current.add(list); pending.current.add(detail);
      try { const [values, value] = await Promise.all([list, detail]); if (mounted.current && epoch === generation.current) { setContainers(values || []); setSelected(values?.find(item => item.id === id)); setDetails(value); } }
      finally { pending.current.delete(list); pending.current.delete(detail); }
    } catch (e) { if (mounted.current && epoch === generation.current) { setDetails(undefined); setError(`${changed ? uiMessage('docker:containerOperationCompletedButStateRefreshFailed') : ''}${errorMessage(e)}`); } }
    finally { pending.current.delete(request); if (mounted.current) setBusy(false); }
  }
  const groups = new Map<string, Container[]>();
  containers.filter(item => `${item.name} ${item.image} ${item.project}`.toLowerCase().includes(filter.toLowerCase())).forEach(item => { const group = item.project || translate('docker:notInCompose'); groups.set(group, [...(groups.get(group) || []), item]); });
  const live = targets.some(target => target.id === workspace);
  return <div className="docker-workspace docker-dialog">
    <div className="docker-connection"><label className="form-field">{translate('docker:sSHWorkspace')}<SelectControl value={workspace} disabled={busy || !!consoleID} onChange={event => setWorkspace(event.target.value)}><option value="">{translate('docker:selectWorkspace')}</option>{targets.map(target => <option key={target.id} value={target.id}>{target.name}</option>)}</SelectControl></label><label className="form-field">Docker socket<input value={socket} disabled={busy || !!consoleID} onChange={event => setSocket(event.target.value)} /></label><Button size="sm" variant="light" isDisabled={!live || busy} onPress={() => void load()}>{translate('docker:readContainers')}</Button></div>
    {error && <p className="error" role="alert">{error}</p>}
    <label className="form-field">{translate('docker:filter')}<input value={filter} onChange={event => setFilter(event.target.value)} /></label>
    <div className="docker-containers">{Array.from(groups, ([project, items]) => <section key={project}><h3>{project}</h3><table><thead><tr><th>{translate('docker:container')}</th><th>{translate('docker:image')}</th><th>{translate('docker:state')}</th></tr></thead><tbody>{items.map(item => <tr key={item.id} aria-selected={selected?.id === item.id}><td><button className="session-tool" disabled={busy || !!consoleID || !live} onClick={() => void inspect(item)}>{item.name}</button></td><td>{item.image}</td><td>{item.status} · {item.state}</td></tr>)}</tbody></table></section>)}</div>
    {selected && <><div className="button-row"><strong>{selected.name}</strong>{['details', 'logs', ...(consoleID ? ['terminal'] : [])].map(tab => <button key={tab} className="session-tool" aria-pressed={view === tab} onClick={() => setView(tab)}>{tab === 'details' ? translate('docker:mountsAndPorts') : tab === 'logs' ? translate('docker:logs') : translate('docker:terminal')}</button>)}<SelectControl aria-label={translate('docker:containerShell')} value={shell} disabled={busy || !!consoleID} onChange={event => setShell(event.target.value)}><option>/bin/sh</option><option>/bin/bash</option></SelectControl>{consoleID ? <Button size="sm" variant="light" onPress={() => { const id = consoleID; setConsoleID(''); setView('details'); CloseContainerTerminal(id).catch(e => setError(e)); }}>{translate('docker:closeContainerTerminal')}</Button> : <Button size="sm" variant="light" isDisabled={busy || !live || selected.state !== 'running'} onPress={() => void openConsole()}>{translate('docker:openTerminal')}</Button>}</div>
      <div hidden={view !== 'details'}>{details && <><h3>{translate('docker:mounts')}</h3><table><thead><tr><th>{translate('docker:source')}</th><th>{translate('docker:containerPath')}</th><th>{translate('docker:type')}</th><th>{translate('docker:permissions')}</th></tr></thead><tbody>{details.mounts?.map((mount, index) => <tr key={index}><td className="file-path">{mount.source}</td><td className="file-path">{mount.destination}</td><td>{mount.type}</td><td>{mount.writable ? translate('docker:readWrite') : translate('docker:readOnly')}</td></tr>)}</tbody></table></>}<h3>{translate('docker:portMappings')}</h3><table><thead><tr><th>{translate('docker:host')}</th><th>{translate('docker:containerPort')}</th><th>{translate('docker:protocol')}</th><th>{translate('docker:actions')}</th></tr></thead><tbody>{selected.ports?.map((port, index) => <tr key={index}><td>{port.public_port ? `${port.ip || '0.0.0.0'}:${port.public_port}` : translate('docker:notPublished')}</td><td>{port.private_port}</td><td>{port.type}</td><td>{!!port.public_port && port.type === 'tcp' && <button className="session-tool" disabled={busy || !live} onClick={() => void forward(port)}>{translate('docker:createLocalTunnel')}</button>}</td></tr>)}</tbody></table>{tunnel && <p className="file-path">{translate('docker:listeningLocallyAt')}{tunnel}</p>}</div>
      <div hidden={view !== 'logs'}><div className="button-row"><Button size="sm" variant="light" isDisabled={busy || follow || !live} onPress={() => void readLogs()}>{translate('docker:readRecentLogs')}</Button><label className="checkbox-label"><input type="checkbox" checked={follow} disabled={!live} onChange={event => setFollow(event.target.checked)} />{translate('docker:follow')}</label></div>{logError && <p className="error" role="alert">{logError}</p>}{logs?.truncated && <p role="status">{translate('docker:logsExceededReadLimitContentTruncated')}</p>}<pre ref={logHost} className="docker-logs">{logs?.text}</pre></div>
    </>}
    {selected && view === 'details' && <section className="inspection-detail"><div className="button-row"><strong>{selected.name}</strong>{['start', 'stop', 'restart'].map(value => <Button key={value} size="sm" variant="light" isDisabled={busy || !live || !!consoleID || (value === 'start' ? selected.state === 'running' : selected.state !== 'running')} onPress={() => setAction(value)}>{{ start: translate('docker:start'), stop: translate('docker:stop'), restart: translate('docker:restart') }[value]}</Button>)}</div>
      {details && <><dl className="inspection-properties"><div><dt>{translate('docker:health')}</dt><dd>{details.health || translate('docker:noHealthCheckConfigured')}</dd></div><div><dt>{translate('docker:restartCount')}</dt><dd>{details.restart_count}</dd></div><div><dt>{translate('docker:lastExitCode')}</dt><dd>{details.exit_code}</dd></div><div><dt>{translate('docker:oOMKilled')}</dt><dd>{details.oom_killed ? translate('docker:yes') : translate('docker:no')}</dd></div>{details.finished_at && !details.finished_at.startsWith('0001-') && <div><dt>{translate('docker:lastFinishedAt')}</dt><dd>{details.finished_at}</dd></div>}</dl>{errorMessage(eventError(details)) && <p className="error" role="alert">{errorMessage(eventError(details))}</p>}{details.health_log && <details><summary>{translate('docker:recentHealthCheckOutput')}</summary><pre>{details.health_log}</pre></details>}{onDirectory && details.mounts?.filter(mount => mount.source.startsWith('/')).map((mount, index) => <Button key={index} size="sm" variant="light" isDisabled={busy || !live} onPress={() => onDirectory(workspace, mount.source)}>{translate('docker:openHostPath')}{mount.source}</Button>)}</>}
      <ContainerResources workspace={workspace} socket={socket} id={selected.id} active={active && live && selected.state === 'running' && !busy} />
      {action && <section><p>{translate('docker:confirmContainerAction', { host: targets.find(target => target.id === workspace)?.name, container: selected.name, action: { start: translate('docker:start'), stop: translate('docker:stop'), restart: translate('docker:restart') }[action] })}</p><p className="file-path">{selected.id}</p><div className="button-row"><Button size="sm" variant="light" isDisabled={busy} onPress={() => setAction('')}>{translate('docker:cancel')}</Button><Button size="sm" color="danger" isLoading={busy} onPress={() => void changeState()}>{translate('docker:confirmExecution')}</Button></div></section>}
    </section>}
    {consoleID && <div hidden={view !== 'terminal'} className="docker-terminal"><TerminalView key={consoleID} container id={consoleID} workspace={workspace} visible={active && view === 'terminal'} fontSize={fontSize} onSnippets={() => {}} /></div>}
  </div>;
}
