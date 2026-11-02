import { useState } from 'react';
import { Button } from '@heroui/react';
import BackupSettings from './BackupSettings';
import KeyboardSettings from './KeyboardSettings';
import type { Shortcuts } from '../../lib/shortcuts';
import packageInfo from '../../../package.json';
import Icon from '../../components/Icon';
import appIcon from '../../../../build/appicon.svg';

export default function SettingsView({ fontSize, onFontSize, onRestore, onClose, shortcuts, onShortcuts, shortcutError }: { fontSize: number; onFontSize(value: number): void; onRestore(): void; onClose(): void; shortcuts: Shortcuts; onShortcuts(value: Shortcuts): void; shortcutError: string }) {
  const [section, setSection] = useState('appearance');
  return <section className="settings-view" aria-label="设置">
    <div className="settings-header"><h1>设置</h1><Button size="sm" variant="light" onPress={onClose}>返回工作区</Button></div>
    <div className="settings-layout"><nav className="settings-navigation" aria-label="设置分类">{[['appearance', '外观与终端'], ['keyboard', '快捷键'], ['backup', '备份恢复'], ['about', '关于']].map(([id, label]) => <button key={id} className={section === id ? 'selected' : ''} aria-current={section === id ? 'page' : undefined} onClick={() => setSection(id)}>{label}</button>)}</nav>
      <div className="settings-content">
        {section === 'appearance' && <div className="settings-section"><h2>外观与终端</h2><div className="settings-row"><span>主题</span><span className="muted">深色</span></div><div className="settings-row"><label htmlFor="terminal-font-size">终端字号</label><div className="button-row"><input id="terminal-font-size" type="range" min="11" max="24" value={fontSize} onChange={e => onFontSize(Number(e.target.value))} /><output htmlFor="terminal-font-size">{fontSize}px</output></div></div><div className="terminal-preview" style={{ fontSize }}><Icon name="terminal" width="16" /><span>远程终端 · ~/workspace</span></div></div>}
        {section === 'backup' && <BackupSettings onRestore={onRestore} />}
        {section === 'keyboard' && <KeyboardSettings values={shortcuts} onChange={onShortcuts} error={shortcutError} />}
        {section === 'about' && <div className="settings-section about-section"><img src={appIcon} alt="栈桥应用图标" width="64" height="64" /><h2>TermQuay · 栈桥</h2><div className="settings-row"><span>版本</span><span className="muted">{packageInfo.version}</span></div><div className="settings-row"><span>许可证</span><span className="muted">Apache License 2.0</span></div></div>}
      </div>
    </div>
  </section>;
}
