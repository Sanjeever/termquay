import { useState, type ReactNode } from 'react';
import TitleBar from './TitleBar';
import ErrorNotice from '../ErrorNotice';

export default function Workbench({ tabs, tools, settings, status, children }: {
  tabs: ReactNode; tools: ReactNode; settings: boolean; status: ReactNode; children: ReactNode;
}) {
  const [windowError, setWindowError] = useState('');
  return <main className="app-shell">
    <TitleBar tabs={tabs} tools={tools} onError={setWindowError} />
    <div className="app-body">
      <section className="workspace-area" aria-label={settings ? '设置' : '工作区'}>{children}</section>
    </div><footer className="workbench-status">{status}<ErrorNotice message={windowError} onDismiss={()=>setWindowError('')}/></footer>
  </main>;
}
