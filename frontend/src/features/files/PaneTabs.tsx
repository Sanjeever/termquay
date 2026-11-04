import Tooltip from '../../components/Tooltip';
import Icon from '../../components/Icon';
import { commandAttentionLabels, type CommandAttention } from '../terminal/commandAttention';

export default function PaneTabs({ pane, items, selected, focused, hidden, column, creating, onSelect, onClose, onNew, newShortcut, closeShortcut }: {
  pane: number; items: { id: string; label: string; terminal: boolean; dirty?: boolean; closingDisabled?: boolean; attention?: CommandAttention }[];
  selected: string; focused: boolean; hidden: boolean; column: number; creating: boolean;
  onSelect(id: string): void; onClose(id: string): void; onNew(): void;
  newShortcut: string; closeShortcut: string;
}) {
  return <div className={`inner-tabs pane-tabs ${focused ? 'focused-pane' : ''}`} role="tablist" aria-label={`${pane === 0 ? '主' : '右侧'}窗格标签`} hidden={hidden} style={{ gridColumn: column, gridRow: 1 }} onKeyDown={e => {
    if (e.nativeEvent.isComposing || (e.target as HTMLElement).getAttribute('role') !== 'tab' || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault(); const tabs = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role=tab]')); const index = tabs.indexOf(e.target as HTMLElement);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (index + (e.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length;
    onSelect(items[next].id); requestAnimationFrame(() => tabs[next]?.focus());
  }}>
    {items.map(item => <div key={item.id} className={selected === item.id ? 'selected' : ''}>
      <Tooltip content={item.terminal ? item.label : item.id}><button role="tab" aria-selected={selected === item.id} tabIndex={selected === item.id ? 0 : -1} onClick={() => onSelect(item.id)}>{item.terminal && <Icon name="terminal" width="14" />}{item.label}{item.attention && <span className={`command-attention ${item.attention}`}>{commandAttentionLabels[item.attention]}</span>}{item.dirty && <span className="dirty-dot" aria-label="未保存">●</span>}</button></Tooltip>
      <Tooltip content={`关闭 · ${closeShortcut}`}><button className="pane-tab-close" aria-label={`关闭${item.terminal ? '' : '文件 '}${item.label}`} disabled={item.closingDisabled} onClick={() => onClose(item.id)}><Icon name="close" width="12" /></button></Tooltip>
    </div>)}
    <Tooltip content={`新建终端 · ${newShortcut}`}><button aria-label={`在${pane === 0 ? '主' : '右侧'}窗格新建终端`} disabled={creating} onClick={onNew}><Icon name="plus" width="15" /></button></Tooltip>
  </div>;
}
