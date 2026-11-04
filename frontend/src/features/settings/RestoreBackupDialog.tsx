import { useEffect, useRef, useState } from 'react';
import { Button, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react';
import { CancelRestorePreview, ConfirmRestoreWithOptions, GetPortableUI, PreviewLocalRestore, PreviewSavedRestore } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { RestorePreview } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import { applyPortableUI } from './portable';

const settingNames: Record<string, string> = { snippets: '命令片段', appearance: '外观', shortcuts: '快捷键' };

export default function RestoreBackupDialog({ path, hasConnections, recoverySaved, onRestored, onClose, onError }: {
  path: string; hasConnections: boolean; recoverySaved: boolean; onRestored(): void; onClose(): void; onError(message: string): void;
}) {
  const [preview, setPreview] = useState<RestorePreview>();
  const previewID = useRef('');
  const [mode, setMode] = useState<'import' | 'replace'>(hasConnections ? 'import' : 'replace');
  const [selected, setSelected] = useState<string[]>([]);
  const [settings, setSettings] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [completed, setCompleted] = useState(false);
  const [showPassword, setShowPassword] = useState(!recoverySaved);
  const mounted = useRef(true);
  const request = useRef<ReturnType<typeof PreviewSavedRestore>>();

  async function unlock(password: string) {
    setBusy(true); setError('');
    try {
      request.current = path ? PreviewSavedRestore(path, password) : PreviewLocalRestore(password);
      const value = await request.current;
      if (!mounted.current) { if (value.id) await CancelRestorePreview(value.id); return; }
      if (!value.id) { onClose(); return; }
      previewID.current = value.id; setPreview(value); setShowPassword(false);
      setSelected((value.connections || []).length <= 256 ? (value.connections || []).map(connection => connection.id) : []);
      setSettings(mode === 'replace' ? (value.settings || []).filter(key => key === 'snippets') : []);
    } catch (error) {
      if (mounted.current) { setError(String(error)); setShowPassword(true); }
    } finally { if (mounted.current) setBusy(false); }
  }
  useEffect(() => {
    mounted.current = true;
    if (recoverySaved) void unlock('');
    return () => { mounted.current = false; request.current?.cancel(); if (previewID.current) void CancelRestorePreview(previewID.current).catch(error => onError(String(error))); };
  }, []);

  function chooseMode(next: 'import' | 'replace') {
    setMode(next); setConfirmed(false);
    setSettings(next === 'replace' ? (preview?.settings || []).filter(key => key === 'snippets') : []);
  }
  const connections = preview?.connections || [];
  const chosen = new Set(selected);
  const byID = new Map(connections.map(connection => [connection.id, connection]));
  function includeJump(id: string) {
    const jump = byID.get(id)?.jump_id;
    if (jump && !chosen.has(jump)) { chosen.add(jump); includeJump(jump); }
  }
  selected.forEach(includeJump);
  const imported = connections.filter(connection => chosen.has(connection.id));
  const credentialCount = new Set(imported.map(connection => connection.credential_id).filter(Boolean)).size;
  async function restore() {
    if (!preview || busy) return;
    setBusy(true); setError('');
    try {
      await ConfirmRestoreWithOptions(preview.id, selected, mode === 'replace', settings);
      previewID.current = ''; setCompleted(true);
      onRestored();
      if (settings.includes('appearance') || settings.includes('shortcuts')) applyPortableUI(await GetPortableUI());
      onClose();
    } catch (error) { setError(String(error)); }
    finally { setBusy(false); }
  }
  return <Modal isOpen onClose={() => { if (!busy) onClose(); }} isDismissable={!busy} isKeyboardDismissDisabled={busy} size="2xl" scrollBehavior="inside" className="app-dialog restore-backup-dialog"><ModalContent>
    <ModalHeader>{completed ? '数据已恢复' : '恢复备份'}</ModalHeader>
    <ModalBody>
      {busy && !preview && <p role="status" className="muted">正在读取并解锁备份…</p>}
      {showPassword && !preview && <form id="unlock-backup" onSubmit={event => { event.preventDefault(); const form = event.currentTarget; const password = form.elements.namedItem('password') as HTMLInputElement; const value = password.value; password.value = ''; void unlock(value); }}><Input name="password" label="这份备份的加密密码" labelPlacement="outside" type="password" autoComplete="off" size="sm" isRequired isDisabled={busy} autoFocus/></form>}
      {preview && <>
        <div className="backup-restore-source"><strong>{preview.device_name || `设备 ${preview.device_id.slice(0, 8)}`}</strong><time dateTime={preview.created_at}>{new Date(preview.created_at).toLocaleString()}</time><span className="muted">{connections.length} 个连接 · {preview.credentials} 项凭据{preview.credentials_included == null ? ' · 携带范围未知' : ''}</span></div>
        <fieldset className="backup-restore-modes" disabled={busy || completed}><legend>恢复方式</legend><label><input type="radio" name="restore-mode" checked={mode === 'import'} onChange={() => chooseMode('import')}/>导入连接副本</label><label><input type="radio" name="restore-mode" checked={mode === 'replace'} onChange={() => chooseMode('replace')}/>替换本机连接</label></fieldset>
        {mode === 'import' ? <>
          <div className="backup-import-toolbar"><Input aria-label="筛选恢复连接" placeholder="搜索连接" size="sm" value={search} onValueChange={setSearch} isDisabled={busy || completed}/><label className="checkbox-label"><input type="checkbox" checked={!!connections.length && selected.length === connections.length} disabled={busy || completed || connections.length > 256} onChange={event => setSelected(event.target.checked ? connections.map(connection => connection.id) : [])}/>全选</label><span className="muted">已选 {selected.length}/256</span></div>
          <div className="backup-connection-list">{connections.filter(connection => `${connection.name} ${connection.host}`.toLowerCase().includes(search.toLowerCase())).map(connection => <label className="checkbox-label" key={connection.id}><input type="checkbox" checked={selected.includes(connection.id)} disabled={busy || completed || (!selected.includes(connection.id) && selected.length >= 256)} onChange={event => setSelected(previous => event.target.checked ? [...previous, connection.id] : previous.filter(id => id !== connection.id))}/><span>{connection.name}<small className="muted">{connection.host}</small></span></label>)}</div>
          <p className="muted">将新增 {imported.length} 个连接副本、{credentialCount} 项凭据，包含依赖跳板。重复导入会产生新副本。</p>
        </> : <>
          <div className="backup-restore-diff">{([['新增', preview.added], ['配置更新', preview.updated], ['凭据更新', preview.credential_updated], ['删除', preview.removed]] as const).map(([name, values]) => <details key={name}><summary>{name} {values?.length || 0}</summary><ul>{values?.map((value, index) => <li key={index}>{value}</li>)}</ul></details>)}</div>
          {(preview.credentials_included === false || !preview.credentials) && <p role="alert" className="error">这份备份没有已保存的连接密码或私钥。替换会移除本机现有凭据。</p>}
          <p className="muted">替换前将保存本机加密保护副本，保存失败会停止替换。</p>
        </>}
        {!!preview.settings?.length && <fieldset className="backup-restore-settings" disabled={busy || completed}><legend>同时恢复</legend>{preview.settings.map(key => <label className="checkbox-label" key={key}><input type="checkbox" checked={settings.includes(key)} onChange={event => setSettings(previous => event.target.checked ? [...previous, key] : previous.filter(item => item !== key))}/>{settingNames[key] || key}{key === 'snippets' && '（替换本机片段）'}</label>)}</fieldset>}
        {mode === 'replace' && !completed && <label className="checkbox-label backup-replace-confirm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)}/>确认替换本机连接、分组和凭据</label>}
      </>}
      {error && <p role="alert" className="error">{error}</p>}
    </ModalBody>
    <ModalFooter><Button size="sm" variant="light" isDisabled={busy} onPress={onClose}>{completed ? '关闭' : '取消'}</Button>{!preview && showPassword && <Button size="sm" color="primary" type="submit" form="unlock-backup" isLoading={busy}>解锁</Button>}{preview && !completed && <Button size="sm" color={mode === 'replace' ? 'danger' : 'primary'} isLoading={busy} isDisabled={mode === 'replace' ? !confirmed : !selected.length} onPress={() => void restore()}>{mode === 'replace' ? '替换本机连接' : '导入连接副本'}</Button>}</ModalFooter>
  </ModalContent></Modal>;
}
