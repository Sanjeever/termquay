import { useEffect, useState } from 'react';
import { Button } from '@heroui/react';
import { CreatePasswordStorage, GetStorageStatus, UnlockPasswordStorage, UseSessionStorage } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { StorageStatus } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import { errorMessage } from '../../lib/errors';

export default function StorageAccess({ error: initialError, onOpened }: { error: string; onOpened(): Promise<void> }) {
  const [status, setStatus] = useState<StorageStatus>();
  const [create, setCreate] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { let ended = false; GetStorageStatus().then(value => { if (!ended) setStatus(value); }).catch(e => { if (!ended) setError(errorMessage(e)); }); return () => { ended = true; }; }, []);
  async function open(session = false) {
    if (busy) return;
    if (!session && create && password !== confirmation) { setError('两次输入的主密码不一致'); return; }
    setBusy(true); setError('');
    try { if (session) await UseSessionStorage(); else if (create) await CreatePasswordStorage(password); else await UnlockPasswordStorage(password); setPassword(''); setConfirmation(''); await onOpened(); }
    catch (e) { setError(errorMessage(e)); setPassword(''); setConfirmation(''); try { const next = await GetStorageStatus(); setStatus(next); if (next.mode === 'password') setCreate(false); } catch (statusError) { setError(`${errorMessage(e)}；${errorMessage(statusError)}`); } }
    finally { setBusy(false); }
  }
  return <section className="settings-panel storage-access" aria-label="本机数据解锁"><h2>{status?.mode === 'password' ? '解锁本机数据' : create ? '创建主密码存储' : '本机存储不可用'}</h2>
    {status?.mode !== 'password' && !create && <p className="error" role="alert">{initialError}</p>}
    {!status?.unlocked && (status?.mode === 'password' || create) && <form onSubmit={event => { event.preventDefault(); void open(); }}><label className="form-field">主密码<input autoFocus type="password" autoComplete={create ? 'new-password' : 'current-password'} value={password} disabled={busy} maxLength={1024} onChange={event => setPassword(event.target.value)} /></label>{create && <label className="form-field">确认主密码<input type="password" autoComplete="new-password" value={confirmation} disabled={busy} maxLength={1024} onChange={event => setConfirmation(event.target.value)} /></label>}<Button type="submit" color="primary" isLoading={busy} isDisabled={!password || create && (Array.from(password).length < 8 || password !== confirmation)}>{create ? '创建并打开' : '解锁'}</Button></form>}
    {create && <p className="muted">主密码至少 8 个字符。遗忘后需使用独立加密备份恢复。</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {status?.unlocked && <Button size="sm" variant="light" onPress={() => void onOpened()}>重新读取本机数据</Button>}
    <div className="button-row">{status?.can_create && !create && <Button size="sm" variant="light" isDisabled={busy} onPress={() => setCreate(true)}>使用主密码创建存储</Button>}{status?.mode !== 'password' && !create && <Button size="sm" variant="light" isDisabled={busy} onPress={() => void onOpened()}>重试系统密钥库</Button>}<Button size="sm" variant="light" isDisabled={busy} onPress={() => void open(true)}>本次使用会话存储</Button></div>
  </section>;
}
