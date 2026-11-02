import type { ReactNode } from 'react';
import ResizeHandle from './ResizeHandle';

export default function Workbench({ tabs, tools, sidebar, sidebarOpen, sidebarWidth, onSidebarWidth, settings, focus, status, children }: {
  tabs: ReactNode; tools: ReactNode; sidebar: ReactNode; sidebarOpen: boolean; sidebarWidth: number; onSidebarWidth(value: number): void;
  settings: boolean; focus: boolean; status: ReactNode; children: ReactNode;
}) {
  return <main className={`app-shell ${focus ? 'focus-mode' : ''}`}>
    <header className="workbench-header">{tabs}<div className="workbench-tools">{tools}</div></header>
    <div className="app-body">
      <div className="shared-sidebar" style={{ width: sidebarWidth }} hidden={!sidebarOpen || focus || settings}>{sidebar}</div>
      {sidebarOpen && !focus && !settings && <ResizeHandle label="侧栏宽度" value={sidebarWidth} min={200} max={420} onChange={onSidebarWidth} />}
      <section className="workspace-area" aria-label={settings ? '设置' : '工作区'}>{children}</section>
    </div><footer className="workbench-status">{status}</footer>
  </main>;
}
