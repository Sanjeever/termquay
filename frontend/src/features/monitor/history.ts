import type {
  Counter,
  Sample,
} from '../../../bindings/github.com/Sanjeever/termquay/internal/monitor/models';

export const historyLimit = 120;
export const historyWindow = 6 * 60 * 1000;
export const sampleGap = 10000;
export type Metric = 'cpu' | 'memory' | 'networkRead' | 'networkWrite' | 'diskRead' | 'diskWrite';
export type Point = { time: number } & Record<Metric, number | null>;
export type History = { buffer: Point[]; next: number; size: number };

export function createHistory(): History {
  return { buffer: [], next: 0, size: 0 };
}

export function recordSample(history: History, sample: Sample | null, time: number) {
  const latest = history.buffer[(history.next + historyLimit - 1) % historyLimit];
  if (latest && time <= latest.time) return;
  const total = (items: Counter[] | null | undefined, direction: 'read_rate' | 'write_rate') => {
    if (!items?.length || items.some((item) => item[direction] == null)) return null;
    return items.reduce((sum, item) => sum + item[direction]!, 0);
  };
  history.buffer[history.next] = {
    time,
    cpu: sample?.cpu ?? null,
    memory:
      sample && sample.memory_total > 0
        ? (100 * (sample.memory_total - sample.memory_available)) / sample.memory_total
        : null,
    networkRead: total(sample?.network, 'read_rate'),
    networkWrite: total(sample?.network, 'write_rate'),
    diskRead: total(sample?.disks, 'read_rate'),
    diskWrite: total(sample?.disks, 'write_rate'),
  };
  history.next = (history.next + 1) % historyLimit;
  history.size = Math.min(history.size + 1, historyLimit);
}

export function historyPoints(history: History): Point[] {
  return Array.from(
    { length: history.size },
    (_, index) =>
      history.buffer[(history.next - history.size + historyLimit + index) % historyLimit],
  );
}

export function trendSegments(
  points: Point[],
  metric: Metric,
  now: number,
): { time: number; value: number }[][] {
  const segments: { time: number; value: number }[][] = [];
  let previous: Point | undefined;
  let segment: { time: number; value: number }[] | undefined;
  for (const point of points) {
    const value = point[metric];
    if (
      point.time < now - historyWindow ||
      point.time > now ||
      value == null ||
      !Number.isFinite(value) ||
      value < 0
    ) {
      segment = undefined;
      previous = undefined;
      continue;
    }
    if (!segment || !previous || point.time - previous.time > sampleGap) {
      segment = [];
      segments.push(segment);
    }
    segment.push({ time: point.time, value });
    previous = point;
  }
  return segments;
}
