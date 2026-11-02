import { useState } from 'react';
import { Button } from '@heroui/react';
import { defaultShortcuts, eventShortcut, shortcutConflict, shortcutDefinitions, shortcutLabel, type ShortcutID, type Shortcuts } from '../../lib/shortcuts';

export default function KeyboardSettings({ values, onChange, error }: { values: Shortcuts; onChange(value: Shortcuts): void; error: string }) {
  const [recording, setRecording] = useState<ShortcutID>();
  const [conflict, setConflict] = useState('');
  return <div className="settings-section"><h2>快捷键</h2>
    {(conflict || error) && <p role="alert" className="error">{conflict || error}</p>}
    {shortcutDefinitions.map(d => <div className="settings-row" key={d.id}><span>{d.label}</span><div className="button-row">
      <button className="shortcut-recorder" aria-label={`设置${d.label}快捷键`} onClick={() => { setRecording(d.id); setConflict(''); }} onBlur={() => setRecording(undefined)} onKeyDown={e => {
        if (recording !== d.id) return;
        e.preventDefault(); e.stopPropagation();
        if (e.nativeEvent.isComposing) return;
        if (e.key === 'Escape') { setRecording(undefined); return; }
        const key = eventShortcut(e.nativeEvent); if (!key) { setConflict('请使用 Ctrl/⌘ 或 Alt 搭配字母、数字、标点或功能键'); return; }
        const message = shortcutConflict(d.id, key, values); setConflict(message);
        if (!message) { onChange({ ...values, [d.id]: key }); setRecording(undefined); }
      }}>{recording === d.id ? '按下组合键…' : shortcutLabel(values[d.id])}</button>
      <Button size="sm" variant="light" isDisabled={!values[d.id]} onPress={() => onChange({ ...values, [d.id]: '' })}>清除</Button>
    </div></div>)}
    <Button size="sm" variant="bordered" onPress={() => { onChange({ ...defaultShortcuts }); setConflict(''); setRecording(undefined); }}>复位快捷键</Button>
  </div>;
}
