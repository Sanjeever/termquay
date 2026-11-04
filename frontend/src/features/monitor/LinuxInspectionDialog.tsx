import { useEffect, useState } from 'react';
import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react';
import { ListLinuxProcesses, ListLinuxServices, ReadLinuxProcessDetails, ReadLinuxServiceDetails, ReadLinuxServiceLog } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { LinuxProcess, LinuxProcessDetails, LinuxProcessList, LinuxServiceDetails, LinuxServiceList } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import type { CommandResult } from '../../../bindings/github.com/Sanjeever/termquay/internal/ssh/models';
import ErrorNotice from '../../components/ErrorNotice';
import SelectControl from '../../components/SelectControl';
import Tooltip from '../../components/Tooltip';
import { errorMessage } from '../../lib/errors';
import { bytes } from '../files/transferFormat';

type Navigation = { onDirectory?(path: string): void; onFile?(path: string): Promise<void>; onService(unit: string): void };

function ProcessDetails({ workspace, process, onDirectory, onService }: { workspace: string; process: LinuxProcess } & Navigation) {
  const [details, setDetails] = useState<LinuxProcessDetails>();
  const [error, setError] = useState('');
  useEffect(() => {
    let ended = false;
    const request = ReadLinuxProcessDetails(workspace, process.pid);
    request.then(value => { if (!ended) setDetails(value); }).catch(e => { if (!ended) setError(errorMessage(e)); });
    return () => { ended = true; request.cancel(); };
  }, [workspace, process.pid]);
  return <section className="inspection-detail" aria-label={`进程 ${process.pid} 详情`}>
    <div className="session-status">PID {process.pid} · 父进程 {process.parent} · {process.user} · 已运行 {process.elapsed}</div>
    <pre className="inspection-command">{process.command}</pre>
    <ErrorNotice message={error} />
    {!details && !error && <p role="status" className="muted">正在读取进程详情…</p>}
    {details && <>
      {details.executable && <p className="file-path">可执行文件 · {details.executable}</p>}
      {details.directory && <div className="inspection-path"><span className="file-path">工作目录 · {details.directory}</span>{onDirectory && details.directory.startsWith('/') && <Button size="sm" variant="light" onPress={() => onDirectory(details.directory)}>打开目录</Button>}</div>}
      {details.service && <Button size="sm" variant="light" onPress={() => onService(details.service)}>查看服务 {details.service}</Button>}
      {(details.errors || []).map((message, index) => <p key={index} role="status" className="error">{message}</p>)}
    </>}
  </section>;
}

function ProcessInspection({ workspace, initialOrder, ...navigation }: { workspace: string; initialOrder: 'cpu' | 'memory' } & Navigation) {
  const [order, setOrder] = useState(initialOrder);
  const [filter, setFilter] = useState('');
  const [revision, setRevision] = useState(0);
  const [list, setList] = useState<LinuxProcessList>();
  const [selected, setSelected] = useState<LinuxProcess>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  useEffect(() => {
    let ended = false;
    setBusy(true); setError(''); setList(undefined); setSelected(undefined);
    const request = ListLinuxProcesses(workspace, order);
    request.then(value => { if (!ended) setList(value); }).catch(e => { if (!ended) setError(errorMessage(e)); }).finally(() => { if (!ended) setBusy(false); });
    return () => { ended = true; request.cancel(); };
  }, [workspace, order, revision]);
  const query = filter.toLowerCase();
  const items = (list?.items || []).filter(process => `${process.pid} ${process.user} ${process.command}`.toLowerCase().includes(query));
  return <>
    <div className="inspection-toolbar"><SelectControl aria-label="进程排序" value={order} onChange={event => setOrder(event.target.value as 'cpu' | 'memory')}><option value="cpu">按 CPU 排序</option><option value="memory">按内存排序</option></SelectControl><input aria-label="过滤已读取进程" placeholder="过滤已读取进程" value={filter} onChange={event => setFilter(event.target.value)} maxLength={256} /><Button size="sm" variant="light" isLoading={busy} onPress={() => setRevision(value => value + 1)}>刷新</Button></div>
    <ErrorNotice message={error} />
    {list?.warning && <p role="status" className="error">{list.warning}</p>}
    {list && <div className="session-status" role="status">{items.length} / {list.items?.length || 0} 个进程 · {new Date(list.time).toLocaleTimeString()}{list.truncated && ' · 结果已截断，可切换排序查看其他高占用进程'}</div>}
    <div className="inspection-table-scroll"><table className="inspection-table"><thead><tr><th>PID</th><th>用户</th><th><Tooltip content="进程存活期间的平均 CPU 使用率，来自 ps；与监控的采样区间使用率不同"><span>CPU %</span></Tooltip></th><th>内存</th><th>命令行</th></tr></thead><tbody>{items.map(process => <tr key={process.pid} className={selected?.pid === process.pid ? 'selected' : ''}><td><button className="inspection-pick" aria-label={`查看进程 ${process.pid}`} aria-pressed={selected?.pid === process.pid} onClick={() => setSelected(process)}>{process.pid}</button></td><td>{process.user}</td><td>{process.cpu.toFixed(1)}</td><td><Tooltip content={`物理内存占比 ${process.memory.toFixed(1)}%`}><span>{bytes(process.rss)}</span></Tooltip></td><td><button className="inspection-process-command" onClick={() => setSelected(process)}>{process.command}</button></td></tr>)}</tbody></table></div>
    {list && !items.length && <p className="sidebar-empty">没有匹配进程</p>}
    {selected && <ProcessDetails key={`${workspace}:${revision}:${selected.pid}`} workspace={workspace} process={selected} {...navigation} />}
  </>;
}

const serviceProperties = [['Description', '描述'], ['LoadState', '加载状态'], ['ActiveState', '活动状态'], ['SubState', '子状态'], ['Result', '运行结果'], ['MainPID', '主进程'], ['ExecMainStatus', '退出状态'], ['ExecMainStartTimestamp', '启动时间'], ['User', '运行用户']] as const;

function ServiceDetails({ workspace, unit, onDirectory, onFile }: { workspace: string; unit: string } & Navigation) {
  const [details, setDetails] = useState<LinuxServiceDetails>();
  const [log, setLog] = useState<CommandResult>();
  const [error, setError] = useState('');
  const [logError, setLogError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let ended = false;
    setDetails(undefined); setLog(undefined); setError(''); setLogError('');
    const request = ReadLinuxServiceDetails(workspace, unit);
    const logs = ReadLinuxServiceLog(workspace, unit);
    request.then(value => { if (!ended) setDetails(value); }).catch(e => { if (!ended) setError(errorMessage(e)); });
    logs.then(value => { if (!ended) setLog(value); }).catch(e => { if (!ended) setLogError(errorMessage(e)); });
    return () => { ended = true; request.cancel(); logs.cancel(); };
  }, [workspace, unit, revision]);
  const properties = details?.properties || {};
  return <section className="inspection-detail" aria-label={`${unit} 详情`}>
    <div className="inspection-toolbar"><strong>{unit}</strong><Button size="sm" variant="light" onPress={() => setRevision(value => value + 1)}>刷新详情与日志</Button></div>
    <ErrorNotice message={error} />
    {details?.warning && <p className="error" role="status">{details.warning}</p>}
    {!details && !error && <p role="status" className="muted">正在读取服务详情…</p>}
    {details && <><dl className="inspection-properties">{serviceProperties.filter(([key]) => properties[key] !== '').map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{properties[key] || '—'}</dd></div>)}</dl>
      {properties.FragmentPath && <div className="inspection-path"><span className="file-path">{properties.FragmentPath}</span>{onFile && properties.FragmentPath.startsWith('/') && <Button size="sm" variant="light" onPress={() => { void onFile(properties.FragmentPath!).catch(e => setError(errorMessage(e))); }}>打开服务文件</Button>}</div>}
      {properties.WorkingDirectory && <div className="inspection-path"><span className="file-path">{properties.WorkingDirectory}</span>{onDirectory && properties.WorkingDirectory.startsWith('/') && <Button size="sm" variant="light" onPress={() => onDirectory(properties.WorkingDirectory!)}>打开工作目录</Button>}</div>}
    </>}
    <details className="inspection-journal" open><summary>近期日志</summary><ErrorNotice message={logError} />{!log && !logError && <p role="status" className="muted">正在读取日志…</p>}{log?.stderr && <p className="error" role="status">{log.stderr}</p>}{log && <pre className="remote-log-content">{log.stdout}</pre>}{log?.truncated && <p className="error" role="status">日志输出已截断</p>}</details>
  </section>;
}

function ServiceInspection({ workspace, initialUnit, ...navigation }: { workspace: string; initialUnit: string } & Navigation) {
  const [filter, setFilter] = useState(initialUnit);
  const [query, setQuery] = useState(initialUnit);
  const [revision, setRevision] = useState(0);
  const [list, setList] = useState<LinuxServiceList>();
  const [selected, setSelected] = useState(initialUnit);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  useEffect(() => {
    let ended = false;
    setBusy(true); setError(''); setList(undefined);
    const request = ListLinuxServices(workspace, query);
    request.then(value => { if (!ended) setList(value); }).catch(e => { if (!ended) setError(errorMessage(e)); }).finally(() => { if (!ended) setBusy(false); });
    return () => { ended = true; request.cancel(); };
  }, [workspace, query, revision]);
  return <>
    <form className="inspection-toolbar" onSubmit={event => { event.preventDefault(); setSelected(''); setQuery(filter); setRevision(value => value + 1); }}><input aria-label="按服务名筛选，支持通配符" placeholder="服务名，支持通配符" value={filter} onChange={event => setFilter(event.target.value)} maxLength={256} /><Button size="sm" type="submit" variant="light" isLoading={busy}>刷新</Button></form>
    <ErrorNotice message={error} />
    {list?.warning && <p className="error" role="status">{list.warning}</p>}
    {list && <div className="session-status" role="status">{list.items?.length || 0} 个已加载服务 · {new Date(list.time).toLocaleTimeString()}{list.truncated && ' · 结果已截断，请缩小筛选范围'}</div>}
    <div className="inspection-table-scroll"><table className="inspection-table"><thead><tr><th>服务</th><th>加载</th><th>活动状态</th><th>子状态</th><th>描述</th></tr></thead><tbody>{(list?.items || []).map(service => <tr key={service.unit} className={selected === service.unit ? 'selected' : ''}><td><button className="inspection-pick" aria-pressed={selected === service.unit} onClick={() => setSelected(service.unit)}>{service.unit}</button></td><td>{service.load}</td><td className={service.active === 'failed' ? 'error' : ''}>{service.active}</td><td>{service.sub}</td><td>{service.description}</td></tr>)}</tbody></table></div>
    {list && !list.items?.length && <p className="sidebar-empty">没有匹配的已加载服务</p>}
    {selected && <ServiceDetails key={`${workspace}:${selected}`} workspace={workspace} unit={selected} {...navigation} />}
  </>;
}

export default function LinuxInspectionDialog({ workspace, initialOrder, onDirectory, onFile, onClose }: { workspace: string; initialOrder: 'cpu' | 'memory' | 'services'; onDirectory?(path: string): void; onFile?(path: string): Promise<void>; onClose(): void }) {
  const [tab, setTab] = useState(initialOrder === 'services' ? 'services' : 'processes');
  const [service, setService] = useState('');
  function openDirectory(path: string) { onDirectory?.(path); onClose(); }
  async function openFile(path: string) { await onFile?.(path); onClose(); }
  function openService(unit: string) { setService(unit); setTab('services'); }
  return <Modal isOpen onClose={onClose} size="5xl" scrollBehavior="inside" className="app-dialog linux-inspection-dialog"><ModalContent><ModalHeader>进程与服务</ModalHeader><ModalBody>
    <div className="protocol-filters" role="group" aria-label="诊断类型"><button aria-pressed={tab === 'processes'} onClick={() => setTab('processes')}>进程</button><button aria-pressed={tab === 'services'} onClick={() => { setService(''); setTab('services'); }}>服务</button></div>
    {tab === 'processes' ? <ProcessInspection workspace={workspace} initialOrder={initialOrder === 'memory' ? 'memory' : 'cpu'} onDirectory={onDirectory ? openDirectory : undefined} onFile={onFile ? openFile : undefined} onService={openService} /> : <ServiceInspection key={service} workspace={workspace} initialUnit={service} onDirectory={onDirectory ? openDirectory : undefined} onFile={onFile ? openFile : undefined} onService={openService} />}
  </ModalBody><ModalFooter><Button variant="light" onPress={onClose}>关闭</Button></ModalFooter></ModalContent></Modal>;
}
