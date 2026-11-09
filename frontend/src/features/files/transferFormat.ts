import { t as translate } from '../../i18n/index.ts';
import type { Transfer } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';

export function bytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KiB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MiB`;
  return `${(value / 1024 ** 3).toFixed(1)} GiB`;
}

export function remaining(seconds: number) {
  if (seconds < 0) return '—';
  if (seconds < 60) return translate('files:aboutSecondsRemaining', { value1: seconds });
  if (seconds < 3600) return translate('files:aboutMinutesRemaining', { value1: Math.ceil(seconds / 60) });
  return translate('files:aboutHoursRemaining', { value1: Math.ceil(seconds / 3600) });
}

export function transferState(task: Pick<Transfer, 'state' | 'phase'>) {
  if (task.state === 'running') return ({ preparing: translate('files:preparing'), copying: translate('files:transferring'), finishing: translate('files:finishing'), cancelling: translate('files:canceling') } as Record<string, string>)[task.phase] || translate('files:transferring');
  return ({ queued: translate('files:queued'), done: translate('files:stateDone'), cancelled: translate('files:canceled'), failed: translate('files:failed'), skipped: translate('files:skipped') } as Record<string, string>)[task.state] || task.state;
}

export function transferSummary(items: Pick<Transfer, 'state'>[]) {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.state, (counts.get(item.state) || 0) + 1);
  const labels = {
    running: (count: number) => translate('files:summaryRunning', { count }),
    queued: (count: number) => translate('files:summaryQueued', { count }),
    done: (count: number) => translate('files:summaryDone', { count }),
    skipped: (count: number) => translate('files:summarySkipped', { count }),
    failed: (count: number) => translate('files:summaryFailed', { count }),
    cancelled: (count: number) => translate('files:summaryCanceled', { count }),
  };
  return (Object.keys(labels) as (keyof typeof labels)[]).filter(state => counts.has(state)).map(state => labels[state](counts.get(state)!)).join(' · ');
}
