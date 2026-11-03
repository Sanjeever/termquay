import { useState } from 'react';
import { Button } from '@heroui/react';
import BackupSettings from './BackupSettings';
import KeyboardSettings from './KeyboardSettings';
import SnippetSettings from './SnippetSettings';
import RecoverySettings from './RecoverySettings';
import TrustSettings from './TrustSettings';
import CredentialSettings from './CredentialSettings';
import AppearanceSettings from './AppearanceSettings';
import type useDraftRecovery from '../workspaces/useDraftRecovery';
import type { Shortcuts } from '../../lib/shortcuts';
import type useAutomaticBackup from './useAutomaticBackup';
import AboutSettings from './AboutSettings';
import type useUpdates from './useUpdates';

export default function SettingsView({ fontSize, onFontSize, onRestore, onClose, shortcuts, onShortcuts, shortcutError, recovery, automaticBackup, updates, onRestart, activeWorkspaces, activeTransfers, initialSection='appearance' }: { fontSize: number; onFontSize(value: number): void; onRestore(): void; onClose(): void; shortcuts: Shortcuts; onShortcuts(value: Shortcuts): void; shortcutError: string; recovery:ReturnType<typeof useDraftRecovery>; automaticBackup: ReturnType<typeof useAutomaticBackup>; updates:ReturnType<typeof useUpdates>; onRestart():void; activeWorkspaces:number; activeTransfers:number; initialSection?:string }) {
  const [section, setSection] = useState(initialSection);
  return <section className="settings-view" aria-label="设置">
    <div className="settings-header"><h1>设置</h1><Button size="sm" variant="light" onPress={onClose}>返回工作区</Button></div>
    <div className="settings-layout"><nav className="settings-navigation" aria-label="设置分类">{[['appearance', '外观与终端'], ['keyboard', '快捷键'], ['snippets','命令片段'],['credentials','凭据'],['recovery','本地草稿恢复'],['trust','身份信任'], ['backup', '备份恢复'], ['about', '关于']].map(([id, label]) => <button key={id} className={section === id ? 'selected' : ''} aria-current={section === id ? 'page' : undefined} onClick={() => setSection(id)}>{label}</button>)}</nav>
      <div className="settings-content">
        {section === 'appearance' && <AppearanceSettings fontSize={fontSize} onFontSize={onFontSize} />}
        {section === 'backup' && <BackupSettings onRestore={onRestore} automaticBackup={automaticBackup} />}
        {section === 'keyboard' && <KeyboardSettings values={shortcuts} onChange={onShortcuts} error={shortcutError} />}
        {section === 'snippets' && <SnippetSettings/>}
        {section === 'recovery'&&<RecoverySettings recovery={recovery}/>}
        {section === 'trust'&&<TrustSettings/>}
        {section === 'credentials'&&<CredentialSettings onChanged={onRestore}/>}
        {section === 'about' && <AboutSettings updates={updates} onRestart={onRestart} activeWorkspaces={activeWorkspaces} activeTransfers={activeTransfers}/>}
      </div>
    </div>
  </section>;
}
