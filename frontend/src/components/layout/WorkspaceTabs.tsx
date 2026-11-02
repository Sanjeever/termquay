import Icon from '../Icon';

export default function WorkspaceTabs({ items, active, onSelect, onClose, onNew }: {
  items: { id: string; name: string; rdp?: unknown; dirty?: boolean }[]; active: string;
  onSelect(id: string, keyboard?: boolean): void; onClose(id: string): void; onNew(): void;
}) {
  return <div className="workspace-tabs" role="tablist" aria-label="连接工作区">
    {items.map((item, index) => <div className={`workspace-tab ${active === item.id ? 'active' : ''}`} key={item.id}>
      <button role="tab" aria-selected={active === item.id} tabIndex={active === item.id ? 0 : -1} onClick={() => onSelect(item.id)}
        onKeyDown={e => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) { e.preventDefault(); const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (index + (e.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length; const button = e.currentTarget.closest('[role=tablist]')?.querySelectorAll<HTMLElement>('[role=tab]')[next]; if (items[next].id !== active) onSelect(items[next].id, true); setTimeout(() => button?.focus(), 0); } }}>
        <Icon name={item.rdp ? 'desktop' : 'terminal'} /><span>{item.name}</span>{item.dirty && <span aria-label="有未保存文件" className="dirty-dot">●</span>}
      </button><button className="tab-close" aria-label={`关闭工作区 ${item.name}`} onClick={() => onClose(item.id)}><Icon name="close" width="13" height="13" /></button>
    </div>)}
    <button className="icon-button" title="新建连接" aria-label="新建连接" onClick={onNew}><Icon name="plus" /></button>
  </div>;
}
