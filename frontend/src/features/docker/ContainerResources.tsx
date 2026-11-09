import { t as translate, currentLocale } from '../../i18n/index.ts';
import { useMessageState } from '../../i18n/useMessageState.ts';
import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import { ReadContainerStats } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { Stats } from '../../../bindings/github.com/Sanjeever/termquay/internal/docker/models';

import { bytes } from '../files/transferFormat';

export default function ContainerResources({ workspace, socket, id, active, refresh = 0 }: { workspace: string; socket: string; id: string; active: boolean; refresh?: number }) {
  useTranslation();
  const [stats, setStats] = useState<Stats>();
  const [error, setError] = useMessageState('');
  useEffect(() => { setStats(undefined); setError(''); }, [workspace, socket, id]);
  useEffect(() => {
    if (!active) return;
    let ended = false, timer: ReturnType<typeof setTimeout>;
    let pending: ReturnType<typeof ReadContainerStats>;
    async function sample() {
      pending = ReadContainerStats(workspace, socket, id);
      try { const value = await pending; if (!ended) { setStats(value); setError(''); timer = setTimeout(sample, 3000); } }
      catch (e) { if (!ended) { setStats(undefined); setError(e); } }
    }
    void sample(); return () => { ended = true; clearTimeout(timer); pending?.cancel(); };
  }, [workspace, socket, id, active, refresh]);
  const amount = (value: number | null | undefined) => value == null ? '—' : bytes(value);
  return <section aria-label={translate('docker:containerResources')}><h3>{translate('docker:resources')}</h3>{error && <p className="error" role="alert">{error}</p>}<dl className="docker-properties"><div><dt>CPU</dt><dd>{stats?.cpu == null ? '—' : `${stats.cpu.toFixed(1)}%`}</dd></div><div><dt>{translate('docker:memoryIncludingCache')}</dt><dd>{amount(stats?.memory)} / {amount(stats?.memory_limit)}</dd></div><div><dt>{translate('docker:networkTotalReceivedSent')}</dt><dd>{amount(stats?.network_read)} / {amount(stats?.network_write)}</dd></div><div><dt>{translate('docker:diskTotalReadWritten')}</dt><dd>{amount(stats?.disk_read)} / {amount(stats?.disk_write)}</dd></div></dl>{stats && <p className="session-status">{translate('docker:sampledAt')}{new Date(stats.time).toLocaleTimeString(currentLocale())}</p>}</section>;
}
