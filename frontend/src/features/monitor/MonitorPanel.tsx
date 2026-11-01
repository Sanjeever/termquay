import { useEffect, useState } from 'react';
import { Events } from '@wailsio/runtime';
import { SubscribeMonitor, UnsubscribeMonitor } from '../../../bindings/github.com/Sanjeever/termquay/appservice';
import type { Sample } from '../../../bindings/github.com/Sanjeever/termquay/internal/monitor/models';

function bytes(value: number | null | undefined) { if (value == null) return '—'; if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GiB`; if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MiB`; return `${(value / 1024).toFixed(1)} KiB`; }
function rate(value: number | null) { return value == null ? '—' : `${bytes(value)}/s`; }

export default function MonitorPanel({ id }: { id: string }) {
  const [sample, setSample] = useState<Sample>();
  const [error, setError] = useState('');
  useEffect(() => {
    let disposed = false;
    const unsubscribe = Events.On('monitor:sample', (event) => {
      const update = event.data as { id: string; sample: Sample | null; error: string };
      if (update.id !== id) return;
      setSample(update.sample || undefined); setError(update.error);
    });
    SubscribeMonitor(id).then(() => { if (disposed) UnsubscribeMonitor(id).catch(() => {}); }).catch((e) => { if (!disposed) setError(String(e)); });
    return () => { disposed = true; unsubscribe(); UnsubscribeMonitor(id).catch(() => {}); };
  }, [id]);
  return <aside className="monitor-panel">
    <div className="panel-heading">服务器监控</div>
    {error && <p className="error" role="alert">{error}</p>}
    {sample && <>
      <p className="system-info">{sample.system}</p>
      <div className="metric"><span>CPU</span><strong>{sample.cpu == null ? '—' : `${sample.cpu.toFixed(1)}%`}</strong>{sample.cpu != null && <meter value={sample.cpu} min={0} max={100} aria-label="CPU 使用率" />}</div>
      <div className="metric"><span>内存</span><strong>{bytes(sample.memory_total - sample.memory_available)} / {bytes(sample.memory_total)}</strong><meter value={sample.memory_total - sample.memory_available} min={0} max={sample.memory_total} aria-label="内存使用量" /></div>
      <h3>网络</h3>{sample.network.map((n) => <div className="metric" key={n.name}><span>{n.name}</span><div>↓ {rate(n.read_rate)}</div><div>↑ {rate(n.write_rate)}</div></div>)}
      <h3>磁盘 I/O</h3>{sample.disks.map((d) => <div className="metric" key={d.name}><span>{d.name}</span><div>读 {rate(d.read_rate)}</div><div>写 {rate(d.write_rate)}</div></div>)}
      <div className="sample-time">{new Date(sample.time).toLocaleTimeString()}</div>
    </>}
  </aside>;
}
