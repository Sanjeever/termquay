import { useEffect, useState } from 'react';
import { GetCLIAccess, SaveCLIAccess } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import { errorMessage } from '../../lib/errors';

export default function CLISettings() {
  const [enabled, setEnabled] = useState<boolean>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    GetCLIAccess().then(value => { if (active) setEnabled(value); }).catch(e => { if (active) setError(errorMessage(e)); });
    return () => { active = false; };
  }, []);
  return <div className="settings-section">
    <h2>本机 CLI</h2>
    <div className="settings-row"><label><input type="checkbox" checked={enabled ?? false} disabled={enabled === undefined || busy} onChange={async event => {
      const next = event.target.checked;
      setBusy(true);
      try { await SaveCLIAccess(next); setEnabled(next); setError(''); }
      catch (e) { setError(errorMessage(e)); }
      finally { setBusy(false); }
    }} />允许本机 CLI 访问</label></div>
    <p className="muted">允许同一系统用户的本机进程查看连接并在已连接 SSH 工作区执行命令。命令可修改远端；应用锁定或关闭此开关后阻止新请求。</p>
    {error && <p className="error" role="alert">{error}</p>}
  </div>;
}
