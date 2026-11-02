import { useRef, useState } from 'react';
import { Button, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react';
import { SaveConnection, ParseQuickConnection } from '../../../bindings/github.com/Sanjeever/termquay/appservice';
import type { Connection, Group } from '../../../bindings/github.com/Sanjeever/termquay/internal/store/models';
import type { Request } from '../../../bindings/github.com/Sanjeever/termquay/internal/ssh/models';

export default function ConnectionDialog({ connection, temporary, groups, busy, connectionError, onConnect, onSaved, onClose, onCancel }: {
  connection?: Connection; temporary: boolean; groups: Group[]; busy: boolean; connectionError: string;
  onConnect(connection: Connection, auth?: Request): Promise<boolean>; onSaved(): void; onClose(): void; onCancel(): void;
}) {
  const [saved, setSaved] = useState(connection);
  const [protocol, setProtocol] = useState(connection?.protocol || 'ssh');
  const [authKind, setAuthKind] = useState('password');
  const [replace, setReplace] = useState(!connection?.credential_id);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [stored, setStored] = useState(false);
  const [credentialEpoch, setCredentialEpoch] = useState(0);
  const [quickAddress, setQuickAddress] = useState('');
  const [parsed, setParsed] = useState<{ value: Connection; epoch: number }>();
  const form = useRef<HTMLFormElement>(null);

  async function submit(mode: 'save' | 'connect' | 'both') {
    if (saving || busy || !form.current?.reportValidity()) return;
    const data = new FormData(form.current);
    const host = String(data.get('host')).trim();
    const config: Connection = { id: saved?.id || '', name: String(data.get('name') || host).trim(), host, port: Number(data.get('port')), protocol, username: String(data.get('username')), group_id: String(data.get('group') || ''), domain: String(data.get('domain') || ''), credential_id: saved?.credential_id || '' };
    const request: Request = { host, port: config.port, username: config.username, password: String(data.get('password') || ''), private_key: String(data.get('private_key') || ''), passphrase: String(data.get('passphrase') || ''), fingerprint: '', cols: 100, rows: 30 };
    setError('');
    try {
      if (mode !== 'connect') {
        setSaving(true); const result = await SaveConnection(config, request); setSaved(result); setStored(true); onSaved(); setSaving(false);
        if (mode === 'save') { onClose(); return; }
        clearSecrets();
        request.password = ''; request.private_key = ''; request.passphrase = '';
        if (await onConnect(result)) onClose();
      } else if (await onConnect(config, request)) onClose();
    } catch (e) { setError(String(e)); }
    finally { setSaving(false); clearSecrets(); request.password = ''; request.private_key = ''; request.passphrase = ''; }
  }
  function clearSecrets() {
    for (const name of ['password', 'private_key', 'passphrase']) { const field = form.current?.elements.namedItem(name) as HTMLInputElement | null; if (field) field.value = ''; }
    if (form.current) setCredentialEpoch(value => value + 1);
  }
  return <Modal isOpen onClose={() => { if (!saving) { onCancel(); onClose(); } }} isDismissable={!busy && !saving} isKeyboardDismissDisabled={saving} size="lg" className="app-dialog" scrollBehavior="inside"><ModalContent>
    <ModalHeader>{temporary ? '快速连接' : saved ? '编辑连接' : '新建连接'}</ModalHeader>
    <ModalBody><form ref={form} id="connection-dialog-form" className="connection-form" onSubmit={e => { e.preventDefault(); void submit(temporary ? 'connect' : 'both'); }}>
      {temporary && <div className="muted">临时连接，不保存配置与凭据</div>}
      {temporary && <div className="button-row"><Input label="地址或 SSH 命令" labelPlacement="outside" placeholder="user@host:22 / ssh -p 22 -l user host" value={quickAddress} onValueChange={setQuickAddress} isDisabled={busy || saving} /><Button size="sm" variant="bordered" isDisabled={busy || saving || !quickAddress.trim()} onPress={async () => { try { const value = await ParseQuickConnection(quickAddress); setProtocol('ssh'); setParsed(prev => ({value,epoch:(prev?.epoch || 0)+1})); setError(''); } catch(e) { setError(String(e)); } }}>解析</Button></div>}
      <Input name="name" label="名称" labelPlacement="outside" placeholder="连接名称" defaultValue={saved?.name} autoFocus size="sm" isDisabled={busy || saving} />
      <label className="form-field">协议<select value={protocol} disabled={busy || saving} onChange={e => { setProtocol(e.target.value); setReplace(true); }}><option value="ssh">SSH</option><option value="rdp">RDP</option></select></label>
      <div className="host-port" key={`address-${parsed?.epoch || 0}`}><Input name="host" label="主机" labelPlacement="outside" placeholder="主机名或 IP" defaultValue={parsed?.value.host ?? saved?.host} isRequired size="sm" isDisabled={busy || saving} autoComplete="off" /><Input key={protocol} name="port" label="端口" labelPlacement="outside" placeholder="端口" type="number" defaultValue={String(parsed?.value.port ?? (saved?.protocol === protocol ? saved.port : protocol === 'ssh' ? 22 : 3389))} min={1} max={65535} isRequired size="sm" isDisabled={busy || saving} /></div>
      <Input key={`user-${parsed?.epoch || 0}`} name="username" label="用户名" labelPlacement="outside" placeholder="用户名" defaultValue={parsed?.value.username ?? saved?.username} isRequired size="sm" isDisabled={busy || saving} autoComplete="off" />
      {protocol === 'rdp' && <Input name="domain" label="域（可选）" labelPlacement="outside" placeholder="域" defaultValue={saved?.domain} size="sm" isDisabled={busy || saving} />}
      {saved?.credential_id && !replace ? <div className="saved-credential"><span>已保存凭据</span><Button size="sm" variant="light" isDisabled={busy || saving} onPress={() => setReplace(true)}>更换凭据</Button></div> : <>
        {saved?.credential_id && <div className="muted">留空沿用已保存凭据</div>}
        {protocol === 'ssh' && <label className="form-field">认证方式<select value={authKind} disabled={busy || saving} onChange={e => setAuthKind(e.target.value)}><option value="password">密码</option><option value="private_key">私钥</option></select></label>}
        {protocol === 'ssh' && authKind === 'private_key' ? <><label className="form-field">私钥内容<textarea key={`key-${credentialEpoch}`} name="private_key" rows={5} disabled={busy || saving} spellCheck={false} autoComplete="off" /></label><Input key={`passphrase-${credentialEpoch}`} name="passphrase" label="私钥口令" labelPlacement="outside" placeholder="可选" type="password" size="sm" autoComplete="off" isDisabled={busy || saving} /></> : <Input key={`password-${credentialEpoch}`} name="password" label="密码" labelPlacement="outside" placeholder="密码" type="password" size="sm" autoComplete="off" isDisabled={busy || saving} />}
      </>}
      {!temporary && <label className="form-field">分组<select name="group" defaultValue={saved?.group_id || ''} disabled={busy || saving}><option value="">未分组</option>{groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>}
      {stored && connectionError && <p className="muted">配置已保存，连接未成功。</p>}
      {(error || connectionError) && <p role="alert" className="error">{error || connectionError}</p>}
    </form></ModalBody>
    <ModalFooter><Button variant="light" isDisabled={saving} onPress={() => { onCancel(); onClose(); }}>{busy ? '取消连接' : '取消'}</Button>{!temporary && <Button variant="bordered" isDisabled={busy || saving} onPress={() => void submit('save')}>保存</Button>}<Button color="primary" type="submit" form="connection-dialog-form" isLoading={busy || saving}>{temporary ? '连接' : '保存并连接'}</Button></ModalFooter>
  </ModalContent></Modal>;
}
