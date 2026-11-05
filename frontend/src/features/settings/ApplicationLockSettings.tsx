import { useEffect, useState } from 'react';
import { Button } from '@heroui/react';
import { GetApplicationLock, ConfigureApplicationLock } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import SelectControl from '../../components/SelectControl';
import { errorMessage } from '../../lib/errors';

export default function ApplicationLockSettings() {
  const [minutes, setMinutes] = useState(0);
  const [system, setSystem] = useState(true);
  const [baseline, setBaseline] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { let ended = false; const request = GetApplicationLock(); request.then(value => { if (!ended) { setMinutes(value.idle_minutes); setSystem(value.lock_on_system); setBaseline(JSON.stringify([value.idle_minutes, value.lock_on_system])); } }).catch(e => { if (!ended) setError(errorMessage(e)); }); return () => { ended = true; request.cancel(); }; }, []);
  async function save() { setBusy(true); setError(''); try { const value = await ConfigureApplicationLock(minutes, system); setBaseline(JSON.stringify([value.idle_minutes, value.lock_on_system])); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); } }
  return <div className="settings-field"><label className="form-field">空闲时锁定<SelectControl value={minutes} disabled={busy || !baseline} onChange={event => setMinutes(Number(event.target.value))}>{[0, 1, 5, 10, 15, 30, 60, 120].map(value => <option key={value} value={value}>{value ? `${value} 分钟` : '关闭'}</option>)}</SelectControl></label><label className="checkbox-label"><input type="checkbox" checked={system} disabled={busy || !baseline} onChange={event => setSystem(event.target.checked)} />系统锁屏或睡眠时锁定</label><Button size="sm" variant="light" isLoading={busy} isDisabled={!baseline || baseline === JSON.stringify([minutes, system])} onPress={() => void save()}>保存应用锁设置</Button>{error && <p className="error" role="alert">{error}</p>}</div>;
}
