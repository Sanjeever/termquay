import { sampleGap, type Metric, type Point } from './history';

export function chartSeries(points: Point[], metric: Metric): [number, number | null][] {
  const result: [number, number | null][] = [];
  let previous: Point | undefined;
  for (const point of points) {
    if (previous && point.time - previous.time > sampleGap)
      result.push([previous.time + sampleGap, null]);
    const value = point[metric];
    result.push([point.time, value != null && Number.isFinite(value) && value >= 0 ? value : null]);
    previous = point;
  }
  return result;
}

export function nearestSample(points: Point[], time: number) {
  let nearest: Point | undefined;
  for (const point of points) {
    if (!nearest || Math.abs(point.time - time) < Math.abs(nearest.time - time)) nearest = point;
    if (point.time >= time) break;
  }
  return nearest && Math.abs(nearest.time - time) <= sampleGap / 2 ? nearest : undefined;
}

export function seriesCeiling(points: Point[], metrics: Metric[], start: number, end: number) {
  let peak = 1;
  for (const point of points) {
    if (point.time < start || point.time > end) continue;
    for (const metric of metrics) peak = Math.max(peak, point[metric] ?? 0);
  }
  const magnitude = 10 ** Math.floor(Math.log10(peak));
  const normalized = peak / magnitude;
  return magnitude * (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10);
}

export function bytes(value: number | null | undefined) {
  if (value == null) return '—';
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GiB`;
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MiB`;
  return `${(value / 1024).toFixed(1)} KiB`;
}

export function rate(value: number | null | undefined) {
  return value == null ? '—' : `${bytes(value)}/s`;
}

export function percent(value: number | null | undefined) {
  return value == null ? '—' : `${value.toFixed(1)}%`;
}
