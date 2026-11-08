import { errorMessage } from "../../lib/errors";
import BackupRecoverySettings from './BackupRecoverySettings';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button, Input } from '@heroui/react';
import { BackupNow, CheckSavedWebDAV, ExportLocalSnapshot, GetBackupCoverage, GetBackupSettings, OpenRestoreBackupDirectory, SaveBackupSettings, SavePortableUI, SetAutomaticBackupEnabled } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { BackupCoverage, BackupSelection, BackupSettings as BackupPreferences } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import type { WebDAVOptions } from '../../../bindings/github.com/Sanjeever/termquay/internal/backup/models';
import type { Connection } from '../../../bindings/github.com/Sanjeever/termquay/internal/store/models';
import { capturePortableUI } from './portable';
import type useAutomaticBackup from './useAutomaticBackup';
import BackupHistory from './BackupHistory';
import RestoreBackupDialog from './RestoreBackupDialog';
import ErrorNotice from '../../components/ErrorNotice';
import { workflowBackupOptions, workflowBackupSelection } from './backupContent';

export default function BackupSettings({ onRestore, onEditConnection, connections, automaticBackup }: {
  onRestore(): void; onEditConnection(id: string): void; connections: Connection[]; automaticBackup: ReturnType<typeof useAutomaticBackup>;
}) {
  const [preferences, setPreferences] = useState<BackupPreferences>();
  const [coverage, setCoverage] = useState<BackupCoverage[]>([]);
  const [locationEditing, setLocationEditing] = useState(false);
  const [backupEditing, setBackupEditing] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [newConfiguration, setNewConfiguration] = useState(false);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState<{ area: string; message: string }>();
  const [restoring, setRestoring] = useState<string>();
  const [historyRevision, setHistoryRevision] = useState(0);
  const [allConnections, setAllConnections] = useState(true);
  const [connectionIDs, setConnectionIDs] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const localForm = useRef<HTMLFormElement>(null);
  const mounted = useRef(true);
  const [loadRevision, setLoadRevision] = useState(0);

  useEffect(() => {
    mounted.current = true;
    const request = GetBackupSettings();
    request.then(value => { if (mounted.current) { setPreferences(value); setNewConfiguration(!value.configured); setLocationEditing(!value.configured); setBackupEditing(!value.recovery_saved); void automaticBackup.refresh(); } }).catch(error => { if (mounted.current) setError({ area: 'location', message: errorMessage(error) }); });
    return () => { mounted.current = false; request.cancel(); };
  }, [loadRevision]);
  useEffect(() => {
    let disposed = false;
    const request = GetBackupCoverage();
    request.then(value => { if (!disposed) setCoverage(value || []); }).catch(error => { if (!disposed) setError({ area: 'backup', message: errorMessage(error) }); });
    return () => { disposed = true; request.cancel(); };
  }, [connections]);

  async function run(area: string, task: () => Promise<void>) {
    if (busy) return;
    setBusy(area); setError(undefined);
    try { await task(); }
    catch (error) { if (mounted.current) {setError({ area, message: errorMessage(error) });if(area==='backup')await automaticBackup.refresh();} }
    finally { if (mounted.current) setBusy(''); }
  }
  async function refreshPreferences() {
    const value = await GetBackupSettings();
    if (mounted.current) setPreferences(value);
    await automaticBackup.refresh();
  }
  function options(): WebDAVOptions {
    return { url: preferences!.url, username: preferences!.username, directory: preferences!.directory, password: '' };
  }
  async function saveLocation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const target: WebDAVOptions = { url: String(data.get('url')).trim(), username: String(data.get('username')), directory: String(data.get('directory')).trim(), password: String(data.get('password') || '') };
    await run('location', async () => {
      await SaveBackupSettings(target, '', preferences!.device_name, preferences!.selection);
      await refreshPreferences(); setLocationEditing(false); setChecked(false); setHistoryRevision(value => value + 1);
    });
    target.password = '';
  }
  async function saveBackup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await run('backup', async () => {
      const password = String(data.get('recovery') || '');
      if (password && password !== String(data.get('confirmation') || '')) throw new Error('两次输入的备份密码不一致');
      const selection: BackupSelection = { connection_ids: [], credentials: data.get('credentials') === 'on', snippets: data.get('snippets') === 'on', settings: data.get('settings') === 'on', ...workflowBackupSelection(data) };
      const enableAutomatic = !preferences!.recovery_saved && data.get('automatic') === 'on';
      if (selection.settings) await SavePortableUI(capturePortableUI());
      await SaveBackupSettings(options(), password, String(data.get('device_name')), selection);
      await refreshPreferences(); setBackupEditing(false); setChangingPassword(false); setHistoryRevision(value => value + 1);
      if (enableAutomatic) { await SetAutomaticBackupEnabled(true); await automaticBackup.refresh(); }
    });
    data.set('recovery', ''); data.set('confirmation', '');
  }
  async function exportFile() {
    const form = localForm.current;
    if (!form || !form.reportValidity()) return;
    const data = new FormData(form);
    await run('files', async () => {
      if (!allConnections && !connectionIDs.length) throw new Error('请选择要导出的连接');
      const selection: BackupSelection = { connection_ids: allConnections ? [] : connectionIDs, credentials: data.get('credentials') === 'on', snippets: data.get('snippets') === 'on', settings: data.get('settings') === 'on', ...workflowBackupSelection(data) };
      if (selection.settings) await SavePortableUI(capturePortableUI());
      await ExportLocalSnapshot(String(data.get('password') || ''), selection);
    });
    const password = form.elements.namedItem('password') as HTMLInputElement;
    password.value = '';
  }
  const status = automaticBackup.status;
  const automaticLabel = status?.running ? '正在备份' : status?.pending ? '等待备份' : status?.enabled ? '已开启' : '已暂停';
  return <section className="settings-panel backup-settings">
    <h2>备份恢复</h2>
    <section className="backup-section">
      <div className="backup-section-heading"><h3>备份位置</h3>{preferences?.configured && !locationEditing && <Button size="sm" variant="light" isDisabled={!!busy} onPress={() => setLocationEditing(true)}>修改</Button>}</div>
      {!preferences && !error && <p role="status" className="muted">正在读取设置…</p>}
      {preferences && (locationEditing ? <form onSubmit={event => void saveLocation(event)}>
        <Input name="url" type="url" label="WebDAV 地址" labelPlacement="outside" placeholder="https://" defaultValue={preferences.url} size="sm" isRequired isDisabled={!!busy}/>
        <Input name="directory" label="备份目录" labelPlacement="outside" defaultValue={preferences.directory} size="sm" isRequired isDisabled={!!busy}/>
        <div className="backup-form-columns"><Input name="username" label="用户名" labelPlacement="outside" defaultValue={preferences.username} autoComplete="off" size="sm" isDisabled={!!busy}/><Input name="password" label="WebDAV 登录密码" labelPlacement="outside" placeholder={preferences.password_saved ? '已保存，留空沿用' : ''} type="password" autoComplete="off" size="sm" isDisabled={!!busy}/></div>
        <div className="button-row"><Button size="sm" type="submit" color="primary" isLoading={busy === 'location'} isDisabled={!!busy}>保存位置</Button>{preferences.configured && <Button size="sm" variant="light" isDisabled={!!busy} onPress={() => setLocationEditing(false)}>取消</Button>}</div>
      </form> : <><dl className="backup-location"><div><dt>地址</dt><dd>{preferences.url.replace(/\/$/, '')}/{preferences.directory}</dd></div>{preferences.username && <div><dt>用户</dt><dd>{preferences.username}</dd></div>}</dl><Button size="sm" variant="bordered" isLoading={busy === 'location'} isDisabled={!!busy} onPress={() => void run('location', async () => { await CheckSavedWebDAV(); setChecked(true); })}>{checked ? '读写与发布检查通过' : '检查连接'}</Button></>)}
      <ErrorNotice message={error?.area==='location'?error.message:''} onDismiss={preferences?()=>setError(undefined):undefined}>{!preferences&&<button className="session-tool" onClick={()=>{setError(undefined);setLoadRevision(value=>value+1);void automaticBackup.refresh(true);}}>重新读取备份设置</button>}</ErrorNotice>
    </section>

    {preferences && <section className="backup-section">
      <div className="backup-section-heading"><h3>本机备份</h3>{!backupEditing && <Button size="sm" variant="light" isDisabled={!!busy || !preferences.configured} onPress={() => setBackupEditing(true)}>修改</Button>}</div>
      {backupEditing ? <form onSubmit={event => void saveBackup(event)}>
        <Input name="device_name" label="设备名称" labelPlacement="outside" defaultValue={preferences.device_name} size="sm" maxLength={100} isRequired isDisabled={!!busy}/>
        <Input name="recovery" label={preferences.recovery_saved ? '更换备份加密密码' : '备份加密密码'} labelPlacement="outside" placeholder={preferences.recovery_saved ? '已保存，留空沿用' : ''} type="password" autoComplete="new-password" size="sm" isRequired={!preferences.recovery_saved} isDisabled={!!busy} onValueChange={value => setChangingPassword(!!value)}/>
        {changingPassword && <Input name="confirmation" label="再次输入备份加密密码" labelPlacement="outside" type="password" autoComplete="new-password" size="sm" isRequired isDisabled={!!busy}/>}
        {changingPassword && preferences.recovery_saved && <p className="muted">旧备份仍需原密码解锁。</p>}
        <fieldset className="backup-content-options" disabled={!!busy}><legend>备份内容 · 全部连接</legend><label className="checkbox-label"><input type="checkbox" name="credentials" defaultChecked={preferences.selection.credentials}/>携带已保存密码与私钥</label><label className="checkbox-label"><input type="checkbox" name="snippets" defaultChecked={preferences.selection.snippets}/>命令片段</label><label className="checkbox-label"><input type="checkbox" name="settings" defaultChecked={preferences.selection.settings}/>外观与快捷键</label>{workflowBackupOptions.map(option => <label className="checkbox-label" key={option.field}><input type="checkbox" name={option.field} defaultChecked={!!preferences.selection[option.field]}/>{option.label}</label>)}</fieldset>
        {!preferences.recovery_saved && <label className="checkbox-label"><input type="checkbox" name="automatic" defaultChecked={newConfiguration} disabled={!!busy}/>保存后启用自动备份</label>}
        <div className="button-row"><Button size="sm" type="submit" color="primary" isLoading={busy === 'backup'} isDisabled={!!busy || !preferences.configured}>保存备份设置</Button>{preferences.recovery_saved && <Button size="sm" variant="light" isDisabled={!!busy} onPress={() => { setBackupEditing(false); setChangingPassword(false); }}>取消</Button>}</div>
      </form> : <dl className="backup-location"><div><dt>设备</dt><dd>{preferences.device_name}</dd></div><div><dt>内容</dt><dd>全部连接{preferences.selection.credentials ? '、已保存密码与私钥' : '（不携带凭据）'}{preferences.selection.snippets && '、命令片段'}{preferences.selection.settings && '、外观与快捷键'}{workflowBackupOptions.filter(option => preferences.selection[option.field]).map(option => `、${option.label}`).join('')}</dd></div></dl>}
      <div className="backup-automatic-row">{(!backupEditing || preferences.recovery_saved) && <label className="checkbox-label"><input type="checkbox" role="switch" aria-label="自动备份" checked={!!status?.enabled} disabled={!!busy || !preferences.configured || !preferences.recovery_saved || backupEditing || locationEditing} onChange={event => { const enabled = event.target.checked; void run('backup', async () => { await SetAutomaticBackupEnabled(enabled); await automaticBackup.refresh(); }); }}/>自动备份<span className="muted">{automaticLabel}</span></label>}<Button size="sm" variant="bordered" isLoading={busy === 'backup' || !!status?.running} isDisabled={!!busy || !!status?.running || !preferences.configured || !preferences.recovery_saved || backupEditing || locationEditing} onPress={() => void run('backup', async () => { if (preferences.selection.settings) await SavePortableUI(capturePortableUI()); await BackupNow(); await automaticBackup.refresh(); setHistoryRevision(value => value + 1); })}>{status?.error ? '重试备份' : '立即备份'}</Button></div>
      <p className="muted backup-last-success">{status?.last_success ? `最近成功 ${new Date(status.last_success).toLocaleString()}` : '尚无成功备份记录'}</p>
      {!!coverage.length && <details className="backup-coverage"><summary>需要补齐或在目标设备配置的认证 · {coverage.length} 个连接</summary><ul>{coverage.map(item => <li key={item.connection_id}><div><strong>{item.name}</strong><span className="muted">{item.reason}</span></div>{item.can_save && <Button size="sm" variant="light" isDisabled={!!busy} onPress={() => onEditConnection(item.connection_id)}>补齐凭据</Button>}</li>)}</ul></details>}
      <ErrorNotice message={error?.area==='backup'?error.message:''} onDismiss={()=>setError(undefined)}/>
      {(automaticBackup.error || status?.error) && <details className="error backup-failure-details"><summary>最近备份失败</summary><p>{automaticBackup.error || status?.error}</p></details>}
    </section>}

    {preferences&&<BackupRecoverySettings disabled={!!busy}/>}
    {preferences?.configured && !locationEditing && <BackupHistory key={`${preferences.url}\n${preferences.username}\n${preferences.directory}`} deviceID={preferences.device_id} deviceName={preferences.device_name} recoverySaved={preferences.recovery_saved} revision={`${historyRevision}:${status?.last_success || ''}`} onRestore={path => setRestoring(path)}/>}

    {preferences && <details className="backup-local-files"><summary>本地加密文件</summary><form ref={localForm} onSubmit={event => { event.preventDefault(); void exportFile(); }}>
      <Input name="password" label="导出加密密码" labelPlacement="outside" placeholder={preferences.recovery_saved ? '留空使用已保存密码' : ''} type="password" autoComplete="new-password" size="sm" isDisabled={!!busy}/>
      <fieldset className="backup-content-options" disabled={!!busy}><legend>导出内容</legend><label className="checkbox-label"><input type="checkbox" name="credentials" defaultChecked={preferences.selection.credentials}/>携带已保存密码与私钥</label><label className="checkbox-label"><input type="checkbox" name="snippets" defaultChecked={preferences.selection.snippets}/>命令片段</label><label className="checkbox-label"><input type="checkbox" name="settings" defaultChecked={preferences.selection.settings}/>外观与快捷键</label>{workflowBackupOptions.map(option => <label className="checkbox-label" key={option.field}><input type="checkbox" name={option.field} defaultChecked={!!preferences.selection[option.field]}/>{option.label}</label>)}</fieldset>
      <label className="checkbox-label"><input type="checkbox" checked={allConnections} disabled={!!busy} onChange={event => setAllConnections(event.target.checked)}/>全部连接</label>
      {!allConnections && <><Input aria-label="筛选导出连接" placeholder="搜索连接" size="sm" value={search} onValueChange={setSearch}/><div className="backup-connection-list">{connections.filter(connection => `${connection.name} ${connection.host}`.toLowerCase().includes(search.toLowerCase())).map(connection => <label className="checkbox-label" key={connection.id}><input type="checkbox" disabled={!!busy || (!connectionIDs.includes(connection.id) && connectionIDs.length >= 256)} checked={connectionIDs.includes(connection.id)} onChange={event => setConnectionIDs(previous => event.target.checked ? [...previous, connection.id] : previous.filter(id => id !== connection.id))}/>{connection.name}<small className="muted">{connection.host}</small></label>)}</div><span className="muted">已选 {connectionIDs.length}/256，包含依赖跳板和分组</span></>}
      <div className="button-row"><Button size="sm" variant="bordered" type="submit" isLoading={busy === 'files'} isDisabled={!!busy}>导出加密文件</Button><Button size="sm" variant="light" isDisabled={!!busy} onPress={() => setRestoring('')}>从文件恢复</Button></div>
    </form></details>}
    <Button className="backup-protection-directory" size="sm" variant="light" isDisabled={!!busy} onPress={() => void run('files', async () => { await OpenRestoreBackupDirectory(); })}>打开恢复保护副本目录</Button>
    <ErrorNotice message={error?.area==='files'?error.message:''} onDismiss={()=>setError(undefined)}/>
    {restoring !== undefined && <RestoreBackupDialog path={restoring} recoverySaved={!!preferences?.recovery_saved} hasConnections={!!connections.length} onClose={() => setRestoring(undefined)} onRestored={() => { onRestore(); setHistoryRevision(value => value + 1); }} onError={message => setError({ area: 'files', message })}/>}
  </section>;
}
