import { useEffect,useRef, useState } from 'react';
import { Button, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react';
import { SaveConnection, ParseQuickConnection, SetRDPResolution,SelectPrivateKey,ReleasePrivateKey } from '../../../bindings/github.com/Sanjeever/termquay/appservice';
import type { RDPOptions } from '../rdp/RDPView';
import type {PrivateKeySelection}from'../../../bindings/github.com/Sanjeever/termquay/models';
import type { Connection, Group } from '../../../bindings/github.com/Sanjeever/termquay/internal/store/models';
import type { Request } from '../../../bindings/github.com/Sanjeever/termquay/internal/ssh/models';

export default function ConnectionDialog({ connection, temporary, groups, connections, busy, connectionError, onConnect, onSaved, onClose, onCancel, rdpOptions }: {
  connection?: Connection; temporary: boolean; groups: Group[]; busy: boolean; connectionError: string;
  connections:Connection[];
  onConnect(connection: Connection, auth?: Request, options?: RDPOptions): Promise<boolean>; onSaved(): void; onClose(): void; onCancel(): void; rdpOptions?: RDPOptions;
}) {
  const [saved, setSaved] = useState(connection);
  const [protocol, setProtocol] = useState(connection?.protocol || 'ssh');
  const [authKind, setAuthKind] = useState(connection?.auth_method||'password');
  const [privateKey,setPrivateKey]=useState<PrivateKeySelection>();
  const privateKeyRef=useRef(privateKey);privateKeyRef.current=privateKey;
  useEffect(()=>()=>{if(privateKeyRef.current)ReleasePrivateKey(privateKeyRef.current.id);},[]);
  const [replace, setReplace] = useState(!connection?.credential_id);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [stored, setStored] = useState(false);
  const [credentialEpoch, setCredentialEpoch] = useState(0);
  const [quickAddress, setQuickAddress] = useState('');
  const [parsed, setParsed] = useState<{ value: Connection; epoch: number }>();
  const [rdpClipboard, setRDPClipboard] = useState(rdpOptions?.clipboard || false);
  const [rdpResolution, setRDPResolution] = useState(rdpOptions?.resolution || 'dynamic');
  const form = useRef<HTMLFormElement>(null);

  async function submit(mode: 'save' | 'connect' | 'both') {
    if (saving || busy || !form.current?.reportValidity()) return;
    const data = new FormData(form.current);
    const host = String(data.get('host')).trim();
    const config: Connection = { id: saved?.id || '', name: String(data.get('name') || host).trim(), host, port: Number(data.get('port')), protocol, username: String(data.get('username')), group_id: String(data.get('group') || ''), domain: String(data.get('domain') || ''), credential_id: saved?.credential_id || '',auth_method:protocol==='ssh'?(replace?authKind:saved?.auth_method||''):'',identity_agent:protocol==='ssh'&&authKind==='agent'?String(data.get('identity_agent')||saved?.identity_agent||''):'',jump_id:protocol==='ssh'?String(data.get('jump')||''):'' };
    const request: Request = { host, port: config.port, username: config.username, password: String(data.get('password') || ''), private_key: String(data.get('private_key') || ''), passphrase: String(data.get('passphrase') || ''), fingerprint: '', cols: 100, rows: 30,auth_method:protocol==='ssh'?authKind:'',identity_agent:config.identity_agent,private_key_token:privateKey?.id,jump_id:config.jump_id };
    setError('');
    try {
      if (mode !== 'connect') {
        setSaving(true); const result = await SaveConnection(config, request); setSaved(result); setStored(true); if (protocol === 'rdp') await SetRDPResolution(result.id, rdpResolution); onSaved(); setSaving(false);
        if (mode === 'save') { onClose(); return; }
        clearSecrets();
        request.password = ''; request.private_key = ''; request.passphrase = '';
        if (await onConnect(result, undefined, {clipboard:rdpClipboard,resolution:rdpResolution})) onClose();
      } else if (await onConnect(config, request, {clipboard:rdpClipboard,resolution:rdpResolution})) onClose();
    } catch (e) { setError(String(e)); }
    finally { setSaving(false); clearSecrets(); request.password = ''; request.private_key = ''; request.passphrase = ''; }
  }
  function clearSecrets() {
    if(privateKeyRef.current){ReleasePrivateKey(privateKeyRef.current.id);setPrivateKey(undefined);}
    for (const name of ['password', 'private_key', 'passphrase']) { const field = form.current?.elements.namedItem(name) as HTMLInputElement | null; if (field) field.value = ''; }
    if (form.current) setCredentialEpoch(value => value + 1);
  }
  return <Modal isOpen onClose={() => { if (!saving) { onCancel(); onClose(); } }} isDismissable={!busy && !saving} isKeyboardDismissDisabled={saving} size="lg" className="app-dialog" scrollBehavior="inside"><ModalContent>
    <ModalHeader>{temporary ? '快速连接' : saved ? '编辑连接' : '新建连接'}</ModalHeader>
    <ModalBody><form ref={form} id="connection-dialog-form" className="connection-form" onSubmit={e => { e.preventDefault(); void submit(temporary ? 'connect' : 'both'); }}>
      {temporary && <div className="muted">临时连接，不保存配置与凭据</div>}
      {temporary && <div className="button-row"><Input label="地址或 SSH 命令" labelPlacement="outside" placeholder="user@host:22 / ssh -p 22 -l user host" value={quickAddress} onValueChange={setQuickAddress} isDisabled={busy || saving} /><Button size="sm" variant="bordered" isDisabled={busy || saving || !quickAddress.trim()} onPress={async () => { try { const value = await ParseQuickConnection(quickAddress); setProtocol('ssh'); setParsed(prev => ({value,epoch:(prev?.epoch || 0)+1})); setError(''); } catch(e) { setError(String(e)); } }}>解析</Button></div>}
      <Input name="name" label="名称" labelPlacement="outside" placeholder="连接名称" defaultValue={saved?.name} autoFocus size="sm" isDisabled={busy || saving} />
      <label className="form-field">协议<select value={protocol} disabled={busy || saving} onChange={e => { clearSecrets();setAuthKind('password');setProtocol(e.target.value); setReplace(true); }}><option value="ssh">SSH</option><option value="rdp">RDP</option></select></label>
      <div className="host-port" key={`address-${parsed?.epoch || 0}`}><Input name="host" label="主机" labelPlacement="outside" placeholder="主机名或 IP" defaultValue={parsed?.value.host ?? saved?.host} isRequired size="sm" isDisabled={busy || saving} autoComplete="off" /><Input key={protocol} name="port" label="端口" labelPlacement="outside" placeholder="端口" type="number" defaultValue={String(parsed?.value.port ?? (saved?.protocol === protocol ? saved.port : protocol === 'ssh' ? 22 : 3389))} min={1} max={65535} isRequired size="sm" isDisabled={busy || saving} /></div>
      <Input key={`user-${parsed?.epoch || 0}`} name="username" label="用户名" labelPlacement="outside" placeholder="用户名" defaultValue={parsed?.value.username ?? saved?.username} isRequired size="sm" isDisabled={busy || saving} autoComplete="off" />
      {protocol === 'rdp' && <Input name="domain" label="域（可选）" labelPlacement="outside" placeholder="域" defaultValue={saved?.domain} size="sm" isDisabled={busy || saving} />}
      {protocol === 'rdp' && <><label className="checkbox-label"><input type="checkbox" checked={rdpClipboard} onChange={e=>setRDPClipboard(e.target.checked)} disabled={busy||saving} />文本剪贴板</label><label className="form-field">远端分辨率<select value={rdpResolution} onChange={e=>setRDPResolution(e.target.value)} disabled={busy||saving}><option value="dynamic">适应窗口</option><option value="1280x800">1280 × 800</option><option value="1920x1080">1920 × 1080</option></select></label></>}
      {saved?.credential_id && !replace ? <div className="saved-credential"><span>已保存凭据</span><Button size="sm" variant="light" isDisabled={busy || saving} onPress={() => setReplace(true)}>更换凭据</Button></div> : <>
        {saved?.credential_id && <div className="muted">留空沿用已保存凭据</div>}
        {protocol === 'ssh' && <label className="form-field">认证方式<select value={authKind} disabled={busy || saving} onChange={e => {clearSecrets();setAuthKind(e.target.value);}}><option value="password">密码</option><option value="private_key">私钥</option><option value="agent">SSH Agent</option></select></label>}
        {protocol==='ssh'&&authKind==='agent'?<Input name="identity_agent" label="Agent 地址（可选）" labelPlacement="outside" defaultValue={saved?.identity_agent} isDisabled={busy||saving} size="sm"/>:protocol === 'ssh' && authKind === 'private_key' ? <><div className="button-row"><Button size="sm" variant="bordered" isDisabled={busy||saving} onPress={async()=>{try{const selection=await SelectPrivateKey();if(selection.id){clearSecrets();setPrivateKey(selection);}}catch(e){setError(String(e));}}}>选择私钥文件</Button>{privateKey&&<span>{privateKey.name}</span>}</div><label className="form-field">私钥内容<textarea key={`key-${credentialEpoch}`} name="private_key" rows={5} disabled={busy || saving||!!privateKey} spellCheck={false} autoComplete="off" /></label><Input key={`passphrase-${credentialEpoch}`} name="passphrase" label="私钥口令" labelPlacement="outside" placeholder="可选" type="password" size="sm" autoComplete="off" isDisabled={busy || saving} /></> : <Input key={`password-${credentialEpoch}`} name="password" label="密码" labelPlacement="outside" placeholder="密码" type="password" size="sm" autoComplete="off" isDisabled={busy || saving} />}
      </>}
      {!temporary && <label className="form-field">分组<select name="group" defaultValue={saved?.group_id || ''} disabled={busy || saving}><option value="">未分组</option>{groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>}
      {protocol==='ssh'&&<details><summary>内网连接</summary><label className="form-field">跳板机<select name="jump" defaultValue={saved?.jump_id||''} disabled={busy||saving}><option value="">直连</option>{connections.filter(c=>c.protocol==='ssh'&&!c.jump_id&&c.id!==saved?.id).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label></details>}
      {stored && connectionError && <p className="muted">配置已保存，连接未成功。</p>}
      {(error || connectionError) && <p role="alert" className="error">{error || connectionError}</p>}
    </form></ModalBody>
    <ModalFooter><Button variant="light" isDisabled={saving} onPress={() => { onCancel(); onClose(); }}>{busy ? '取消连接' : '取消'}</Button>{!temporary && <Button variant="bordered" isDisabled={busy || saving} onPress={() => void submit('save')}>保存</Button>}<Button color="primary" type="submit" form="connection-dialog-form" isLoading={busy || saving}>{temporary ? '连接' : '保存并连接'}</Button></ModalFooter>
  </ModalContent></Modal>;
}
