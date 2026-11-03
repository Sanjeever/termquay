import { lazy, Suspense } from 'react';
import { Button } from '@heroui/react';
import KeyboardSettings from './KeyboardSettings';
import RecoverySettings from './RecoverySettings';
import AppearanceSettings from './AppearanceSettings';
import type useDraftRecovery from '../workspaces/useDraftRecovery';
import type { Shortcuts } from '../../lib/shortcuts';
import type useAutomaticBackup from './useAutomaticBackup';
import type useUpdates from './useUpdates';
import Icon from '../../components/Icon';

const sections = [['appearance','外观','settings'],['terminal','终端与编辑器','terminal'],['keyboard','快捷键','list'],['snippets','命令片段','terminal'],['credentials','凭据','eyeOff'],['recovery','本地草稿恢复','undo'],['trust','身份信任','connections'],['backup','备份恢复','transfer'],['about','关于','desktop']] as const;
const BackupSettings = lazy(() => import('./BackupSettings'));
const SnippetSettings = lazy(() => import('./SnippetSettings'));
const TrustSettings = lazy(() => import('./TrustSettings'));
const CredentialSettings = lazy(() => import('./CredentialSettings'));
const AboutSettings = lazy(() => import('./AboutSettings'));

export default function SettingsView({ fontSize, onFontSize, onRestore, onClose, shortcuts, onShortcuts, shortcutError, recovery, automaticBackup, updates, onRestart, activeWorkspaces, activeTransfers, section, onSectionChange: setSection }: { fontSize: number; onFontSize(value: number): void; onRestore(): void; onClose(): void; shortcuts: Shortcuts; onShortcuts(value: Shortcuts): void; shortcutError: string; recovery:ReturnType<typeof useDraftRecovery>; automaticBackup: ReturnType<typeof useAutomaticBackup>; updates:ReturnType<typeof useUpdates>; onRestart():void; activeWorkspaces:number; activeTransfers:number; section:string; onSectionChange(section:string):void }) {
  return <section className="settings-view" aria-label="设置">
    <div className="settings-layout"><aside className="settings-sidebar"><div className="settings-header"><Button isIconOnly size="sm" variant="light" aria-label="返回工作区" title="返回工作区" onPress={onClose}><Icon name="back" width="16" /></Button><h1>设置</h1></div><nav className="settings-navigation" aria-label="设置分类" onKeyDown={event=>{if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;event.preventDefault();const buttons=Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button'));const index=buttons.indexOf(event.target as HTMLButtonElement);const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;buttons[next]?.focus();buttons[next]?.click();}}>{sections.map(([id, label, icon]) => <button key={id} className={section === id ? 'selected' : ''} aria-current={section === id ? 'page' : undefined} onClick={() => setSection(id)}><Icon name={icon} width="16" /><span>{label}</span></button>)}</nav></aside>
      <div className="settings-content"><Suspense fallback={<div className="view-loading" role="status">正在载入…</div>}>
        {(section === 'appearance' || section === 'terminal') && <AppearanceSettings key={section} section={section} fontSize={fontSize} onFontSize={onFontSize} />}
        {section === 'backup' && <BackupSettings onRestore={onRestore} automaticBackup={automaticBackup} />}
        {section === 'keyboard' && <KeyboardSettings values={shortcuts} onChange={onShortcuts} error={shortcutError} />}
        {section === 'snippets' && <SnippetSettings/>}
        {section === 'recovery'&&<RecoverySettings recovery={recovery}/>}
        {section === 'trust'&&<TrustSettings/>}
        {section === 'credentials'&&<CredentialSettings onChanged={onRestore}/>}
        {section === 'about' && <AboutSettings updates={updates} onRestart={onRestart} activeWorkspaces={activeWorkspaces} activeTransfers={activeTransfers}/>}
      </Suspense></div>
    </div>
  </section>;
}
