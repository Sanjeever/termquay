import { t } from '../../i18n/index.ts';
import { useMessageState } from '../../i18n/useMessageState.ts';
import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import { GetCLIAccess, SaveCLIAccess } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';


export default function CLISettings() {
  useTranslation();
  const [enabled, setEnabled] = useState<boolean>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useMessageState('');
  useEffect(() => {
    let active = true;
    GetCLIAccess().then(value => { if (active) setEnabled(value); }).catch(e => { if (active) setError(e); });
    return () => { active = false; };
  }, []);
  return <div className="settings-section">
    <h2>{t('settings:localCLI')}</h2>
    <div className="settings-row"><label><input type="checkbox" checked={enabled ?? false} disabled={enabled === undefined || busy} onChange={async event => {
      const next = event.target.checked;
      setBusy(true);
      try { await SaveCLIAccess(next); setEnabled(next); setError(''); }
      catch (e) { setError(e); }
      finally { setBusy(false); }
    }} />{t('settings:allowLocalCLIAccess')}</label></div>
    <p className="muted">{t('settings:allowLocalProcessesRunningAsTheSameOS')}</p>
    {error && <p className="error" role="alert">{error}</p>}
  </div>;
}
