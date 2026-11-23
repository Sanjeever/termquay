import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../../components/Icon';
import { currentLocale, t } from '../../i18n';
import { bytes, percent, rate } from './chartData';
import { historyWindow, type Point } from './history';
import MonitorCanvas, { type Plot } from './MonitorCanvas';

const plots = [
  { id: 'cpu', metrics: ['cpu'], ceiling: 100 },
  { id: 'memory', metrics: ['memory'], ceiling: 100 },
  { id: 'network', metrics: ['networkRead', 'networkWrite'] },
  { id: 'disk', metrics: ['diskRead', 'diskWrite'] },
] satisfies Plot[];
export type PlotId = (typeof plots)[number]['id'];
const detailPlots = new Map(plots.map((plot) => [plot.id, [plot]]));
const minutes = [1, 3, 6] as const;

type Frozen = { points: Point[]; end: number; time?: number };

function plotLabel(id: PlotId) {
  switch (id) {
    case 'cpu':
      return 'CPU';
    case 'memory':
      return t('monitor:memory');
    case 'network':
      return t('monitor:network');
    default:
      return t('monitor:diskIO');
  }
}

function PlotValues({ id, point }: { id: PlotId; point?: Point }) {
  if (id === 'cpu') return <strong>{percent(point?.cpu)}</strong>;
  if (id === 'memory')
    return (
      <div className="monitor-series-values">
        <span className="muted">
          {point?.memoryTotal != null
            ? `${bytes(point.memoryUsed)} / ${bytes(point.memoryTotal)}`
            : '—'}
        </span>
        <strong>{percent(point?.memory)}</strong>
      </div>
    );
  return (
    <div className="monitor-series-values monitor-dual-series">
      <span>
        {id === 'network'
          ? t('monitor:downloadRate', { rate: rate(point?.networkRead) })
          : t('monitor:readRate', { rate: rate(point?.diskRead) })}
      </span>
      <span>
        {id === 'network'
          ? t('monitor:uploadRate', { rate: rate(point?.networkWrite) })
          : t('monitor:writeRate', { rate: rate(point?.diskWrite) })}
      </span>
    </div>
  );
}

export default function MonitorCharts({
  points,
  current,
  expanded,
  onExpand,
  onInspect,
}: {
  points: Point[];
  current?: Point;
  expanded?: PlotId;
  onExpand(id?: PlotId): void;
  onInspect?: (metric: 'cpu' | 'memory') => void;
}) {
  useTranslation();
  const helpId = useId();
  const timeGroup = useId();
  const [duration, setDuration] = useState(historyWindow);
  const [hover, setHover] = useState<number | null>();
  const [frozen, setFrozen] = useState<Frozen>();
  const [zoom, setZoom] = useState<[number, number]>();
  const layout = useRef<HTMLDivElement>(null);
  const previousPlot = useRef<PlotId>();
  const back = useRef<HTMLButtonElement>(null);
  const activePlots = (expanded && detailPlots.get(expanded)) || plots;
  const visiblePoints = frozen?.points ?? points;
  const end = frozen?.end ?? points[points.length - 1]?.time ?? 0;
  const start = end - duration;
  const selectedTime = frozen?.time ?? hover;
  const selected = visiblePoints.find((point) => point.time === selectedTime);
  const readout = selectedTime === undefined && !frozen ? current : selected;
  const locale = currentLocale();

  useLayoutEffect(() => {
    if (expanded) back.current?.focus();
    else if (previousPlot.current)
      layout.current
        ?.querySelector<HTMLButtonElement>(`[data-expand-plot="${previousPlot.current}"]`)
        ?.focus();
    previousPlot.current = expanded;
  }, [expanded]);

  function pin(time?: number) {
    setHover(undefined);
    setFrozen((previous) => ({ points: previous?.points ?? points, end, time }));
  }

  function resume() {
    setHover(undefined);
    setFrozen(undefined);
    setZoom(undefined);
  }

  function selectDuration(value: number) {
    setDuration(value);
    setZoom(undefined);
    setHover(undefined);
    if (frozen?.time !== undefined && frozen.time < end - value)
      setFrozen({ ...frozen, time: undefined });
  }

  function handleKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.defaultPrevented || event.nativeEvent.isComposing) return;
    if (event.key === 'Escape' && (frozen || expanded)) {
      event.preventDefault();
      if (frozen) resume();
      else onExpand();
    }
    if (
      (event.key === 'ArrowLeft' || event.key === 'ArrowRight') &&
      (event.target as HTMLElement).hasAttribute('data-monitor-time')
    ) {
      event.preventDefault();
      const first = start + (expanded && zoom ? (zoom[0] / 100) * duration : 0);
      const last = start + (expanded && zoom ? (zoom[1] / 100) * duration : duration);
      const available = visiblePoints.filter((point) => point.time >= first && point.time <= last);
      const index = available.findIndex((point) => point.time === selectedTime);
      const next =
        (index < 0 ? available.length - 1 : index) + (event.key === 'ArrowLeft' ? -1 : 1);
      const point = available[Math.min(available.length - 1, Math.max(0, next))];
      if (point) pin(point.time);
    }
  }

  return (
    <div className="monitor-charts" onKeyDown={handleKey}>
      {expanded && (
        <button
          ref={back}
          type="button"
          className="session-tool monitor-back"
          onClick={() => onExpand()}
        >
          <Icon name="back" />
          {t('monitor:backToOverview')}
        </button>
      )}
      <div className="monitor-chart-toolbar">
        <fieldset className="monitor-ranges">
          <legend className="sr-only">{t('monitor:timeRange')}</legend>
          {minutes.map((minute) => (
            <label key={minute}>
              <input
                type="radio"
                name={timeGroup}
                value={minute}
                checked={duration === minute * 60_000}
                onChange={() => selectDuration(minute * 60_000)}
                className="sr-only"
              />
              <span>{t('monitor:minutesShort', { value1: minute })}</span>
            </label>
          ))}
        </fieldset>
        <button
          className="session-tool monitor-live"
          type="button"
          data-monitor-time=""
          aria-label={t('monitor:live')}
          aria-pressed={!frozen}
          aria-describedby={helpId}
          onClick={() => (frozen ? resume() : points.length && pin(selectedTime ?? end))}
        >
          {t('monitor:live')}
        </button>
        <span id={helpId} className="sr-only">
          {t('monitor:sampleKeyboardHelp')}
        </span>
      </div>
      <div
        className="monitor-cursor-time"
        aria-live={frozen?.time !== undefined ? 'polite' : 'off'}
      >
        {selected && (
          <time dateTime={new Date(selected.time).toISOString()}>
            {new Date(selected.time).toLocaleTimeString(locale)}
          </time>
        )}
        {frozen && !selected && t('monitor:paused')}
      </div>
      <div
        ref={layout}
        className="monitor-chart-layout"
        data-expanded={!!expanded}
        aria-label={t('monitor:resourceTrends')}
        role="group"
      >
        {activePlots.map(({ id }) => (
          <section key={id} className="monitor-chart-tile" aria-label={plotLabel(id)}>
            <div className="monitor-chart-heading">
              {onInspect && (id === 'cpu' || id === 'memory') ? (
                <button
                  type="button"
                  className="metric-inspect"
                  onClick={() => onInspect(id)}
                  aria-label={t(
                    id === 'cpu'
                      ? 'monitor:viewProcessesUsingTheMostCPU'
                      : 'monitor:viewProcessesUsingTheMostMemory',
                  )}
                >
                  {plotLabel(id)}
                </button>
              ) : (
                <span>{plotLabel(id)}</span>
              )}
              <PlotValues id={id} point={readout} />
              {!expanded && (
                <button
                  type="button"
                  className="icon-button"
                  data-expand-plot={id}
                  aria-label={t('monitor:expandTrend', { metric: plotLabel(id) })}
                  onClick={() => {
                    setZoom(undefined);
                    onExpand(id);
                  }}
                >
                  <Icon name="focus" width="13" height="13" />
                </button>
              )}
            </div>
            <div className="monitor-plot" aria-hidden="true" />
          </section>
        ))}
        <MonitorCanvas
          plots={activePlots}
          points={visiblePoints}
          start={start}
          end={end}
          detailed={!!expanded}
          zoom={expanded ? zoom : undefined}
          locale={locale}
          selectedTime={selected?.time}
          pinned={frozen?.time !== undefined}
          onHover={setHover}
          onPin={pin}
          onZoom={(range) => {
            if (!frozen) pin();
            setZoom(range);
          }}
        />
      </div>
    </div>
  );
}
