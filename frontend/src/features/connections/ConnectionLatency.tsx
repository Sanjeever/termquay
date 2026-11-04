import Tooltip from '../../components/Tooltip';
import type useConnectionLatency from './useConnectionLatency';
import Icon from '../../components/Icon';

export default function ConnectionLatency({ name, measurement, onRefresh, demo = false }: {
  name: string; measurement: ReturnType<typeof useConnectionLatency>['measurements'][string]; onRefresh(): void;
  demo?: boolean;
}) {
  const result = measurement?.result;
  const milliseconds = result && (result.milliseconds < 1 ? Math.max(0.1, Math.round(result.milliseconds * 10) / 10) : Math.round(result.milliseconds));
  const label = result?.status === 'ok' ? `${milliseconds} ms` : result?.status === 'timeout' ? '探测超时' : result?.status === 'jump_required' ? '需连接跳板' : result ? '探测失败' : '—';
  const tone = result?.status === 'ok' ? milliseconds! < 100 ? 'fast' : milliseconds! < 300 ? 'moderate' : 'slow' : result?.status === 'jump_required' ? 'unknown' : result ? 'slow' : 'unknown';
  const title = ['TCP 建连耗时，包含 DNS 解析及配置路径中的代理或跳板通信', result?.error, measurement?.checkedAt && `上次测量 ${new Date(measurement.checkedAt).toLocaleTimeString()}`, measurement?.refreshing ? '正在刷新' : '点击刷新此连接'].filter(Boolean).join('\n');
  return <Tooltip content={demo?'演示样本':title}><button className={`connection-latency latency-${tone}`} aria-label={`${name} 延迟 ${label}${demo?'，演示样本':'，点击刷新'}`} aria-busy={measurement?.refreshing || undefined} aria-disabled={demo} draggable={false} onDragStart={event => { event.preventDefault(); event.stopPropagation(); }} onClick={event => { event.stopPropagation(); if(!demo)onRefresh(); }} onDoubleClick={event => event.stopPropagation()}>
    <Icon name="refresh" width="11" height="11" className={measurement?.refreshing ? 'latency-refreshing' : 'latency-idle'} /><span>{label}</span>
  </button></Tooltip>;
}
