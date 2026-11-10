import { eventError, errorMessage } from '../../lib/errors.ts';
import { t as translate, currentLocale } from '../../i18n/index.ts';
import { useMessageState } from '../../i18n/useMessageState.ts';
import { useTranslation } from 'react-i18next';
import Tooltip from '../../components/Tooltip';

import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Button } from '@heroui/react';
import { Events } from '@wailsio/runtime';
import {
  SubscribeMonitor,
  UnsubscribeMonitor,
} from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { Sample } from '../../../bindings/github.com/Sanjeever/termquay/internal/monitor/models';
import ResizeHandle from '../../components/layout/ResizeHandle';
import Icon from '../../components/Icon';
import MonitorTrend from './MonitorTrend';
import { createHistory, historyPoints, recordSample } from './history';

const LinuxInspectionDialog = lazy(() => import('./LinuxInspectionDialog'));

function bytes(value: number | null | undefined) {
  if (value == null) return '—';
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GiB`;
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MiB`;
  return `${(value / 1024).toFixed(1)} KiB`;
}
function rate(value: number | null) {
  return value == null ? '—' : `${bytes(value)}/s`;
}

export default function MonitorPanel({
  id,
  visible,
  onClose,
  onDirectory,
  onFile,
  demoSamples,
}: {
  id: string;
  visible: boolean;
  onClose(): void;
  onDirectory?(path: string): void;
  onFile?(path: string): Promise<void>;
  demoSamples?: Sample[];
}) {
  useTranslation();
  const [sample, setSample] = useState<Sample>();
  const [error, setError] = useMessageState('');
  const [retry, setRetry] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [width, setWidth] = useState(
    demoSamples ? 260 : Number(localStorage.getItem('termquay.layout.monitor-width')) || 260,
  );
  const [inspection, setInspection] = useState<'cpu' | 'memory' | 'services'>();
  useEffect(() => {
    setInspection(undefined);
  }, [id]);
  useEffect(() => {
    if (!visible) setInspection(undefined);
  }, [visible]);
  const operations = useRef(Promise.resolve());
  const history = useRef(createHistory());
  useEffect(() => {
    history.current = createHistory();
    if (demoSamples) {
      for (const sample of demoSamples)
        recordSample(history.current, sample, Date.parse(sample.time));
      const latest = demoSamples[demoSamples.length - 1];
      setSample(latest);
      if (latest) setNow(Date.parse(latest.time));
    } else setSample(undefined);
  }, [id, demoSamples]);
  useEffect(() => {
    if (!demoSamples) localStorage.setItem('termquay.layout.monitor-width', String(width));
  }, [width, demoSamples]);
  useEffect(() => {
    if (!visible || demoSamples) return;
    let disposed = false;
    setSample(undefined);
    setError('');
    setNow(Date.now());
    const off = Events.On('monitor:sample', (event) => {
      const update = event.data as { id: string; sample: Sample | null; error: string };
      if (update.id !== id || disposed) return;
      recordSample(
        history.current,
        update.sample,
        update.sample ? new Date(update.sample.time).getTime() : Date.now(),
      );
      setSample(update.sample || undefined);
      setError(eventError(update));
      setNow(Date.now());
    });
    operations.current = operations.current
      .then(async () => {
        if (!disposed) await SubscribeMonitor(id);
      })
      .catch((e) => {
        if (!disposed) setError(e);
      });
    const timer = window.setInterval(() => setNow(Date.now()), 3000);
    return () => {
      disposed = true;
      off();
      clearInterval(timer);
      operations.current = operations.current
        .then(() => UnsubscribeMonitor(id))
        .catch((e) => {
          if (!disposed) setError(e);
        });
    };
  }, [id, visible, retry, demoSamples]);
  const stale = sample && now - new Date(sample.time).getTime() > 10000;
  const points = historyPoints(history.current);
  return (
    <div className="monitor-dock" hidden={!visible} style={{ width }}>
      <ResizeHandle
        label={translate('monitor:monitoringPanelWidth')}
        value={width}
        min={220}
        max={380}
        onChange={setWidth}
        reverse
      />
      <aside className="monitor-panel" aria-label={translate('monitor:serverMonitoring')}>
        <div className="sidebar-heading">
          <h2>{translate('monitor:monitoring')}</h2>
          <button
            className="session-tool"
            disabled={!!demoSamples}
            onClick={() => setInspection('services')}
          >
            {translate('monitor:processesAndServices')}
          </button>
          <button
            className="icon-button"
            aria-label={translate('monitor:collapseMonitoringPanel')}
            onClick={onClose}
          >
            <Icon name="close" width="15" />
          </button>
        </div>
        {error ? (
          <div className="monitor-error">
            <p className="error" role="alert">
              {translate('monitor:monitoringCollectionFailed')}
            </p>
            <Button size="sm" variant="bordered" onPress={() => setRetry((v) => v + 1)}>
              {translate('monitor:retry')}
            </Button>
            <details>
              <summary>{translate('monitor:technicalDetails')}</summary>
              <p className="error">{error}</p>
            </details>
          </div>
        ) : !sample ? (
          <p className="muted" role="status">
            {translate('monitor:waitingForFirstSample')}
          </p>
        ) : (
          <>
            <p className="system-info">{sample.system}</p>
            <div className="metric">
              <button
                className="metric-inspect"
                aria-label={translate('monitor:viewProcessesUsingTheMostCPU')}
                disabled={!!demoSamples}
                onClick={() => setInspection('cpu')}
              >
                CPU
              </button>
              <strong className="metric-primary">
                {stale || sample.cpu == null ? '—' : `${sample.cpu.toFixed(1)}%`}
              </strong>
              <MonitorTrend
                points={points}
                metrics={['cpu']}
                now={now}
                label={translate('monitor:cPUUsageTrend')}
                ceiling={100}
                format={(value) => `${value}%`}
              />
            </div>
            <div className="metric">
              <button
                className="metric-inspect"
                aria-label={translate('monitor:viewProcessesUsingTheMostMemory')}
                disabled={!!demoSamples}
                onClick={() => setInspection('memory')}
              >
                {translate('monitor:memory')}
              </button>
              <strong className="metric-primary">
                {stale || !sample.memory_total
                  ? '—'
                  : `${(((sample.memory_total - sample.memory_available) / sample.memory_total) * 100).toFixed(1)}%`}
              </strong>
              <span>
                {stale
                  ? '—'
                  : `${bytes(sample.memory_total - sample.memory_available)} / ${bytes(sample.memory_total)}`}
              </span>
              <MonitorTrend
                points={points}
                metrics={['memory']}
                now={now}
                label={translate('monitor:memoryUsageTrend')}
                ceiling={100}
                format={(value) => `${value}%`}
              />
            </div>
            <details className="monitor-details">
              <summary>{translate('monitor:network')}</summary>
              <div className="trend-legend">
                <span>{translate('monitor:received')}</span>
                <span>{translate('monitor:sentDashed')}</span>
              </div>
              <MonitorTrend
                points={points}
                metrics={['networkRead', 'networkWrite']}
                now={now}
                label={translate('monitor:totalNetworkReceiveAndSendRateTrends')}
                format={(value) => rate(value)}
              />
              {sample.network?.map((n) => (
                <div className="metric" key={n.name}>
                  <span>{n.name}</span>
                  <div>↓ {stale ? '—' : rate(n.read_rate)}</div>
                  <div>↑ {stale ? '—' : rate(n.write_rate)}</div>
                </div>
              ))}
            </details>
            <details className="monitor-details">
              <summary>{translate('monitor:diskIO')}</summary>
              <div className="trend-legend">
                <span>{translate('monitor:read')}</span>
                <span>{translate('monitor:writtenDashed')}</span>
              </div>
              <MonitorTrend
                points={points}
                metrics={['diskRead', 'diskWrite']}
                now={now}
                label={translate('monitor:totalDiskReadAndWriteRateTrends')}
                format={(value) => rate(value)}
              />
              {sample.disks?.map((d) => (
                <div className="metric" key={d.name}>
                  <span>{d.name}</span>
                  <div>
                    {translate('monitor:read2')}
                    {stale ? '—' : rate(d.read_rate)}
                  </div>
                  <div>
                    {translate('monitor:written')}
                    {stale ? '—' : rate(d.write_rate)}
                  </div>
                </div>
              ))}
            </details>
            <details className="monitor-details">
              <summary>{translate('monitor:filesystems')}</summary>
              {errorMessage(eventError(sample.file_systems)) ? (
                <p className="error" role="alert">
                  {errorMessage(eventError(sample.file_systems))}
                </p>
              ) : (
                sample.file_systems?.items?.map((fs, index) => (
                  <div className="metric filesystem-metric" key={`${fs.target}:${index}`}>
                    <Tooltip content={`${fs.source} · ${fs.type}`}>
                      <strong>{fs.target}</strong>
                    </Tooltip>
                    <span>
                      {stale || now - new Date(sample.file_systems!.time).getTime() > 45000
                        ? '—'
                        : `${bytes(fs.used)} / ${bytes(fs.size)}`}
                    </span>
                    <span className="muted">
                      {translate('monitor:available')}
                      {stale || now - new Date(sample.file_systems!.time).getTime() > 45000
                        ? '—'
                        : bytes(fs.available)}
                    </span>
                  </div>
                ))
              )}
            </details>
            <div className={`sample-time ${stale ? 'error' : ''}`}>
              {stale
                ? translate('monitor:sampleExpired')
                : sample.cpu == null
                  ? translate('monitor:waitingForIncrementalSample')
                  : translate('monitor:updatedAt')}
              {new Date(sample.time).toLocaleTimeString(currentLocale())}
            </div>
          </>
        )}
        {inspection && visible && !demoSamples && (
          <Suspense
            fallback={
              <p role="status" className="muted">
                {translate('monitor:loadingDiagnostics')}
              </p>
            }
          >
            <LinuxInspectionDialog
              key={id}
              workspace={id}
              initialOrder={inspection}
              onDirectory={onDirectory}
              onFile={onFile}
              onClose={() => setInspection(undefined)}
            />
          </Suspense>
        )}
      </aside>
    </div>
  );
}
