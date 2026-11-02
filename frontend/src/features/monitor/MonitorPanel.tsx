import { useEffect, useRef, useState } from 'react';
import { Button } from '@heroui/react';
import { Events } from '@wailsio/runtime';
import { SubscribeMonitor, UnsubscribeMonitor } from '../../../bindings/github.com/Sanjeever/termquay/appservice';
import type { Sample } from '../../../bindings/github.com/Sanjeever/termquay/internal/monitor/models';
import ResizeHandle from '../../components/layout/ResizeHandle';
import Icon from '../../components/Icon';

function bytes(value: number | null | undefined) { if (value == null) return '—'; if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GiB`; if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MiB`; return `${(value / 1024).toFixed(1)} KiB`; }
function rate(value: number | null) { return value == null ? '—' : `${bytes(value)}/s`; }

export default function MonitorPanel({ id, visible, onClose }: { id: string; visible: boolean; onClose(): void }) {
  const [sample, setSample] = useState<Sample>();
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [width, setWidth] = useState(Number(localStorage.getItem('termquay.layout.monitor-width')) || 260);
  const operations = useRef(Promise.resolve());
  useEffect(() => { localStorage.setItem('termquay.layout.monitor-width', String(width)); }, [width]);
  useEffect(() => {
    if (!visible) return;
    let disposed = false; setSample(undefined); setError(''); setNow(Date.now());
    const off = Events.On('monitor:sample', event => { const update = event.data as { id: string; sample: Sample | null; error: string }; if (update.id !== id || disposed) return; setSample(update.sample || undefined); setError(update.error); setNow(Date.now()); });
    operations.current = operations.current.then(async () => { if (!disposed) await SubscribeMonitor(id); }).catch(e => { if (!disposed) setError(String(e)); });
    const timer = window.setInterval(() => setNow(Date.now()), 3000);
    return () => { disposed = true; off(); clearInterval(timer); operations.current = operations.current.then(() => UnsubscribeMonitor(id)).catch(e => { if (!disposed) setError(String(e)); }); };
  }, [id, visible, retry]);
  const stale = sample && now - new Date(sample.time).getTime() > 10000;
  return <div className="monitor-dock" hidden={!visible} style={{ width }}><ResizeHandle label="监控面板宽度" value={width} min={220} max={380} onChange={setWidth} reverse /><aside className="monitor-panel" aria-label="服务器监控">
    <div className="sidebar-heading"><h2>监控</h2><button className="icon-button" aria-label="收起监控面板" onClick={onClose}><Icon name="close" width="15" /></button></div>
    {error ? <div className="monitor-error"><p className="error" role="alert">监控采集失败</p><Button size="sm" variant="bordered" onPress={() => setRetry(v => v + 1)}>重试</Button><details><summary>技术详情</summary><p className="error">{error}</p></details></div> : !sample ? <p className="muted" role="status">等待首次采样…</p> : <>
      <p className="system-info">{sample.system}</p>
      <div className="metric"><span>CPU</span><strong className="metric-primary">{stale || sample.cpu == null ? '—' : `${sample.cpu.toFixed(1)}%`}</strong>{!stale && sample.cpu != null && <meter value={sample.cpu} min={0} max={100} aria-label="CPU 使用率" />}</div>
      <div className="metric"><span>内存</span><strong>{stale ? '—' : `${bytes(sample.memory_total - sample.memory_available)} / ${bytes(sample.memory_total)}`}</strong>{!stale && <meter value={sample.memory_total - sample.memory_available} min={0} max={sample.memory_total} aria-label="内存使用量" />}</div>
      <details className="monitor-details"><summary>网络</summary>{sample.network?.map(n => <div className="metric" key={n.name}><span>{n.name}</span><div>↓ {stale ? '—' : rate(n.read_rate)}</div><div>↑ {stale ? '—' : rate(n.write_rate)}</div></div>)}</details>
      <details className="monitor-details"><summary>磁盘 I/O</summary>{sample.disks?.map(d => <div className="metric" key={d.name}><span>{d.name}</span><div>读 {stale ? '—' : rate(d.read_rate)}</div><div>写 {stale ? '—' : rate(d.write_rate)}</div></div>)}</details>
      <details className="monitor-details"><summary>文件系统</summary>{sample.file_systems?.error ? <p className="error" role="alert">{sample.file_systems.error}</p> : sample.file_systems?.items?.map((fs, index) => <div className="metric filesystem-metric" key={`${fs.target}:${index}`}><strong title={`${fs.source} · ${fs.type}`}>{fs.target}</strong><span>{stale || now - new Date(sample.file_systems!.time).getTime() > 45000 ? '—' : `${bytes(fs.used)} / ${bytes(fs.size)}`}</span><span className="muted">可用 {stale || now - new Date(sample.file_systems!.time).getTime() > 45000 ? '—' : bytes(fs.available)}</span></div>)}</details>
      <div className={`sample-time ${stale ? 'error' : ''}`}>{stale ? '样本已过期 · ' : sample.cpu == null ? '等待增量采样 · ' : '更新于 '}{new Date(sample.time).toLocaleTimeString()}</div>
    </>}
  </aside></div>;
}
