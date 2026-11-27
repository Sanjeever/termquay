import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties } from 'react';
import { Button } from '@heroui/react';
import { Events } from '@wailsio/runtime';
import { useTranslation } from 'react-i18next';
import {
  SubscribeMonitor,
  UnsubscribeMonitor,
} from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type {
  Counter,
  Sample,
} from '../../../bindings/github.com/Sanjeever/termquay/internal/monitor/models';
import Icon from '../../components/Icon';
import ResizeHandle from '../../components/layout/ResizeHandle';
import Tooltip from '../../components/Tooltip';
import { currentLocale, t } from '../../i18n';
import { useMessageState } from '../../i18n/useMessageState';
import { errorMessage, eventError } from '../../lib/errors';
import { bytes, rate } from './chartData';
import { createHistory, historyPoints, recordSample, sampleGap, type Point } from './history';
import type { PlotId } from './MonitorCharts';

const MonitorCharts = lazy(() => import('./MonitorCharts'));
const LinuxInspectionDialog = lazy(() => import('./LinuxInspectionDialog'));
const widthKey = 'termquay.layout.monitor-width';
const minWidth = 220;
const maxWidth = 680;

function DeviceDetails({
  items,
  fresh,
  network,
}: {
  items: Counter[] | null | undefined;
  fresh: boolean;
  network?: boolean;
}) {
  if (!items?.length) return null;
  return (
    <details className="monitor-details">
      <summary>{network ? t('monitor:networkInterfaces') : t('monitor:blockDevices')}</summary>
      <dl className="monitor-device-list">
        {items.map((item) => (
          <div key={item.name}>
            <dt>{item.name}</dt>
            <dd>
              {t(network ? 'monitor:downloadRate' : 'monitor:readRate', {
                rate: rate(fresh ? item.read_rate : null),
              })}
            </dd>
            <dd>
              {t(network ? 'monitor:uploadRate' : 'monitor:writeRate', {
                rate: rate(fresh ? item.write_rate : null),
              })}
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

export default function MonitorPanel({
  id,
  visible,
  onClose,
  onDirectory,
  onFile,
  demoSamples,
  leadingDockWidth = 0,
}: {
  id: string;
  visible: boolean;
  onClose(): void;
  onDirectory?(path: string): void;
  onFile?(path: string): Promise<void>;
  demoSamples?: Sample[];
  leadingDockWidth?: number;
}) {
  useTranslation();
  const [sample, setSample] = useState<Sample>();
  const [points, setPoints] = useState<Point[]>([]);
  const [error, setError] = useMessageState('');
  const [retry, setRetry] = useState(0);
  const [now, setNow] = useState(Date.now);
  const [expanded, setExpanded] = useState<PlotId>();
  const [width, setWidth] = useState(() =>
    demoSamples
      ? 260
      : Math.max(minWidth, Math.min(maxWidth, Number(localStorage.getItem(widthKey)) || 260)),
  );
  const [inspection, setInspection] = useState<'cpu' | 'memory' | 'services'>();
  const operations = useRef(Promise.resolve());
  const history = useRef(createHistory());
  const content = useRef<HTMLElement>(null);

  useEffect(() => {
    setInspection(undefined);
    setExpanded(undefined);
  }, [id, visible]);
  useEffect(() => {
    history.current = createHistory();
    for (const entry of demoSamples ?? [])
      recordSample(history.current, entry, Date.parse(entry.time));
    setPoints(historyPoints(history.current));
    const latest = demoSamples?.[demoSamples.length - 1];
    setSample(latest);
    setNow(latest ? Date.parse(latest.time) : Date.now());
  }, [id, demoSamples]);
  useEffect(() => {
    if (demoSamples) return;
    const timer = window.setTimeout(() => localStorage.setItem(widthKey, String(width)), 180);
    return () => clearTimeout(timer);
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
        update.sample ? Date.parse(update.sample.time) : Date.now(),
      );
      setPoints(historyPoints(history.current));
      setSample((previous) => update.sample ?? previous);
      setError(eventError(update));
      setNow(Date.now());
    });
    const subscription = operations.current.then(async () => {
      if (disposed) return false;
      await SubscribeMonitor(id);
      return true;
    });
    const active = subscription.catch((reason) => {
      if (!disposed) setError(reason);
      return false;
    });
    const timer = window.setInterval(() => setNow(Date.now()), 3000);
    return () => {
      disposed = true;
      off();
      clearInterval(timer);
      operations.current = active
        .then(async (subscribed) => {
          if (subscribed) await UnsubscribeMonitor(id);
        })
        .catch((reason) => console.error(reason));
    };
  }, [id, visible, retry, demoSamples, setError]);

  const sampleTime = sample ? Date.parse(sample.time) : undefined;
  const stale = sampleTime !== undefined && now - sampleTime > sampleGap;
  const latest = points[points.length - 1];
  const current = !error && !stale && latest?.time === sampleTime ? latest : undefined;
  const fileSystems = sample?.file_systems;
  const filesystemError = errorMessage(eventError(fileSystems));
  const freshFilesystems =
    !!fileSystems && !filesystemError && now - Date.parse(fileSystems.time) <= 45000;
  const rootFS = freshFilesystems ? fileSystems.items?.find((fs) => fs.target === '/') : undefined;

  return (
    <div
      className={`monitor-dock${expanded ? ' monitor-dock-expanded' : ''}`}
      data-workspace-panel="monitor"
      tabIndex={-1}
      hidden={!visible}
      style={
        {
          '--monitor-width': `${width}px`,
          '--monitor-leading-dock': `${leadingDockWidth}px`,
        } as CSSProperties
      }
    >
      {!expanded && (
        <ResizeHandle
          label={t('monitor:monitoringPanelWidth')}
          value={width}
          min={minWidth}
          max={maxWidth}
          onChange={setWidth}
          reverse
        />
      )}
      <aside ref={content} className="monitor-panel" aria-label={t('monitor:serverMonitoring')}>
        <div className="sidebar-heading">
          <h2>{t('monitor:monitoring')}</h2>
          <button
            type="button"
            className="session-tool"
            disabled={!!demoSamples}
            onClick={() => setInspection('services')}
          >
            {t('monitor:processesAndServices')}
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={t('monitor:collapseMonitoringPanel')}
            onClick={onClose}
          >
            <Icon name="close" width="15" />
          </button>
        </div>
        {error ? (
          <div className="monitor-error">
            <p className="error" role="alert">
              {t('monitor:monitoringCollectionFailed')}
            </p>
            <Button size="sm" variant="bordered" onPress={() => setRetry((v) => v + 1)}>
              {t('monitor:retry')}
            </Button>
            <details>
              <summary>{t('monitor:technicalDetails')}</summary>
              <p className="error">{error}</p>
            </details>
          </div>
        ) : (
          !sample && (
            <p className="muted" role="status">
              {t('monitor:waitingForFirstSample')}
            </p>
          )
        )}
        {visible && points.length > 0 && (
          <Suspense
            fallback={
              <p role="status" className="muted">
                {t('monitor:loadingTrends')}
              </p>
            }
          >
            <MonitorCharts
              key={id}
              points={points}
              current={current}
              expanded={expanded}
              onExpand={(plot) => {
                setExpanded(plot);
                if (plot && content.current) content.current.scrollTop = 0;
              }}
              onInspect={demoSamples ? undefined : setInspection}
            />
          </Suspense>
        )}
        {!expanded && sample && (
          <>
            <details className="monitor-details monitor-capacity">
              <summary>
                <span>{t('monitor:filesystems')}</span>
                <span className="monitor-capacity-value">
                  / {rootFS ? `${bytes(rootFS.used)} / ${bytes(rootFS.size)}` : '—'}
                </span>
                {rootFS && rootFS.size > 0 && (
                  <meter
                    className="monitor-root-meter"
                    min={0}
                    max={rootFS.size}
                    value={rootFS.used}
                    aria-label={t('monitor:rootCapacityUsed')}
                  />
                )}
              </summary>
              {filesystemError ? (
                <p className="error" role="alert">
                  {filesystemError}
                </p>
              ) : (
                fileSystems?.items?.map((fs, index) => (
                  <div className="metric filesystem-metric" key={`${fs.target}:${index}`}>
                    <Tooltip content={`${fs.source} · ${fs.type}`}>
                      <strong>{fs.target}</strong>
                    </Tooltip>
                    <span>{freshFilesystems ? `${bytes(fs.used)} / ${bytes(fs.size)}` : '—'}</span>
                    <span className="muted">
                      {t('monitor:available')}
                      {freshFilesystems ? bytes(fs.available) : '—'}
                    </span>
                  </div>
                ))
              )}
            </details>
            <DeviceDetails items={sample.network} fresh={!!current} network />
            <DeviceDetails items={sample.disks} fresh={!!current} />
          </>
        )}
        {sample && (
          <div className="monitor-status">
            <span>{sample.system}</span>
            <span className={`sample-time ${stale || error ? 'error' : ''}`}>
              {stale || error
                ? t('monitor:sampleExpired')
                : sample.cpu == null
                  ? t('monitor:waitingForIncrementalSample')
                  : t('monitor:updatedAt')}
              {new Date(sample.time).toLocaleTimeString(currentLocale())}
            </span>
          </div>
        )}
        {inspection && visible && !demoSamples && (
          <Suspense
            fallback={
              <p role="status" className="muted">
                {t('monitor:loadingDiagnostics')}
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
