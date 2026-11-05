import { useEffect, useState } from 'react';
import { Button } from '@heroui/react';
import SelectControl from '../../components/SelectControl';
import { GetConnectionFilters } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { ConnectionFilter } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import type { Connection, ConnectionPreference, Group } from '../../../bindings/github.com/Sanjeever/termquay/internal/store/models';
import { catalogConnections } from '../connections/catalog';
import { errorMessage } from '../../lib/errors';

export type CommandTarget = { id: string; name: string; address: string; connection?: Connection; preference?: ConnectionPreference; disconnected?: boolean };
export default function CommandTargets({ targets, groups = [], selected, onChange, busy }: { targets: CommandTarget[]; groups?: Group[]; selected: Set<string>; onChange(value: Set<string>): void; busy: boolean }) {
  const [search, setSearch] = useState('');
  const [environment, setEnvironment] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [saved, setSaved] = useState<ConnectionFilter[]>([]);
  const [scope, setScope] = useState<ConnectionFilter>();
  const [error, setError] = useState('');
  useEffect(() => { let ended = false; const request = GetConnectionFilters(); request.then(values => { if (!ended) setSaved(values || []); }).catch(e => { if (!ended) setError(errorMessage(e)); }); return () => { ended = true; request.cancel(); }; }, []);
  const preferences = Object.fromEntries(targets.filter(target => target.connection).map(target => [target.connection!.id, target.preference]));
  const connections = catalogConnections(targets.flatMap(target => target.connection ? [target.connection] : []), groups, preferences, { view: scope?.view || 'all', group: scope?.group || '', protocol: scope?.protocol || 'all', search, environment, tags, sort: 'name' });
  const visibleIDs = new Set(connections.map(value => value.id));
  const visible = targets.filter(target => target.connection ? visibleIDs.has(target.connection.id) : !scope && !environment && !tags.length && `${target.name} ${target.address}`.toLowerCase().includes(search.toLowerCase()));
  const allTags = [...new Set(targets.flatMap(target => target.preference?.tags || []))].sort();
  return <>
    <div className="button-row"><input aria-label="筛选已连接目标" placeholder="筛选目标" value={search} disabled={busy} onChange={event => setSearch(event.target.value)} /><SelectControl aria-label="目标环境" value={environment} disabled={busy} onChange={event => setEnvironment(event.target.value)}><option value="">全部环境</option><option value="production">生产</option><option value="staging">预发布</option><option value="development">开发</option></SelectControl><SelectControl aria-label="目标标签" value="" disabled={busy} onChange={event => { if (event.target.value) setTags([...tags, event.target.value]); }}><option value="">添加标签筛选</option>{allTags.filter(tag => !tags.includes(tag)).map(tag => <option key={tag}>{tag}</option>)}</SelectControl>{tags.map(tag => <button key={tag} className="session-tool" disabled={busy} onClick={() => setTags(tags.filter(value => value !== tag))}>{tag} ×</button>)}
      {!!saved.length && <SelectControl aria-label="使用保存筛选选择目标" value={scope?.name || ''} disabled={busy} onChange={event => { const item = saved.find(value => value.name === event.target.value); setScope(item); setSearch(item?.search || ''); setEnvironment(item?.environment || ''); setTags(item?.tags || []); }}><option value="">保存的筛选</option>{saved.map(item => <option key={item.name}>{item.name}</option>)}</SelectControl>}
      <Button size="sm" variant="light" isDisabled={busy || !visible.length} onPress={() => onChange(new Set([...selected, ...visible.map(value => value.id)]))}>选中筛选结果</Button><Button size="sm" variant="light" isDisabled={busy || !selected.size} onPress={() => onChange(new Set())}>清空选择（{selected.size}）</Button>
    </div>{error && <p className="error" role="alert">{error}</p>}
    <div className="batch-targets">{targets.filter(target => visible.includes(target) || selected.has(target.id)).map(target => <label key={target.id}><input type="checkbox" disabled={busy} checked={selected.has(target.id)} onChange={event => { const next = new Set(selected); if (event.target.checked) next.add(target.id); else next.delete(target.id); onChange(next); }} /><span>{target.name}{target.disconnected && ' · 未连接'}{target.preference?.environment && <strong className={`connection-environment ${target.preference.environment}`}>{({ production: '生产', staging: '预发布', development: '开发' } as Record<string, string>)[target.preference.environment] || target.preference.environment}</strong>}<small className="muted">{target.address}</small></span></label>)}{!targets.length && <p className="muted">暂无 SSH 目标</p>}</div>
    {!!selected.size && <div className="button-row" role="status">{['production', 'staging', 'development', ''].map(environment => { const count = targets.filter(target => selected.has(target.id) && (target.preference?.environment || '') === environment).length; return count ? <span key={environment} className={environment === 'production' ? 'error' : 'muted'}>{({ production: '生产', staging: '预发布', development: '开发' } as Record<string, string>)[environment] || '未设置环境'} {count} 台</span> : null; })}</div>}
  </>;
}
