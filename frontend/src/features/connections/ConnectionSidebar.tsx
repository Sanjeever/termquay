import { useState } from 'react';
import { Button, Dropdown, DropdownTrigger, DropdownMenu, DropdownItem, Input, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@heroui/react';
import { DeleteConnection, SaveGroup, DeleteGroup } from '../../../bindings/github.com/Sanjeever/termquay/appservice';
import type { Connection, Group } from '../../../bindings/github.com/Sanjeever/termquay/internal/store/models';
import Icon from '../../components/Icon';

export default function ConnectionSidebar({ connections, groups, onOpen, onEdit, onNew, onReload, busy }: {
  connections: Connection[]; groups: Group[]; onOpen(c: Connection, another?: boolean): void; onEdit(c: Connection): void; onNew(temporary: boolean): void; onReload(): void; busy: boolean;
}) {
  const [search, setSearch] = useState('');
  const [protocol, setProtocol] = useState('all');
  const [group, setGroup] = useState('');
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const [groupDialog, setGroupDialog] = useState<{ value?: Group }>();
  const [deleting, setDeleting] = useState<{ id: string; name: string; group?: boolean }>();
  const [working, setWorking] = useState(false);
  const descendants = new Set([group]);
  for (let i = 0; i < groups.length; i++) for (const g of groups) if (descendants.has(g.parent_id)) descendants.add(g.id);
  const visible = connections.filter(c => (protocol === 'all' || c.protocol === protocol) && (!group || (group === 'ungrouped' ? !c.group_id : descendants.has(c.group_id))) && `${c.name} ${c.host} ${c.username}`.toLowerCase().includes(search.toLowerCase()));

  function tree(parent: string, depth = 0): React.ReactNode {
    return groups.filter(g => g.parent_id === parent).sort((a, b) => a.sort_order - b.sort_order).map(g => <div key={g.id}>
      <div className={`group-row ${group === g.id ? 'selected' : ''}`} style={{ paddingLeft: 8 + depth * 12 }}>
        <button className="group-expand" aria-label={`${collapsed.includes(g.id) ? '展开' : '收起'}分组 ${g.name}`} aria-expanded={!collapsed.includes(g.id)} onClick={() => setCollapsed(prev => prev.includes(g.id) ? prev.filter(id => id !== g.id) : [...prev, g.id])}><Icon name="chevron" width="12" height="12" style={{ transform: collapsed.includes(g.id) ? undefined : 'rotate(90deg)' }} /></button>
        <button className="group-name" onClick={() => setGroup(g.id)}>{g.name}</button>
        <Dropdown><DropdownTrigger><button className="icon-button row-menu" aria-label={`分组 ${g.name} 操作`}><Icon name="more" width="14" /></button></DropdownTrigger><DropdownMenu aria-label={`分组 ${g.name} 操作`} onAction={key => key === 'edit' ? setGroupDialog({ value: g }) : setDeleting({ id: g.id, name: g.name, group: true })}><DropdownItem key="edit">编辑分组</DropdownItem><DropdownItem key="delete" color="danger">删除分组</DropdownItem></DropdownMenu></Dropdown>
      </div>{!collapsed.includes(g.id) && tree(g.id, depth + 1)}
    </div>);
  }
  return <div className="connection-sidebar">
    <div className="sidebar-heading"><h2>连接</h2><div className="button-row"><button className="icon-button" aria-label="快速连接" title="快速连接" onClick={() => onNew(true)}><Icon name="terminal" /></button><button className="icon-button" aria-label="新建连接" title="新建连接" onClick={() => onNew(false)}><Icon name="plus" /></button></div></div>
    <Input aria-label="搜索连接" placeholder="搜索连接" size="sm" value={search} onValueChange={setSearch} startContent={<Icon name="search" width="14" />} isClearable onClear={() => setSearch('')} />
    <div className="connection-filters"><select aria-label="协议筛选" value={protocol} onChange={e => setProtocol(e.target.value)}><option value="all">全部协议</option><option value="ssh">SSH</option><option value="rdp">RDP</option></select><button className="icon-button" aria-label="新增分组" title="新增分组" onClick={() => { setError(''); setGroupDialog({}); }}><Icon name="files" width="15" /><span>＋</span></button></div>
    <div className="group-tree" aria-label="连接分组"><button className={`group-filter ${!group ? 'selected' : ''}`} onClick={() => setGroup('')}>全部连接<span>{connections.length}</span></button>{tree('')}<button className={`group-filter ${group === 'ungrouped' ? 'selected' : ''}`} onClick={() => setGroup('ungrouped')}>未分组</button></div>
    <div className="section-label">{group ? groups.find(g => g.id === group)?.name || '未分组' : '连接列表'}<span>{visible.length}</span></div>
    {error && <p role="alert" className="error">{error}</p>}
    <div className="connection-list" aria-label="已保存连接">{visible.map(c => <div key={c.id} className={`connection-row ${selected === c.id ? 'selected' : ''}`}>
      <button className="connection-name" onClick={() => setSelected(c.id)} onDoubleClick={() => !busy && onOpen(c)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (!busy) onOpen(c); } }} title={`${c.username}@${c.host}:${c.port}`}><Icon name={c.protocol === 'rdp' ? 'desktop' : 'terminal'} /><span><strong>{c.name}</strong><small>{c.host}<span className="protocol">{c.protocol.toUpperCase()}</span></small></span></button>
      <Dropdown><DropdownTrigger><button className="icon-button row-menu" aria-label={`连接 ${c.name} 操作`}><Icon name="more" /></button></DropdownTrigger><DropdownMenu aria-label={`连接 ${c.name} 操作`} disabledKeys={busy ? ['open', 'another', 'edit'] : []} onAction={key => { if (key === 'open') onOpen(c); if (key === 'another') onOpen(c, true); if (key === 'edit') onEdit(c); if (key === 'delete') { setError(''); setDeleting({ id: c.id, name: c.name }); } }}><DropdownItem key="open">连接 / 定位工作区</DropdownItem><DropdownItem key="another">新建另一工作区</DropdownItem><DropdownItem key="edit">编辑连接</DropdownItem><DropdownItem key="delete" color="danger">删除连接</DropdownItem></DropdownMenu></Dropdown>
      {selected === c.id && <Button size="sm" className="selected-connect" isDisabled={busy} onPress={() => onOpen(c)}>连接</Button>}
    </div>)}</div>
    {visible.length === 0 && <div className="sidebar-empty"><span>{search || group || protocol !== 'all' ? '没有匹配连接' : '尚无连接'}</span><Button size="sm" variant="light" onPress={() => onNew(false)}>新建连接</Button></div>}
    <Modal isOpen={!!groupDialog} onClose={() => !working && setGroupDialog(undefined)} className="app-dialog"><ModalContent><ModalHeader>{groupDialog?.value ? '编辑分组' : '新增分组'}</ModalHeader><form onSubmit={async e => { e.preventDefault(); const data = new FormData(e.currentTarget); setWorking(true); try { await SaveGroup({ id: groupDialog?.value?.id || '', name: String(data.get('name')), parent_id: String(data.get('parent')), sort_order: groupDialog?.value?.sort_order ?? groups.length }); onReload(); setGroupDialog(undefined); } catch (e) { setError(String(e)); } finally { setWorking(false); } }}><ModalBody><Input name="name" label="分组名称" labelPlacement="outside" placeholder="分组名称" defaultValue={groupDialog?.value?.name} isRequired autoFocus /><label className="form-field">父分组<select name="parent" defaultValue={groupDialog?.value?.parent_id || ''}><option value="">顶层分组</option>{groups.filter(g => g.id !== groupDialog?.value?.id).map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>{error && <p role="alert" className="error">{error}</p>}</ModalBody><ModalFooter><Button variant="light" onPress={() => setGroupDialog(undefined)} isDisabled={working}>取消</Button><Button type="submit" color="primary" isLoading={working}>保存</Button></ModalFooter></form></ModalContent></Modal>
    <Modal isOpen={!!deleting} onClose={() => !working && setDeleting(undefined)} className="app-dialog"><ModalContent><ModalHeader>删除{deleting?.group ? '分组' : '连接'}</ModalHeader><ModalBody><p>确认删除“{deleting?.name}”？</p>{error && <p role="alert" className="error">{error}</p>}</ModalBody><ModalFooter><Button variant="light" isDisabled={working} onPress={() => setDeleting(undefined)}>取消</Button><Button color="danger" isLoading={working} onPress={async () => { if (!deleting) return; setWorking(true); try { await (deleting.group ? DeleteGroup(deleting.id) : DeleteConnection(deleting.id)); if (group === deleting.id) setGroup(''); setDeleting(undefined); setError(''); onReload(); } catch (e) { setError(String(e)); } finally { setWorking(false); } }}>删除</Button></ModalFooter></ModalContent></Modal>
  </div>;
}
