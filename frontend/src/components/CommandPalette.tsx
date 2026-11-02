import { useEffect, useRef, useState } from 'react';
import { Modal, ModalContent, Input } from '@heroui/react';
import Icon from './Icon';

export type WorkbenchCommand = { id: string; label: string; detail?: string; kind: 'connection' | 'workspace' | 'command'; run(): void };

export default function CommandPalette({ commands, onClose }: { commands: WorkbenchCommand[]; onClose(): void }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const filtered = commands.filter(c => `${c.label} ${c.detail || ''}`.toLowerCase().includes(query.toLowerCase())).slice(0, 50);
  useEffect(() => { list.current?.querySelector(`#command-${selected}`)?.scrollIntoView({ block: 'nearest' }); }, [selected]);
  function run(index: number) { const command = filtered[index]; if (command) { onClose(); command.run(); } }
  return <Modal isOpen onClose={onClose} hideCloseButton className="app-dialog command-palette" placement="top" aria-label="命令搜索"><ModalContent onKeyDownCapture={e => { if (e.nativeEvent.isComposing) { e.stopPropagation(); return; } if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } }}>
    <Input autoFocus aria-label="搜索连接与命令" placeholder="搜索连接、工作区与命令…" value={query} onValueChange={value => { setQuery(value); setSelected(0); }} startContent={<Icon name="search" />} role="combobox" aria-expanded="true" aria-controls="command-results" aria-activedescendant={filtered.length ? `command-${selected}` : undefined} onKeyDown={e => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setSelected(prev => (prev + (e.key === 'ArrowDown' ? 1 : -1) + filtered.length) % (filtered.length || 1)); } if (e.key === 'Enter') { e.preventDefault(); run(selected); } }} />
    <div className="command-results" ref={list} role="listbox" id="command-results" aria-label="搜索结果">{filtered.map((c, i) => <div role="option" aria-selected={i === selected} id={`command-${i}`} key={c.id} className={`command-result ${i === selected ? 'selected' : ''}`} onMouseMove={() => setSelected(i)} onClick={() => run(i)}><Icon name={c.kind === 'workspace' ? 'terminal' : c.kind === 'connection' ? 'connections' : 'chevron'} width="16" /><span>{c.label}{c.detail && <small>{c.detail}</small>}</span><span className="command-kind">{c.kind === 'workspace' ? '工作区' : c.kind === 'connection' ? '连接' : '命令'}</span></div>)}{filtered.length === 0 && <p className="sidebar-empty">无匹配结果</p>}</div>
  </ModalContent></Modal>;
}
