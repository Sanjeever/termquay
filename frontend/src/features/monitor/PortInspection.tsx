import { useEffect, useRef, useState } from 'react';
import { Button } from '@heroui/react';
import { Browser } from '@wailsio/runtime';
import { ListLinuxPorts, ReadLinuxProcessDetails, ProbeNetworkTCP, StartTunnel } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { LinuxPortList, LinuxProcessDetails } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import SelectControl from '../../components/SelectControl';
import { errorMessage } from '../../lib/errors';

export default function PortInspection({ workspace, onDirectory, onService }: { workspace: string; onDirectory?(path: string): void; onService(unit: string): void }) {
  const [list, setList] = useState<LinuxPortList>();
  const [filter, setFilter] = useState('');
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState('');
  const [details, setDetails] = useState<{ pid: number; value: LinuxProcessDetails }>();
  const [source, setSource] = useState('remote');
  const [host, setHost] = useState('127.0.0.1');
  const [port, setPort] = useState(8080);
  const [probe, setProbe] = useState('');
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const requests = useRef(new Set<{ cancel(): void }>());
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; requests.current.forEach(value => value.cancel()); }; }, []);
  useEffect(() => {
    let ended = false; setError(''); setList(undefined); const request = ListLinuxPorts(workspace);
    request.then(value => { if (!ended) setList(value); }).catch(e => { if (!ended) setError(errorMessage(e)); });
    return () => { ended = true; request.cancel(); };
  }, [workspace, revision]);
  async function operate<T>(request: Promise<T> & { cancel(): void }, apply: (value: T) => void) {
    setBusy(true); setError(''); requests.current.add(request);
    try { const value = await request; if (mounted.current) apply(value); }
    catch (e) { if (mounted.current) setError(errorMessage(e)); }
    finally { requests.current.delete(request); if (mounted.current) setBusy(false); }
  }
  const items = (list?.items || []).filter(item => `${item.address} ${item.protocol} ${item.process}`.toLowerCase().includes(filter.toLowerCase()));
  return <>
    <div className="inspection-toolbar"><input aria-label="筛选监听端口" placeholder="端口、地址或进程" value={filter} onChange={event => setFilter(event.target.value)} /><Button size="sm" variant="light" onPress={() => setRevision(value => value + 1)}>刷新</Button></div>
    {error && <p className="error" role="alert">{error}</p>}{list?.warning && <p className="error">{list.warning}</p>}
    {list && <p className="session-status">{items.length} 个监听端口 · {new Date(list.time).toLocaleTimeString()}{list.truncated && ' · 已截断'} · 进程信息受远端权限限制</p>}
    <div className="inspection-table-scroll"><table className="inspection-table inspection-ports"><thead><tr><th>地址</th><th>协议</th><th>状态</th><th>进程</th><th>操作</th></tr></thead><tbody>{items.map((item, index) => <tr key={`${item.protocol}:${item.address}:${index}`}><td>{item.address}</td><td>{item.protocol}</td><td>{item.state}</td><td>{item.pids?.length ? item.pids.map(pid => <button key={pid} className="inspection-pick" disabled={busy} onClick={() => { setDetails(undefined); void operate(ReadLinuxProcessDetails(workspace, pid), value => setDetails({ pid, value })); }}>PID {pid}</button>) : '未知'}</td><td>{item.protocol === 'tcp' && <Button size="sm" variant="bordered" isDisabled={busy} onPress={() => { const target = ['*', '0.0.0.0'].includes(item.host) ? '127.0.0.1' : item.host === '::' ? '::1' : item.host; setAddress(''); void operate(StartTunnel(workspace, { kind: 'local', bind_host: '127.0.0.1', bind_port: 0, target_host: target, target_port: item.port, allow_public: false }), value => setAddress(value.info.address)); }}>本地转发</Button>}</td></tr>)}</tbody></table></div>
    {details && <section className="inspection-detail"><strong>PID {details.pid}</strong><p className="file-path">{details.value.executable}</p>{details.value.directory && <Button size="sm" variant="light" onPress={() => onDirectory?.(details.value.directory)}>打开目录 {details.value.directory}</Button>}{details.value.service && <Button size="sm" variant="light" onPress={() => onService(details.value.service)}>查看服务 {details.value.service}</Button>}{details.value.errors?.map((message, index) => <p key={index} className="error">{message}</p>)}</section>}
    {address && <div className="button-row"><span className="file-path">{address}</span><Button size="sm" variant="light" onPress={() => { navigator.clipboard.writeText(address).catch(e => setError(errorMessage(e))); }}>复制地址</Button>{['http', 'https'].map(scheme => <Button key={scheme} size="sm" variant="light" onPress={() => { Browser.OpenURL(`${scheme}://${address}`).catch(e => setError(errorMessage(e))); }}>{scheme.toUpperCase()}</Button>)}</div>}
    <form className="inspection-toolbar" onSubmit={event => { event.preventDefault(); setProbe(''); const label = `${source === 'local' ? '本机' : 'SSH 目标'} → ${host}:${port}`; void operate(ProbeNetworkTCP(workspace, source, host, port), elapsed => setProbe(`${label} · TCP 已连通 · ${elapsed.toFixed(1)} ms`)); }}>
      <SelectControl aria-label="TCP 探测来源" disabled={busy} value={source} onChange={event => { setSource(event.target.value); setProbe(''); }}><option value="remote">从 SSH 目标探测</option><option value="local">从本机探测（直连）</option></SelectControl>
      <input aria-label="探测主机" required maxLength={255} value={host} disabled={busy} onChange={event => { setHost(event.target.value); setProbe(''); }} /><input aria-label="探测端口" type="number" min={1} max={65535} required value={port} disabled={busy} onChange={event => { setPort(Number(event.target.value)); setProbe(''); }} /><Button size="sm" type="submit" isLoading={busy} variant="light">TCP 探测</Button>
    </form>{probe && <p role="status">{probe}</p>}
  </>;
}
