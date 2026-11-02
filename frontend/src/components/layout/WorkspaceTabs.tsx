import Icon from '../Icon';
import { useState } from 'react';
import { Dropdown, DropdownTrigger, DropdownMenu, DropdownItem } from '@heroui/react';

export default function WorkspaceTabs({ items, active, onSelect, onClose, onNew, onRename, onMove, onSearch }: {
  items: { id: string; name: string; rdp?: unknown; dirty?: boolean }[]; active: string;
  onSelect(id: string, keyboard?: boolean): void; onClose(id: string, keyboard?: boolean): void; onNew(): void;
  onRename(id: string, name: string): void; onMove(id: string, target: string): void;
  onSearch(): void;
}) {
  const [renaming, setRenaming] = useState<string>();
  const [name, setName] = useState('');
  function rename(id: string, value: string) { setName(value); setRenaming(id); }
  function finishRename() { if (renaming && name.trim()) onRename(renaming, name.trim()); setRenaming(undefined); }
  function focusTab(id: string) { requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-workspace-id="${CSS.escape(id)}"] [role=tab]`)?.focus()); }
  const tabs = [{ id: '', name: '连接中心', rdp: undefined, dirty: false }, ...items];
  return <div className="workspace-tabs" role="tablist" aria-label="连接工作区">
    {tabs.map((item, index) => <div className={`workspace-tab ${index === 0 ? 'connection-center-tab' : ''} ${active === item.id ? 'active' : ''}`} key={item.id} data-workspace-id={item.id} draggable={index !== 0 && renaming !== item.id}
      onDragStart={e => { e.dataTransfer.setData('application/x-termquay-workspace', item.id); e.dataTransfer.effectAllowed = 'move'; }}
      onDragOver={e => { if (index && e.dataTransfer.types.includes('application/x-termquay-workspace')) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } }}
      onDrop={e => { e.preventDefault(); const source = e.dataTransfer.getData('application/x-termquay-workspace'); if (index && items.some(w => w.id === source)) onMove(source, item.id); }}>
      {renaming === item.id ? <input className="workspace-rename" aria-label="工作区临时名称" autoFocus maxLength={64} value={name} onChange={e => setName(e.target.value)} onBlur={finishRename} onKeyDown={e => { e.stopPropagation(); if (e.nativeEvent.isComposing) return; if (e.key === 'Enter') { finishRename(); focusTab(item.id); } if (e.key === 'Escape') { setRenaming(undefined); focusTab(item.id); } }} /> :
      <button role="tab" aria-selected={active === item.id} tabIndex={active === item.id ? 0 : -1} onClick={() => onSelect(item.id)}
        onDoubleClick={() => { if (index) rename(item.id, item.name); }}
        onKeyDown={e => {
          if (e.nativeEvent.isComposing) return;
          if (index && e.key === 'F2') { e.preventDefault(); rename(item.id, item.name); return; }
          if (index && e.altKey && e.shiftKey && ['ArrowLeft', 'ArrowRight'].includes(e.key)) { e.preventDefault(); const target = tabs[index + (e.key === 'ArrowRight' ? 1 : -1)]; if (target?.id) { onMove(item.id, target.id); focusTab(item.id); } return; }
          if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) { e.preventDefault(); const next = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (index + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length; if (tabs[next].id !== active) onSelect(tabs[next].id, true); focusTab(tabs[next].id); }
        }}>
        <Icon name={index === 0 ? 'connections' : item.rdp ? 'desktop' : 'terminal'} /><span>{item.name}</span>{item.dirty && <span aria-label="有未保存文件" className="dirty-dot">●</span>}
      </button>}{index !== 0 && <><Dropdown><DropdownTrigger><button className="tab-close" aria-label={`工作区菜单 ${item.name}`}><Icon name="more" width="13" height="13" /></button></DropdownTrigger><DropdownMenu aria-label="工作区操作" onAction={key => { if (key === 'rename') rename(item.id, item.name); if (key === 'left' && index > 1) onMove(item.id, tabs[index - 1].id); if (key === 'right' && index < tabs.length - 1) onMove(item.id, tabs[index + 1].id); }} disabledKeys={[...(index <= 1 ? ['left'] : []), ...(index === tabs.length - 1 ? ['right'] : [])]}><DropdownItem key="rename">临时重命名</DropdownItem><DropdownItem key="left">左移工作区</DropdownItem><DropdownItem key="right">右移工作区</DropdownItem></DropdownMenu></Dropdown><button className="tab-close" aria-label={`关闭工作区 ${item.name}`} onClick={e => onClose(item.id, e.detail === 0)}><Icon name="close" width="13" height="13" /></button></>}
    </div>)}
    <button className="icon-button" title="新建连接" aria-label="新建连接" onClick={onNew}><Icon name="plus" /></button>
    <button className="icon-button" title="已打开工作区" aria-label="已打开工作区" onClick={onSearch}><Icon name="search" /></button>
  </div>;
}
