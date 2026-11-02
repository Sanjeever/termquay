import type { ReactNode } from 'react';

export default function Workbench({ tabs, tools, settings, status, children }: {
  tabs: ReactNode; tools: ReactNode; settings: boolean; status: ReactNode; children: ReactNode;
}) {
  return <main className="app-shell">
    <header className="workbench-header">{tabs}<div className="workbench-tools">{tools}</div></header>
    <div className="app-body">
      <section className="workspace-area" aria-label={settings ? '设置' : '工作区'}>{children}</section>
    </div><footer className="workbench-status">{status}</footer>
  </main>;
}
