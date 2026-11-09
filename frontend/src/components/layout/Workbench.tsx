import { t as translate } from '../../i18n/index.ts';
import { useMessageState } from '../../i18n/useMessageState.ts';
import { useTranslation } from 'react-i18next';
import { type ReactNode } from 'react';
import TitleBar from './TitleBar';
import ErrorNotice from '../ErrorNotice';

export default function Workbench({ tabs, tools, settings, status, children }: {
  tabs: ReactNode; tools: ReactNode; settings: boolean; status: ReactNode; children: ReactNode;
}) {
  useTranslation();
  const [windowError, setWindowError] = useMessageState('');
  return <main className="app-shell">
    <TitleBar tabs={tabs} tools={tools} onError={setWindowError} />
    <div className="app-body">
      <section className="workspace-area" aria-label={settings ? translate('common:settings') : translate('common:workspaces2')}>{children}</section>
    </div><footer className="workbench-status">{status}<ErrorNotice message={windowError} onDismiss={()=>setWindowError('')}/></footer>
  </main>;
}
