import { useEffect, useState } from 'react';
import { ReadContainerStats } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { Stats } from '../../../bindings/github.com/Sanjeever/termquay/internal/docker/models';
import { errorMessage } from '../../lib/errors';
import { bytes } from '../files/transferFormat';

export default function ContainerResources({ workspace, socket, id, active }: { workspace: string; socket: string; id: string; active: boolean }) {
  const [stats, setStats] = useState<Stats>();
  const [error, setError] = useState('');
  useEffect(() => {
    setStats(undefined); setError(''); if (!active) return;
    let ended = false, timer: ReturnType<typeof setTimeout>;
    let pending: ReturnType<typeof ReadContainerStats>;
    async function sample() {
      pending = ReadContainerStats(workspace, socket, id);
      try { const value = await pending; if (!ended) { setStats(value); setError(''); } }
      catch (e) { if (!ended) { setStats(undefined); setError(errorMessage(e)); } }
      finally { if (!ended) timer = setTimeout(sample, 3000); }
    }
    void sample(); return () => { ended = true; clearTimeout(timer); pending?.cancel(); };
  }, [workspace, socket, id, active]);
  if (!active) return null;
  const amount = (value: number | null | undefined) => value == null ? '—' : bytes(value);
  return <section aria-label="容器资源"><h3>资源</h3>{error && <p className="error" role="alert">{error}</p>}<dl className="inspection-properties"><div><dt>CPU</dt><dd>{stats?.cpu == null ? '—' : `${stats.cpu.toFixed(1)}%`}</dd></div><div><dt>内存（含缓存）</dt><dd>{amount(stats?.memory)} / {amount(stats?.memory_limit)}</dd></div><div><dt>网络累计接收 / 发送</dt><dd>{amount(stats?.network_read)} / {amount(stats?.network_write)}</dd></div><div><dt>磁盘累计读取 / 写入</dt><dd>{amount(stats?.disk_read)} / {amount(stats?.disk_write)}</dd></div></dl>{stats && <p className="session-status">采样于 {new Date(stats.time).toLocaleTimeString()}</p>}</section>;
}
