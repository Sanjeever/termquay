import Tooltip from '../../components/Tooltip';
import { errorMessage } from "../../lib/errors";
import SelectControl from '../../components/SelectControl';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { GetConnectionFilters, SaveConnectionFilters } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { ConnectionFilter } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import { Button, DropdownTrigger, DropdownMenu, DropdownItem, Input, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@heroui/react';
import { Dropdown } from '../../components/Popover';
import { DeleteConnection, DuplicateConnection, SetConnectionPreference, ClearRecentConnections, SaveGroup, DeleteGroup, MoveConnectionsToGroup, MoveGroup } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { Connection, ConnectionPreference, Group } from '../../../bindings/github.com/Sanjeever/termquay/internal/store/models';
import Icon from '../../components/Icon';
import ErrorNotice from '../../components/ErrorNotice';
import ImportConnectionsDialog from './ImportConnectionsDialog';
import { catalogConnections, type CatalogSort } from './catalog';
import { selectItems } from '../../lib/selection';
import CredentialAssignDialog from './CredentialAssignDialog';
import type { LocalShell } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import useConnectionLatency from './useConnectionLatency';
import ConnectionLatency from './ConnectionLatency';

export default function ConnectionCenter({ connections, groups, preferences, sessions, onOpen, onEdit, onNew, onReload, onPlaybook, onMultiHost, busy, loading, loadError, systemRDP, shells, onLocal, active, demoLatency }: {
  connections: Connection[]; groups: Group[]; onOpen(c: Connection, another?: boolean, client?: string): void; onEdit(c: Connection): void; onNew(temporary: boolean): void; onReload(): void; busy: boolean;
  preferences: Record<string, ConnectionPreference | undefined>; sessions: Record<string,string[]>;
  loading: boolean; loadError: string; systemRDP: boolean;
  onPlaybook?(connection: Connection): void;
  onMultiHost?(connections: string[]): void;
  shells: LocalShell[]; onLocal(kind:string):void;
  active: boolean;
  demoLatency?: ReturnType<typeof useConnectionLatency>['measurements'];
}) {
  const demo = demoLatency !== undefined;
  const [search, setSearch] = useState('');
  const [protocol, setProtocol] = useState('all');
  const [environment, setEnvironment] = useState('');
  const [tag, setTag] = useState('');
  const [filters, setFilters] = useState<ConnectionFilter[]>([]);
  const [filterName, setFilterName] = useState('');
  const [savingFilter, setSavingFilter] = useState(false);
  const [filterLoaded, setFilterLoaded] = useState(false);
  const [saveFilterOpen, setSaveFilterOpen] = useState(false);
  const [view, setView] = useState('all');
  const [group, setGroup] = useState('');
  const [sort, setSort] = useState<CatalogSort>('name');
  const [descending, setDescending] = useState(false);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [selected, setSelected] = useState('');
  const [selection, setSelection] = useState<string[]>([]);
  const anchor = useRef('');
  const [moveOpen, setMoveOpen] = useState(false);
  const [credentialTargets,setCredentialTargets]=useState<Connection[]>();
  const [dropTarget, setDropTarget] = useState('');
  const [error, setError] = useState('');
  const [groupDialog, setGroupDialog] = useState<{ value?: Group }>();
  const [deleting, setDeleting] = useState<{ id: string; name: string; group?: boolean }>();
  const [working, setWorking] = useState(false);
  const [importOpen,setImportOpen]=useState(false);
  const [duplicating, setDuplicating] = useState<Connection>();
  const [includeCredentials, setIncludeCredentials] = useState(false);
  const [menu, setMenu] = useState('');
  const [groupMenu, setGroupMenu] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const query = useDeferredValue(search);
  const selectedTags = tag.split(',').filter(Boolean);
  const visible = useMemo(() => catalogConnections(connections, groups, preferences, { view, group, protocol, search: query, sort, descending, environment, tags: tag.split(',').filter(Boolean) }), [connections, groups, preferences, view, group, protocol, query, sort, descending, environment, tag]);
  const latency = useConnectionLatency(connections, active && !demo && !loading && !loadError, demo ? [] : visible);
  const tags = [...new Set(Object.values(preferences).flatMap(value => value?.tags || []))].sort((a,b) => a.localeCompare(b, 'zh-CN'));
  useEffect(() => {
    if (demo || loading || loadError) return;
    let ended = false; const request = GetConnectionFilters();
    request.then(values => { if (!ended) { setFilters(values || []); setFilterLoaded(true); } }).catch(e => { if (!ended) setError(errorMessage(e)); });
    return () => { ended = true; request.cancel(); };
  }, [demo, loading, loadError]);
  async function saveFilters(next: ConnectionFilter[]) {
    setSavingFilter(true); setError('');
    try { await SaveConnectionFilters(next); setFilters(next); setSaveFilterOpen(false); }
    catch (e) { setError(errorMessage(e)); }
    finally { setSavingFilter(false); }
  }
  const selectedSet = new Set(selection);
  const groupChildren = useMemo(() => {
    const children = new Map<string, Group[]>();
    for (const group of groups) { const siblings = children.get(group.parent_id) || []; siblings.push(group); children.set(group.parent_id, siblings); }
    for (const siblings of children.values()) siblings.sort((a, b) => a.sort_order - b.sort_order);
    return children;
  }, [groups]);
  const selectedIDs = visible.filter(c => selectedSet.has(c.id)).map(c=>c.id);
  const selectedConnection = selectedIDs.length === 1 ? visible.find(c => c.id === selectedIDs[0]) : undefined;
  function pick(id: string, toggle = false, range = false) { setSelection(prev=>selectItems(visible.map(c=>c.id),prev,id,anchor.current,toggle,range)); setSelected(id); if (!range) anchor.current=id; }
  const scopeName = group ? group === 'ungrouped' ? '未分组' : groups.find(g => g.id === group)?.name || '分组' : view === 'favorite' ? '收藏' : view === 'recent' ? '最近连接' : '全部连接';
  function scope(nextView: string, nextGroup = '') { setView(nextView); setGroup(nextGroup); setSelected(''); setSelection([]); if (nextView === 'recent') { setSort('recent'); setDescending(false); } }
  function sortBy(next: CatalogSort) { setSort(next); setDescending(next === sort ? !descending : false); }
  function sortHeading(value: CatalogSort, label: string, className = '') { return <button className={`catalog-column-sort ${className}`} aria-label={`按${label}${sort === value && !descending ? '降序' : '升序'}排列`} aria-pressed={sort === value} onClick={() => sortBy(value)}>{label}{sort === value && <Icon name="chevron" width="10" height="10" style={{ transform: descending ? 'rotate(-90deg)' : 'rotate(90deg)' }} />}</button>; }
  async function move(ids: string[], target: string) { if(working||demo)return;setWorking(true);setError('');try{await MoveConnectionsToGroup(ids,target);setMoveOpen(false);setSelection([]);onReload();}catch(e){setError(errorMessage(e));}finally{setWorking(false);} }
  async function moveGroup(id: string, parent: string, before = '') { if(working||demo)return;setWorking(true);setError('');try{await MoveGroup(id,parent,before);onReload();}catch(e){setError(errorMessage(e));}finally{setWorking(false);} }
  function dragOver(e: React.DragEvent, target: string) { if(demo)return;if(e.dataTransfer.types.some(t=>['application/x-termquay-connections','application/x-termquay-group'].includes(t))){e.preventDefault();e.stopPropagation();e.dataTransfer.dropEffect='move';setDropTarget(target);} }
  function drop(e: React.DragEvent, target: string) { e.preventDefault();e.stopPropagation();if(demo)return;setDropTarget('');const source=e.dataTransfer.getData('application/x-termquay-group');if(source){const g=groups.find(g=>g.id===target);void moveGroup(source,e.shiftKey&&g?g.parent_id:target,e.shiftKey&&g?g.id:'');return;}try{const ids=JSON.parse(e.dataTransfer.getData('application/x-termquay-connections'));if(!Array.isArray(ids)||!ids.every(id=>typeof id==='string'))throw new Error('拖动连接数据无效');void move(ids,target);}catch(error){setError(errorMessage(error));} }
  async function preference(id: string, favorite: boolean, environment: string) { if(demo)return;setError(''); try { await SetConnectionPreference(id, favorite, environment); onReload(); } catch (e) { setError(errorMessage(e)); } }

  function tree(parent: string, depth = 0): React.ReactNode {
    return (groupChildren.get(parent) || []).map(g => <div key={g.id}>
      <div draggable={!working&&!demo} onDragStart={e=>{e.stopPropagation();e.dataTransfer.setData('application/x-termquay-group',g.id);e.dataTransfer.effectAllowed='move';}} onDragOver={e=>dragOver(e,g.id)} onDragLeave={()=>setDropTarget('')} onDrop={e=>drop(e,g.id)} className={`group-row ${group === g.id ? 'selected' : ''} ${dropTarget===g.id?'drop-target':''}`} style={{ paddingLeft: 8 + depth * 12 }} onContextMenu={e => { e.preventDefault(); scope('all',g.id); if(!demo)setGroupMenu(g.id); }} onKeyDown={e => { if (e.nativeEvent.isComposing||demo) return; if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); setGroupMenu(g.id); } }}>
        {groupChildren.has(g.id) ? <button className="group-expand" aria-label={`${collapsed.includes(g.id) ? '展开' : '收起'}分组 ${g.name}`} aria-expanded={!collapsed.includes(g.id)} onClick={() => setCollapsed(prev => prev.includes(g.id) ? prev.filter(id => id !== g.id) : [...prev, g.id])}><Icon name="chevron" width="11" height="11" style={{ transform: collapsed.includes(g.id) ? undefined : 'rotate(90deg)' }} /></button> : <span className="group-expand" aria-hidden="true" />}
        <Tooltip content={g.name}><button className="group-name" aria-current={group === g.id ? 'page' : undefined} onClick={() => scope('all', g.id)}><Icon name="files" width="15" height="15" /><span>{g.name}</span></button></Tooltip>
        <Dropdown isOpen={groupMenu === g.id} onOpenChange={open => setGroupMenu(open ? g.id : '')}><DropdownTrigger><button className="icon-button row-menu" disabled={working||demo} aria-label={`分组 ${g.name} 操作`}><Icon name="more" width="14" /></button></DropdownTrigger><DropdownMenu aria-label={`分组 ${g.name} 操作`} onAction={key => {
          if(demo)return;
          setError(''); const siblings=groups.filter(s=>s.parent_id===g.parent_id).sort((a,b)=>a.sort_order-b.sort_order);const index=siblings.findIndex(s=>s.id===g.id);
          if(key==='edit')setGroupDialog({value:g});if(key==='root')void moveGroup(g.id,'');if(key==='up'&&index>0)void moveGroup(g.id,g.parent_id,siblings[index-1].id);if(key==='down'&&index<siblings.length-1)void moveGroup(g.id,g.parent_id,siblings[index+2]?.id||'');if(key==='delete')setDeleting({id:g.id,name:g.name,group:true});
        }}><DropdownItem key="edit">编辑 / 更改父分组</DropdownItem><DropdownItem key="root" isDisabled={!g.parent_id}>移到顶层</DropdownItem><DropdownItem key="up" isDisabled={groups.filter(s=>s.parent_id===g.parent_id).sort((a,b)=>a.sort_order-b.sort_order)[0]?.id===g.id}>上移分组</DropdownItem><DropdownItem key="down" isDisabled={groups.filter(s=>s.parent_id===g.parent_id).sort((a,b)=>a.sort_order-b.sort_order).slice(-1)[0]?.id===g.id}>下移分组</DropdownItem><DropdownItem key="delete" color="danger">删除分组</DropdownItem></DropdownMenu></Dropdown>
      </div>{!collapsed.includes(g.id) && tree(g.id, depth + 1)}
    </div>);
  }
  return <div className="connection-center" onDragOver={e=>{if((e.target as HTMLElement).closest('.connection-groups'))dragOver(e,'root');}} onDrop={e=>{if((e.target as HTMLElement).closest('.connection-groups'))drop(e,'');}}>
    <aside className="connection-groups" aria-label="连接导航"><nav aria-label="连接范围">{[['all', '全部连接'], ['favorite', '收藏'], ['recent', '最近连接']].map(([value, label]) => <button key={value} className={`group-filter ${!group && view === value ? 'selected' : ''}`} aria-current={!group && view === value ? 'page' : undefined} onClick={() => scope(value)}>{label}<span>{connections.filter(c => value === 'all' || (value === 'favorite' ? preferences[c.id]?.favorite : preferences[c.id]?.last_connected)).length}</span></button>)}</nav><div className="sidebar-heading"><h2>分组</h2><Tooltip content="新增分组"><button className="icon-button" aria-label="新增分组" disabled={demo} onClick={() => { setError(''); setGroupDialog({}); }}><Icon name="plus" width="16" /></button></Tooltip></div><div className="group-tree">{tree('')}<button className={`group-filter ${group === 'ungrouped' ? 'selected' : ''}`} onClick={() => scope('all', 'ungrouped')}>未分组</button></div></aside>
    <section className="connection-catalog" aria-label="连接列表" aria-busy={loading}>
    <div className="catalog-toolbar"><Tooltip content={scopeName}><h1>{scopeName}</h1></Tooltip><Input aria-label="搜索连接" placeholder="搜索连接" size="sm" value={search} onValueChange={setSearch} startContent={<Icon name="search" width="14" />} isClearable onClear={() => setSearch('')} /><Button size="sm" variant="light" isDisabled={busy||demo} onPress={() => onNew(true)}>快速连接</Button><div className="catalog-create"><Button size="sm" color="primary" isDisabled={busy||demo} onPress={() => onNew(false)}><Icon name="plus" width="14" />新建连接</Button><Dropdown><DropdownTrigger><Tooltip content="导入连接与本地终端"><button className="icon-button" disabled={busy||demo} aria-label="导入连接与本地终端"><Icon name="chevron" width="13" style={{ transform: 'rotate(90deg)' }} /></button></Tooltip></DropdownTrigger><DropdownMenu aria-label="导入与本地终端" items={[{id:'import',name:'导入连接'},...shells.map(shell=>({id:`local:${shell.id}`,name:shell.name}))]} onAction={key=>{if(demo)return;if(key==='import')setImportOpen(true);else onLocal(String(key).slice(6));}}>{item=><DropdownItem key={item.id} showDivider={item.id==='import'&&!!shells.length}>{item.name}</DropdownItem>}</DropdownMenu></Dropdown></div></div>
    <div className="catalog-filters"><div className="protocol-filters" role="group" aria-label="协议筛选">{['all', 'ssh', 'rdp'].map(value => <button key={value} aria-pressed={protocol === value} onClick={() => setProtocol(value)}>{value === 'all' ? '全部' : value.toUpperCase()}</button>)}</div>
      <div className="catalog-actions">
        {onMultiHost && selectedIDs.length > 0 && selectedIDs.every(id => connections.some(connection => connection.id === id && connection.protocol === 'ssh')) && <Button size="sm" variant="light" isDisabled={busy || demo} onPress={() => onMultiHost(selectedIDs)}>多主机操作…</Button>}
        {selectedConnection ? <><Button size="sm" color="primary" variant="flat" isDisabled={busy||demo&&selectedConnection.protocol!=='ssh'} onPress={() => onOpen(selectedConnection)}>连接</Button><Button size="sm" variant="light" isDisabled={busy||demo} onPress={() => onEdit(selectedConnection)}>编辑</Button><Button size="sm" variant="light" isDisabled={demo} aria-pressed={!!preferences[selectedConnection.id]?.favorite} onPress={() => void preference(selectedConnection.id, !preferences[selectedConnection.id]?.favorite, preferences[selectedConnection.id]?.environment || '')}>{preferences[selectedConnection.id]?.favorite ? '取消收藏' : '收藏'}</Button></> : selectedIDs.length > 1 ? <div className="catalog-batch"><label><input type="checkbox" aria-label="选择全部可见连接" checked={!!visible.length&&selectedIDs.length===visible.length} onChange={e=>setSelection(e.target.checked?visible.map(c=>c.id):[])} />已选 {selectedIDs.length} 项</label><Button size="sm" variant="light" isDisabled={working||demo} onPress={()=>setMoveOpen(true)}>移动分组</Button><Button size="sm" variant="light" isDisabled={working||demo||selectedIDs.length>256} onPress={()=>setCredentialTargets(connections.filter(connection=>selectedSet.has(connection.id)))}>复用凭据</Button><Tooltip content="取消选择"><button className="icon-button" aria-label="取消选择" onClick={()=>setSelection([])}><Icon name="close" width="14" /></button></Tooltip></div> : null}
        <Dropdown><DropdownTrigger><Tooltip content="列表选项"><button className="icon-button" aria-label="列表选项"><Icon name="sort" width="16" /></button></Tooltip></DropdownTrigger><DropdownMenu aria-label="列表选项" disabledKeys={demo?['clear']:[]} onAction={key=>{if(key==='recent'){setSort('recent');setDescending(false);}if(key==='clear'&&!demo)void ClearRecentConnections().then(onReload).catch(e=>setError(errorMessage(e)));}}><DropdownItem key="recent" endContent={sort==='recent'?'✓':null}>按最近连接排序</DropdownItem><DropdownItem key="clear" className={view==='recent'?'':'hidden'}>清除最近连接</DropdownItem></DropdownMenu></Dropdown>
        <Tooltip content="刷新连接"><button className="icon-button" disabled={loading||demo} aria-label="刷新连接" onClick={onReload}><Icon name="refresh" width="15" /></button></Tooltip>
      </div>
    </div>
    <div className="catalog-saved-filters button-row">
      <SelectControl aria-label="环境筛选" value={environment} onChange={event => setEnvironment(event.target.value)}><option value="">全部环境</option><option value="production">生产</option><option value="staging">预发布</option><option value="development">开发</option></SelectControl>
      <SelectControl aria-label="添加标签筛选" value="" onChange={event => { if (event.target.value && !selectedTags.includes(event.target.value)) setTag([...selectedTags, event.target.value].join(',')); }}><option value="">标签筛选</option>{tags.filter(value => !selectedTags.includes(value)).map(value => <option key={value}>{value}</option>)}</SelectControl>
      {selectedTags.map(value => <button key={value} className="session-tool" aria-label={`移除标签筛选 ${value}`} onClick={() => setTag(selectedTags.filter(item => item !== value).join(','))}>{value} ×</button>)}
      {!!filters.length && <SelectControl aria-label="保存的筛选" value="" disabled={demo || savingFilter} onChange={event => { const item = filters.find(value => value.name === event.target.value); if (item) { scope(item.view, item.group); setProtocol(item.protocol); setEnvironment(item.environment); setTag((item.tags || []).join(',')); setSearch(item.search); setFilterName(item.name); } }}><option value="">保存的筛选</option>{filters.map(item => <option key={item.name}>{item.name}</option>)}</SelectControl>}
      <Button size="sm" variant="light" isDisabled={demo || !filterLoaded || savingFilter} onPress={() => setSaveFilterOpen(true)}>保存筛选</Button>
      {(environment || tag || search) && <Button size="sm" variant="light" onPress={() => { setEnvironment(''); setTag(''); setSearch(''); }}>清除筛选</Button>}
    </div>
    {saveFilterOpen && <Modal isOpen onClose={() => !savingFilter && setSaveFilterOpen(false)} className="app-dialog"><ModalContent><ModalHeader>保存当前筛选</ModalHeader><ModalBody><Input label="名称" value={filterName} onValueChange={setFilterName} maxLength={128} isDisabled={savingFilter} />{error && <p className="error" role="alert">{error}</p>}</ModalBody><ModalFooter><Button variant="light" isDisabled={savingFilter} onPress={() => setSaveFilterOpen(false)}>取消</Button>{filters.some(item => item.name === filterName.trim()) && <Button color="danger" variant="light" isDisabled={savingFilter} onPress={() => void saveFilters(filters.filter(item => item.name !== filterName.trim()))}>删除此筛选</Button>}<Button color="primary" isLoading={savingFilter} isDisabled={!filterName.trim()} onPress={() => void saveFilters([...filters.filter(item => item.name !== filterName.trim()), { name: filterName.trim(), view, group, protocol, environment, tags: selectedTags, search }])}>保存</Button></ModalFooter></ModalContent></Modal>}
    {latency.error && <p role="alert" className="error">{latency.error}</p>}
    {!groupDialog&&!deleting&&!duplicating&&!moveOpen&&<ErrorNotice message={error} onDismiss={()=>setError('')}/>}
    <div className="connection-list" aria-label="已保存连接" ref={list}><div className="connection-columns"><div className="connection-name-columns"><span />{sortHeading('name','名称')}{sortHeading('address','地址','connection-address-heading')}{sortHeading('username','用户名','connection-user')}{sortHeading('protocol','协议','connection-protocol')}</div><Tooltip content={demo?'演示样本':'刷新当前列表的 TCP 建连耗时'}><button className="latency-heading" aria-label="刷新当前列表的 TCP 延迟" aria-disabled={demo} aria-busy={latency.refreshing || undefined} onClick={() => {if(!demo)latency.refresh();}}><Icon name="refresh" width="12" height="12" className={latency.refreshing ? 'latency-refreshing' : undefined} />TCP 延迟</button></Tooltip><span /></div>{visible.map((c, index) => <div key={c.id} draggable={!working&&!demo} onDragStart={e=>{e.dataTransfer.setData('application/x-termquay-connections',JSON.stringify(selectedIDs.includes(c.id)?selectedIDs:[c.id]));e.dataTransfer.effectAllowed='move';}} className={`connection-row ${selectedIDs.includes(c.id) ? 'selected' : ''}`} onContextMenu={e => { e.preventDefault(); if(!selectedIDs.includes(c.id))pick(c.id); if(!demo)setMenu(c.id); }}>
      <Tooltip content={`${c.name}\n${c.protocol.toUpperCase()} · ${c.username}@${c.host}:${c.port}`}><button className="connection-name" aria-pressed={selectedIDs.includes(c.id)} tabIndex={visible.some(c=>c.id===selected) ? selected === c.id ? 0 : -1 : index === 0 ? 0 : -1} onClick={e => pick(c.id,e.ctrlKey||e.metaKey,e.shiftKey)} onDoubleClick={() => !busy && (!demo||c.protocol==='ssh') && onOpen(c)} onKeyDown={e => {
        if (e.nativeEvent.isComposing) return;
        if ((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='a'){e.preventDefault();setSelection(visible.map(c=>c.id));}
        if (e.key===' '){e.preventDefault();pick(c.id,true,e.shiftKey);}
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) { e.preventDefault(); const next = e.key === 'Home' ? 0 : e.key === 'End' ? visible.length - 1 : Math.max(0, Math.min(visible.length - 1, index + (e.key === 'ArrowDown' ? 1 : -1))); pick(visible[next].id,false,e.shiftKey); list.current?.querySelectorAll<HTMLElement>('.connection-name')[next]?.focus(); }
        if (e.key === 'Enter') { e.preventDefault(); if (!busy&&(!demo||c.protocol==='ssh')) onOpen(c); }
        if(demo)return;
        if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); setSelected(c.id); setMenu(c.id); }
        if (e.key === 'F2' && !busy) { e.preventDefault(); onEdit(c); }
        if (e.key === 'Delete') { e.preventDefault(); setError(''); setDeleting({ id: c.id, name: c.name }); }
      }}><Icon name={c.protocol === 'rdp' ? 'desktop' : 'terminal'} width="16" /><strong>{preferences[c.id]?.favorite && <span aria-label="已收藏">★ </span>}{c.name}{preferences[c.id]?.environment && <em className={`connection-environment ${preferences[c.id]?.environment}`}>{({production:'生产',staging:'预发布',development:'开发'} as Record<string,string>)[preferences[c.id]?.environment || '']}</em>}</strong><span className="connection-address-text"><span className="connection-inline-user">{c.username}@</span>{c.host}:{c.port}</span><span className="connection-user">{c.username}</span><small className="connection-protocol">{c.protocol.toUpperCase()}{sessions[c.id]?.length ? <span className="connection-session-state">{[...new Set(sessions[c.id])].map(state=>`${state} ${sessions[c.id].filter(s=>s===state).length}`).join(' / ')}</span> : null}</small></button></Tooltip>
      <ConnectionLatency name={c.name} demo={demo} measurement={(demoLatency||latency.measurements)[c.id]} onRefresh={() => latency.refresh(c.id)} />
      <Dropdown isOpen={menu === c.id} onOpenChange={open => setMenu(open ? c.id : '')}><DropdownTrigger><button className="icon-button row-menu" disabled={demo} aria-label={`连接 ${c.name} 操作`} onFocus={() => setSelected(c.id)}><Icon name="more" /></button></DropdownTrigger><DropdownMenu aria-label={`连接 ${c.name} 操作`} disabledKeys={busy ? ['open', 'another', 'edit', 'duplicate'] : []} onAction={key => { if(demo)return;if (key === 'open') onOpen(c); if (key === 'another') onOpen(c, true); if (key === 'system') onOpen(c, true, 'system'); if (key === 'playbook') onPlaybook?.(c); if (key === 'edit') onEdit(c); if (key === 'duplicate') { setError(''); setIncludeCredentials(false); setDuplicating(c); } if (key === 'delete') { setError(''); setDeleting({ id: c.id, name: c.name }); } }}><DropdownItem key="open">连接 / 定位工作区</DropdownItem><DropdownItem key="another">新建另一工作区</DropdownItem><DropdownItem key="system" className={c.protocol === 'rdp' ? '' : 'hidden'} isDisabled={busy || !systemRDP || c.protocol !== 'rdp'}>使用系统客户端</DropdownItem><DropdownItem key="playbook" className={onPlaybook ? '' : 'hidden'}>操作手册</DropdownItem><DropdownItem key="edit">编辑连接</DropdownItem><DropdownItem key="duplicate">复制配置</DropdownItem><DropdownItem key="delete" color="danger">删除连接</DropdownItem></DropdownMenu></Dropdown>
    </div>)}</div>
    {loading ? <p className="sidebar-empty" role="status">正在读取连接…</p> : loadError ? <div className="sidebar-empty"><p className="error">连接读取失败</p><Button size="sm" variant="light" onPress={onReload}>重试</Button></div> : visible.length === 0 && <div className="sidebar-empty"><span>{search || group || protocol !== 'all' ? '没有匹配连接' : view === 'favorite' ? '暂无收藏' : view === 'recent' ? '暂无最近连接记录' : '尚无连接'}</span></div>}
    </section>
    <Modal isOpen={moveOpen} onClose={()=>{if(!working){setMoveOpen(false);setError('');}}} className="app-dialog"><ModalContent><ModalHeader>移动 {selectedIDs.length} 个连接</ModalHeader><form onSubmit={e=>{e.preventDefault();void move(selectedIDs,String(new FormData(e.currentTarget).get('target')||''));}}><ModalBody><label className="form-field">目标分组<SelectControl name="target" disabled={working}><option value="">未分组</option>{groups.map(g=><option value={g.id} key={g.id}>{g.name}</option>)}</SelectControl></label>{error&&<p role="alert" className="error">{error}</p>}</ModalBody><ModalFooter><Button variant="light" isDisabled={working} onPress={()=>{setMoveOpen(false);setError('');}}>取消</Button><Button type="submit" color="primary" isLoading={working}>移动</Button></ModalFooter></form></ModalContent></Modal>
    {importOpen&&<ImportConnectionsDialog onClose={()=>setImportOpen(false)} onImported={onReload}/>}
    {credentialTargets&&<CredentialAssignDialog connections={credentialTargets} onChanged={onReload} onClose={()=>setCredentialTargets(undefined)}/>}
    <Modal isOpen={!!duplicating} onClose={()=>{if(!working){setDuplicating(undefined);setError('');}}} className="app-dialog"><ModalContent><ModalHeader>复制配置</ModalHeader><ModalBody><p>{duplicating?.name}</p><label className="checkbox-label"><input type="checkbox" checked={includeCredentials} onChange={e => setIncludeCredentials(e.target.checked)} disabled={working || !duplicating?.credential_id} />携带已保存凭据</label>{error && <p role="alert" className="error">{error}</p>}</ModalBody><ModalFooter><Button variant="light" isDisabled={working} onPress={()=>{setDuplicating(undefined);setError('');}}>取消</Button><Button color="primary" isLoading={working} onPress={async () => { if (!duplicating) return; setWorking(true); try { const copy = await DuplicateConnection(duplicating.id, includeCredentials); setSelected(copy.id); setDuplicating(undefined); onReload(); } catch (e) { setError(errorMessage(e)); } finally { setWorking(false); } }}>复制</Button></ModalFooter></ModalContent></Modal>
    <Modal isOpen={!!groupDialog} onClose={()=>{if(!working){setGroupDialog(undefined);setError('');}}} className="app-dialog"><ModalContent><ModalHeader>{groupDialog?.value ? '编辑分组' : '新增分组'}</ModalHeader><form onSubmit={async e => { e.preventDefault(); const data = new FormData(e.currentTarget); setWorking(true); try { await SaveGroup({ id: groupDialog?.value?.id || '', name: String(data.get('name')), parent_id: String(data.get('parent')), sort_order: groupDialog?.value?.sort_order ?? groups.length }); onReload(); setGroupDialog(undefined); } catch (e) { setError(errorMessage(e)); } finally { setWorking(false); } }}><ModalBody><Input name="name" label="分组名称" labelPlacement="outside" placeholder="分组名称" defaultValue={groupDialog?.value?.name} isRequired autoFocus /><label className="form-field">父分组<SelectControl name="parent" defaultValue={groupDialog?.value?.parent_id || ''}><option value="">顶层分组</option>{groups.filter(g => g.id !== groupDialog?.value?.id).map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</SelectControl></label>{error && <p role="alert" className="error">{error}</p>}</ModalBody><ModalFooter><Button variant="light" onPress={()=>{setGroupDialog(undefined);setError('');}} isDisabled={working}>取消</Button><Button type="submit" color="primary" isLoading={working}>保存</Button></ModalFooter></form></ModalContent></Modal>
    <Modal isOpen={!!deleting} onClose={()=>{if(!working){setDeleting(undefined);setError('');}}} className="app-dialog"><ModalContent><ModalHeader>删除{deleting?.group ? '分组' : '连接'}</ModalHeader><ModalBody><p>确认删除“{deleting?.name}”？</p>{error && <p role="alert" className="error">{error}</p>}</ModalBody><ModalFooter><Button variant="light" isDisabled={working} onPress={()=>{setDeleting(undefined);setError('');}}>取消</Button><Button color="danger" isLoading={working} onPress={async () => { if (!deleting) return; setWorking(true); try { await (deleting.group ? DeleteGroup(deleting.id) : DeleteConnection(deleting.id)); if (group === deleting.id) setGroup(''); setDeleting(undefined); setError(''); onReload(); } catch (e) { setError(errorMessage(e)); } finally { setWorking(false); } }}>删除</Button></ModalFooter></ModalContent></Modal>
  </div>;
}
