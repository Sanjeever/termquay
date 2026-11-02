import type { ReactNode } from 'react';
import { Tooltip } from '@heroui/react';
import Icon from '../Icon';
import ResizeHandle from './ResizeHandle';

export type SidebarMode = 'connections' | 'files' | null;

export default function Workbench({ tabs, tools, sidebar, sidebarMode, sidebarWidth, onSidebarWidth, onSidebar, hasSSH, settings, onSettings, focus, status, children }: {
  tabs: ReactNode; tools: ReactNode; sidebar: ReactNode; sidebarMode: SidebarMode; sidebarWidth: number; onSidebarWidth(value: number): void;
  onSidebar(mode: SidebarMode): void; hasSSH: boolean; settings: boolean; onSettings(): void; focus: boolean; status: ReactNode; children: ReactNode;
}) {
  return <main className={`app-shell ${focus ? 'focus-mode' : ''}`}>
    <header className="workbench-header">{tabs}<div className="workbench-tools">{tools}</div></header>
    <div className="app-body">
      <nav className="navigation-rail" aria-label="工作台导航">
        {(['connections', 'files'] as const).map(mode => <Tooltip key={mode} content={mode === 'connections' ? '连接' : '远端文件'} placement="right"><button className={`rail-button ${!settings && sidebarMode === mode ? 'selected' : ''}`} aria-label={mode === 'connections' ? '连接侧栏' : '文件侧栏'} aria-pressed={!settings && sidebarMode === mode} disabled={mode === 'files' && !hasSSH} onClick={() => onSidebar(sidebarMode === mode && !settings ? null : mode)}><Icon name={mode} /></button></Tooltip>)}
        <div className="rail-spacer" /><Tooltip content="设置" placement="right"><button className={`rail-button ${settings ? 'selected' : ''}`} aria-label="设置" aria-pressed={settings} onClick={onSettings}><Icon name="settings" /></button></Tooltip>
      </nav>
      <div className="shared-sidebar" style={{ width: sidebarWidth }} hidden={!sidebarMode || focus || settings}>{sidebar}</div>
      {sidebarMode && !focus && !settings && <ResizeHandle label="侧栏宽度" value={sidebarWidth} min={200} max={420} onChange={onSidebarWidth} />}
      <section className="workspace-area" aria-label={settings ? '设置' : '工作区'}>{children}</section>
    </div><footer className="workbench-status">{status}</footer>
  </main>;
}
