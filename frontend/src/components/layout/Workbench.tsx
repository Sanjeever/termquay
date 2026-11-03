import { useState, type ReactNode } from 'react';
import TitleBar from './TitleBar';

export default function Workbench({ tabs, tools, settings, status, children }: {
  tabs: ReactNode; tools: ReactNode; settings: boolean; status: ReactNode; children: ReactNode;
}) {
  const [windowError, setWindowError] = useState('');
  return <main className="app-shell">
    <TitleBar tabs={tabs} tools={tools} onError={setWindowError} />
    <div className="app-body">
      <section className="workspace-area" aria-label={settings ? '设置' : '工作区'}>{children}</section>
    </div><footer className="workbench-status">{status}{windowError && <span role="alert" className="error">{windowError}</span>}</footer>
  </main>;
}
