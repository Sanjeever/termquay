import { t as translate } from '../../i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { historyWindow, trendSegments, type Metric, type Point } from './history';

export default function MonitorTrend({ points, metrics, now, label, ceiling, format }: { points: Point[]; metrics: Metric[]; now: number; label: string; ceiling?: number; format(value: number): string }) {
  useTranslation();
  const series = metrics.map(metric => trendSegments(points, metric, now));
  const maximum = ceiling ?? Math.max(1, ...series.flat(2).map(point => point.value));
  const x = (time: number) => 2 + 236 * (1 - (now - time) / historyWindow);
  const y = (value: number) => 42 - 36 * Math.min(1, value / maximum);
  return <div className="monitor-trend"><span className="trend-scale">{format(maximum)}</span><svg viewBox="0 0 240 46" preserveAspectRatio="none" role="img" aria-label={translate('monitor:lastSixMinutes', { value1: label })}>
    <path className="trend-baseline" d="M2 42H238" />
    {series.map((segments, index) => <g key={metrics[index]} className={`trend-series trend-series-${index}`}>
      {segments.map((segment, part) => segment.length === 1 ? <circle key={part} cx={x(segment[0].time)} cy={y(segment[0].value)} r="1.5" /> : <path key={part} d={segment.map((point, i) => `${i ? 'L' : 'M'}${x(point.time).toFixed(1)} ${y(point.value).toFixed(1)}`).join(' ')} />)}
    </g>)}
  </svg></div>;
}
