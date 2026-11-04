import { useEffect, useState } from 'react';
import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react';
import { GetStorageStatus, SetStoragePassword, UseSystemStorage } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { StorageStatus } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import { errorMessage } from '../../lib/errors';

export default function StorageSettings() {
  const [status, setStatus] = useState<StorageStatus>();
  const [editing, setEditing] = useState<'password' | 'keyring'>();
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { let ended = false; GetStorageStatus().then(value => { if (!ended) setStatus(value); }).catch(e => { if (!ended) setError(errorMessage(e)); }); return () => { ended = true; }; }, []);
  function close() { if (busy) return; setEditing(undefined); setCurrent(''); setPassword(''); setConfirmation(''); setError(''); }
  async function save() {
    if (busy || !editing) return;
    setBusy(true); setError('');
    try { if (editing === 'keyring') await UseSystemStorage(current); else await SetStoragePassword(current, password); setCurrent(''); setPassword(''); setConfirmation(''); setStatus(await GetStorageStatus()); setEditing(undefined); }
    catch (e) { setError(errorMessage(e)); setCurrent(''); setPassword(''); setConfirmation(''); try { setStatus(await GetStorageStatus()); } catch (statusError) { setError(`${errorMessage(e)}；${errorMessage(statusError)}`); } }
    finally { setBusy(false); }
  }
  return <section className="settings-panel"><h2>存储保护</h2><p>{status?.mode === 'password' ? '主密码' : status?.mode === 'session' ? '会话存储' : status ? '系统密钥库' : '正在读取…'}</p>
    {error && !editing && <p className="error" role="alert">{error}</p>}
    {status?.unlocked && status.mode !== 'session' && <div className="button-row"><Button size="sm" variant="light" onPress={() => { setError(''); setEditing('password'); }}>{status.mode === 'password' ? '修改主密码' : '启用主密码'}</Button>{status.mode === 'password' && <Button size="sm" variant="light" onPress={() => { setError(''); setEditing('keyring'); }}>切回系统密钥库</Button>}</div>}
    <Modal isOpen={!!editing} onClose={close} isDismissable={!busy} isKeyboardDismissDisabled={busy} className="app-dialog"><ModalContent><form onSubmit={event => { event.preventDefault(); void save(); }}><ModalHeader>{editing === 'keyring' ? '切回系统密钥库' : status?.mode === 'password' ? '修改主密码' : '启用主密码'}</ModalHeader><ModalBody>
      {status?.mode === 'password' && <label className="form-field">当前主密码<input type="password" autoComplete="current-password" value={current} disabled={busy} maxLength={1024} onChange={event => setCurrent(event.target.value)} /></label>}
      {editing === 'password' && <><label className="form-field">{status?.mode === 'password' ? '新主密码' : '主密码'}<input type="password" autoComplete="new-password" value={password} disabled={busy} maxLength={1024} onChange={event => setPassword(event.target.value)} /></label><label className="form-field">确认主密码<input type="password" autoComplete="new-password" value={confirmation} disabled={busy} maxLength={1024} onChange={event => setConfirmation(event.target.value)} /></label><p className="muted">主密码至少 8 个字符，下次启动需输入。遗忘后需使用独立加密备份恢复。</p></>}
      <p className="muted">保护已保存的凭据和加密设置，连接名称与地址仍为本机元数据。</p>{error && <p className="error" role="alert">{error}</p>}
    </ModalBody><ModalFooter><Button variant="light" isDisabled={busy} onPress={close}>取消</Button><Button color="primary" type="submit" isLoading={busy} isDisabled={editing === 'password' ? Array.from(password).length < 8 || password !== confirmation || status?.mode === 'password' && !current : !current}>确认切换</Button></ModalFooter></form></ModalContent></Modal>
  </section>;
}
