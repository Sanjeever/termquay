export function bytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KiB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MiB`;
  return `${(value / 1024 ** 3).toFixed(1)} GiB`;
}
import type { Transfer } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';


export function remaining(seconds: number) {
  if (seconds < 0) return '—';
  if (seconds < 60) return `约剩余 ${seconds} 秒`;
  if (seconds < 3600) return `约剩余 ${Math.ceil(seconds / 60)} 分钟`;
  return `约剩余 ${Math.ceil(seconds / 3600)} 小时`;
}

export function transferState(task: Pick<Transfer, 'state' | 'phase'>) {
  if (task.state === 'running') return ({ preparing: '正在准备', copying: '传输中', finishing: '正在完成', cancelling: '正在取消' } as Record<string, string>)[task.phase] || '传输中';
  return ({ queued: '等待中', done: '已完成', cancelled: '已取消', failed: '失败', skipped: '已跳过' } as Record<string, string>)[task.state] || task.state;
}

export function transferSummary(items: Pick<Transfer, 'state'>[]) {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.state, (counts.get(item.state) || 0) + 1);
  return [['running', '进行中'], ['queued', '等待'], ['done', '完成'], ['skipped', '跳过'], ['failed', '失败'], ['cancelled', '取消']]
    .filter(([state]) => counts.has(state)).map(([state, label]) => `${counts.get(state)} 项${label}`).join(' · ');
}
