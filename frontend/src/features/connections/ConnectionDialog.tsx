import { errorMessage } from "../../lib/errors";
import SelectControl from '../../components/SelectControl';
import { useEffect,useRef, useState } from 'react';
import { Button, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react';
import { SaveConnection, GetConnectionPassword, ParseQuickConnection, SetRDPResolution, SetRDPClient, SetConnectionPreference, GetConnectionPreferences, SelectPrivateKey,ReleasePrivateKey } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import Icon from '../../components/Icon';
import type { RDPOptions } from '../rdp/RDPView';
import type {PrivateKeySelection, CredentialReference}from'../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import { ListCredentialReferences, SaveConnectionWithCredential, SelectSSHCertificate, SetConnectionTags } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { Connection, ConnectionPreference, Group } from '../../../bindings/github.com/Sanjeever/termquay/internal/store/models';
import type { Request } from '../../../bindings/github.com/Sanjeever/termquay/internal/ssh/models';
import type { ConnectionStep } from '../../../bindings/github.com/Sanjeever/termquay/internal/ssh/models';
import ConnectionDiagnostics from './ConnectionDiagnostics';

export default function ConnectionDialog({ connection, temporary, groups, connections, busy, connectionError, connectionSteps = [], onConnect, onSaved, onClose, onCancel, rdpOptions, preference, systemRDP, gateways=[] }: {
  connection?: Connection; temporary: boolean; groups: Group[]; busy: boolean; connectionError: string;
  connections:Connection[];
  preference?: ConnectionPreference;
  systemRDP: boolean;
  gateways?: {id:string;name:string}[];
  connectionSteps?: ConnectionStep[];
  onConnect(connection: Connection, auth?: Request, options?: RDPOptions): Promise<boolean>; onSaved(): void; onClose(): void; onCancel(): void; rdpOptions?: RDPOptions;
}) {
  const [saved, setSaved] = useState(connection);
  const [protocol, setProtocol] = useState(connection?.protocol || 'ssh');
  const [authKind, setAuthKind] = useState(connection?.auth_method||'password');
  const [mfa, setMFA] = useState(connection?.mfa || false);
  const [referenceID,setReferenceID]=useState('');const [references,setReferences]=useState<CredentialReference[]>([]);
  const [certificate,setCertificate]=useState(connection?.certificate||'');
  const [route,setRoute]=useState(connection?.jump_id?'jump':connection?.proxy_address?'proxy':'direct');
  const connectionIndex=new Map(connections.map(value=>[value.id,value]));
  const jumpCandidates=connections.filter(value=>{if(value.protocol!=='ssh')return false;let current:Connection|undefined=value;let depth=0;const seen=new Set<string>();while(current){if(current.id===saved?.id||seen.has(current.id)||depth++>=4)return false;seen.add(current.id);current=connectionIndex.get(current.jump_id||'');}return true;});
  useEffect(()=>{let ended=false;ListCredentialReferences().then(values=>{if(!ended)setReferences(values||[]);}).catch(e=>{if(!ended)setError(errorMessage(e));});return()=>{ended=true;};},[]);
  useEffect(()=>{setReferenceID('');},[protocol]);
  const [privateKey,setPrivateKey]=useState<PrivateKeySelection>();
  const privateKeyRef=useRef(privateKey);privateKeyRef.current=privateKey;
  useEffect(()=>()=>{if(privateKeyRef.current)ReleasePrivateKey(privateKeyRef.current.id);},[]);
  const [replace, setReplace] = useState(!connection?.credential_id || !connection.auth_method || connection.auth_method === 'password');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(!!connection?.credential_id && (!connection.auth_method || connection.auth_method === 'password'));
  const originalPassword = useRef('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [stored, setStored] = useState(false);
  const [credentialEpoch, setCredentialEpoch] = useState(0);
  const [quickAddress, setQuickAddress] = useState('');
  const [targetReady, setTargetReady] = useState(!temporary || !!connection);
  const [parsing, setParsing] = useState(false);
  const [keySource, setKeySource] = useState('file');
  const [parsed, setParsed] = useState<{ value: Connection; epoch: number }>();
  const [rdpClipboard, setRDPClipboard] = useState(rdpOptions?.clipboard || false);
  const [rdpResolution, setRDPResolution] = useState(rdpOptions?.resolution || 'dynamic');
  const [rdpClient, setRDPClient] = useState(rdpOptions?.client || preference?.rdp_client || 'internal');
  const [rdpGateway,setRDPGateway]=useState(rdpOptions?.gateway||'');
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!passwordLoading || !connection) return;
    let active = true;
    const request = GetConnectionPassword(connection.id);
    request.then(value => { if (active) { originalPassword.current = value; setPassword(value); } }).catch(e => { if (active) setError(`读取密码失败：${errorMessage(e)}`); }).finally(() => { if (active) setPasswordLoading(false); });
    return () => { active = false; request.cancel(); originalPassword.current = ''; };
  }, []);

  async function parseAddress() {
    if (!quickAddress.trim() || parsing) return;
    setParsing(true); setError('');
    try { const value = await ParseQuickConnection(quickAddress); clearSecrets(); setProtocol('ssh'); setAuthKind('password'); setReplace(true); setParsed(prev => ({ value, epoch: (prev?.epoch || 0) + 1 })); setTargetReady(true); }
    catch (e) { setError(errorMessage(e)); }
    finally { setParsing(false); }
  }

  async function submit(mode: 'save' | 'connect' | 'both') {
    if (saving || busy || passwordLoading || !targetReady || !form.current?.reportValidity()) return;
    const data = new FormData(form.current);
    const host = String(data.get('host')).trim();
    const config: Connection = { id: saved?.id || '', name: String(data.get('name') || host).trim(), host, port: Number(data.get('port')), protocol, username: String(data.get('username')), group_id: String(data.get('group') || ''), domain: String(data.get('domain') || ''), credential_id: saved?.credential_id || '',auth_method:protocol==='ssh'?(replace?authKind:saved?.auth_method||''):'',identity_agent:protocol==='ssh'&&authKind==='agent'?String(data.get('identity_agent')||saved?.identity_agent||''):'',jump_id:protocol==='ssh'?String(data.get('jump')||''):'' };
    config.mfa = protocol === 'ssh' && authKind !== 'keyboard_interactive' && mfa;
    config.certificate = protocol === 'ssh' && authKind === 'private_key' ? certificate : '';
    if(route!=='jump')config.jump_id='';
    config.proxy_address = protocol === 'ssh' && route==='proxy' ? String(data.get('proxy_address') || '').trim() : '';
    const request: Request = { host, port: config.port, username: config.username, password: String(data.get('password') || ''), private_key: String(data.get('private_key') || ''), passphrase: String(data.get('passphrase') || ''), fingerprint: '', cols: 100, rows: 30,auth_method:protocol==='ssh'?authKind:'',identity_agent:config.identity_agent,private_key_token:privateKey?.id,jump_id:config.jump_id,mfa:config.mfa };
    setError('');
    request.certificate = config.certificate; request.proxy_address = config.proxy_address;
    try {
      if (mode !== 'connect') {
        if (request.password === originalPassword.current) request.password = '';
        setSaving(true); const result = referenceID ? await SaveConnectionWithCredential(config, request, referenceID) : await SaveConnection(config, request); setSaved(result); setStored(true); onSaved();
        try { const latest = (await GetConnectionPreferences())?.[result.id]; await SetConnectionPreference(result.id, !!latest?.favorite, String(data.get('environment') || '')); await SetConnectionTags(result.id, String(data.get('tags') || '').split(/[,，]/).map(tag => tag.trim()).filter(Boolean)); if (protocol === 'rdp') { await SetRDPResolution(result.id, rdpResolution); await SetRDPClient(result.id, rdpClient); } }
        catch (e) { setError(`配置已保存，偏好保存失败：${errorMessage(e)}`); return; }
        onSaved(); setSaving(false);
        if (mode === 'save') { onClose(); return; }
        clearSecrets();
        request.password = ''; request.private_key = ''; request.passphrase = '';
        if (await onConnect(result, undefined, {clipboard:rdpClipboard,resolution:rdpResolution,client:rdpClient,gateway:rdpClient==='internal'?rdpGateway:''})) onClose();
      } else if (await onConnect(config, request, {clipboard:rdpClipboard,resolution:rdpResolution,client:rdpClient,gateway:rdpClient==='internal'?rdpGateway:''})) onClose();
    } catch (e) { setError(errorMessage(e)); }
    finally { setSaving(false); clearSecrets(); request.password = ''; request.private_key = ''; request.passphrase = ''; }
  }
  function clearSecrets() {
    setPassword(''); setShowPassword(false); originalPassword.current = '';
    if(privateKeyRef.current){ReleasePrivateKey(privateKeyRef.current.id);setPrivateKey(undefined);}
    for (const name of ['password', 'private_key', 'passphrase']) { const field = form.current?.elements.namedItem(name) as HTMLInputElement | null; if (field) field.value = ''; }
    if (form.current) setCredentialEpoch(value => value + 1);
  }
  return <Modal isOpen onClose={() => { if (!saving) { onCancel(); onClose(); } }} isDismissable={!busy && !saving} isKeyboardDismissDisabled={saving} size="lg" className="app-dialog connection-dialog" scrollBehavior="inside"><ModalContent>
    <ModalHeader>{temporary ? '快速连接' : saved ? '编辑连接' : '新建连接'}</ModalHeader>
    <ModalBody><form ref={form} id="connection-dialog-form" className="connection-form" onSubmit={e => { e.preventDefault(); if (temporary && !targetReady) void parseAddress(); else void submit(temporary ? 'connect' : 'both'); }}>
      {temporary && <details open={!targetReady} className="quick-entry"><summary>解析 SSH 地址</summary><div className="quick-address"><Input autoFocus={!connection} label="地址或 SSH 命令" labelPlacement="outside" placeholder="user@host:22 / ssh -p 22 -l user host" value={quickAddress} onValueChange={value => { setQuickAddress(value); setTargetReady(false); }} isDisabled={busy || saving || parsing} onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); void parseAddress(); } }} /><Button size="sm" variant="bordered" isLoading={parsing} isDisabled={busy || saving || !quickAddress.trim()} onPress={() => void parseAddress()}>解析</Button></div><Button className="manual-connection" size="sm" variant="light" isDisabled={busy || saving || parsing} onPress={() => setTargetReady(true)}>手动填写 SSH / RDP</Button></details>}
      <div className="connection-target" hidden={!targetReady}>
      <div className="protocol-filters connection-protocol-picker" role="group" aria-label="连接协议">{['ssh','rdp'].map(value=><button type="button" key={value} aria-pressed={protocol===value} disabled={busy||saving} onClick={()=>{if(value===protocol)return;clearSecrets();setAuthKind('password');setProtocol(value);setReplace(true);}}><Icon name={value==='ssh'?'terminal':'desktop'} width="15" />{value.toUpperCase()}</button>)}</div>
      {!temporary && <div className="connection-identity"><Input name="name" label="名称" labelPlacement="outside" placeholder="默认使用主机地址" defaultValue={saved?.name} size="sm" isDisabled={busy || saving} /><label className="form-field">分组<SelectControl name="group" defaultValue={saved?.group_id || ''} disabled={busy || saving}><option value="">未分组</option>{groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</SelectControl></label></div>}
      <div className="host-port" key={`address-${parsed?.epoch || 0}`}><Input autoFocus={!temporary} name="host" label="主机" labelPlacement="outside" placeholder="主机名或 IP" defaultValue={parsed?.value.host ?? saved?.host} isRequired errorMessage="请输入主机名或 IP" size="sm" isDisabled={busy || saving} autoComplete="off" /><Input key={protocol} name="port" label="端口" labelPlacement="outside" placeholder="端口" type="number" defaultValue={String(protocol === 'ssh' && parsed ? parsed.value.port : (saved?.protocol === protocol ? saved.port : protocol === 'ssh' ? 22 : 3389))} min={1} max={65535} isRequired errorMessage="请输入 1–65535 的整数" size="sm" isDisabled={busy || saving} /></div>
      <Input className="connection-username" key={`user-${parsed?.epoch || 0}`} name="username" label="用户名" labelPlacement="outside" placeholder="用户名" defaultValue={parsed?.value.username ?? saved?.username} isRequired errorMessage="请输入用户名" size="sm" isDisabled={busy || saving} autoComplete="off" />
      {protocol === 'rdp' && <Input className="connection-auth" name="domain" label="域（可选）" labelPlacement="outside" placeholder="域" defaultValue={saved?.domain} size="sm" isDisabled={busy || saving} />}
      {protocol === 'rdp' && <label className="form-field">连接方式<SelectControl value={rdpClient} disabled={busy || saving} onChange={e => {setRDPClient(e.target.value);if(e.target.value!=='system'&&rdpResolution==='multimon')setRDPResolution('dynamic');}}><option value="internal">内置客户端</option><option value="system" disabled={!systemRDP}>系统客户端（mstsc）</option></SelectControl></label>}
      {protocol==='rdp'&&rdpClient==='internal'&&<label className="form-field">连接路径<SelectControl value={rdpGateway} disabled={busy||saving} onChange={event=>setRDPGateway(event.target.value)}><option value="">直连</option>{gateways.map(gateway=><option key={gateway.id} value={gateway.id}>经 SSH · {gateway.name}</option>)}</SelectControl></label>}
      {referenceID ? <p className="muted">复用所选{authKind==='private_key'?'私钥':'密码'}凭据</p> : saved?.credential_id && !replace ? <div className="saved-credential"><span>已保存凭据</span><Button size="sm" variant="light" isDisabled={busy || saving} onPress={() => setReplace(true)}>更换凭据</Button></div> : authKind === 'keyboard_interactive' && protocol === 'ssh' ? <label className="form-field">认证方式<SelectControl value={authKind} disabled={busy || saving} onChange={event => { clearSecrets(); setAuthKind(event.target.value); }}><option value="password">密码</option><option value="private_key">私钥</option><option value="agent">SSH Agent</option><option value="keyboard_interactive">交互认证 / 验证码</option></SelectControl></label> : <>
        {saved?.credential_id && authKind === 'private_key' && <div className="muted">留空沿用已保存凭据</div>}
        {protocol === 'ssh' && <label className="form-field connection-auth">认证方式<SelectControl value={authKind} disabled={busy || saving} onChange={e => {clearSecrets();setAuthKind(e.target.value);}}><option value="password">密码</option><option value="private_key">私钥</option><option value="agent">SSH Agent</option><option value="keyboard_interactive">交互认证 / 验证码</option></SelectControl></label>}
        {protocol==='ssh'&&authKind==='agent'?<Input name="identity_agent" label="Agent 地址（可选）" labelPlacement="outside" defaultValue={saved?.identity_agent} isDisabled={busy||saving} size="sm"/>:protocol === 'ssh' && authKind === 'private_key' ? <><label className="form-field">私钥来源<SelectControl value={keySource} disabled={busy || saving} onChange={e => { clearSecrets(); setKeySource(e.target.value); }}><option value="file">本机文件</option><option value="paste">粘贴内容</option></SelectControl></label>{keySource === 'file' ? <div className="button-row"><Button size="sm" variant="bordered" isDisabled={busy||saving} onPress={async()=>{try{const selection=await SelectPrivateKey();if(selection.id){clearSecrets();setPrivateKey(selection);}}catch(e){setError(errorMessage(e));}}}>选择私钥文件</Button>{privateKey&&<span className="file-path">{privateKey.name}</span>}</div> : <label className="form-field">私钥内容<textarea key={`key-${credentialEpoch}`} name="private_key" rows={3} disabled={busy || saving} spellCheck={false} autoComplete="off" /></label>}<Input key={`passphrase-${credentialEpoch}`} name="passphrase" label="私钥口令" labelPlacement="outside" placeholder="可选" type="password" size="sm" autoComplete="off" isDisabled={busy || saving} /></> : <Input key={`password-${credentialEpoch}`} name="password" label="密码" labelPlacement="outside" placeholder={passwordLoading ? '正在读取…' : '密码'} type={showPassword ? 'text' : 'password'} value={password} onValueChange={setPassword} size="sm" autoComplete="off" isDisabled={busy || saving || passwordLoading} endContent={<button type="button" className="password-toggle" aria-label={showPassword ? '隐藏密码' : '显示密码'} aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)}><Icon name={showPassword ? 'eyeOff' : 'eye'} width="17" /></button>} />}
      </>}
      {protocol === 'ssh' && authKind !== 'keyboard_interactive' && <label className="checkbox-label"><input type="checkbox" checked={mfa} disabled={busy || saving} onChange={event => setMFA(event.target.checked)} />继续交互认证（MFA）</label>}
      {protocol==='ssh'&&authKind==='private_key'&&<details><summary>SSH 用户证书</summary><div className="connection-options-fields"><Button size="sm" variant="light" isDisabled={busy||saving} onPress={async()=>{try{const value=await SelectSSHCertificate();if(value)setCertificate(value);}catch(e){setError(errorMessage(e));}}}>选择证书文件</Button><label className="form-field">用户证书<textarea aria-label="SSH 用户证书" rows={3} value={certificate} maxLength={65536} onChange={event=>setCertificate(event.target.value)} disabled={busy||saving} spellCheck={false}/></label></div></details>}
      {!temporary&&!!references.length&&<details><summary>复用已有凭据</summary><label className="form-field">凭据<SelectControl aria-label="复用已有凭据" value={referenceID} disabled={busy||saving} onChange={event=>{const value=references.find(reference=>reference.id===event.target.value);clearSecrets();setReferenceID(event.target.value);setAuthKind(value?.kind||saved?.auth_method||'password');}}><option value="">当前连接独立配置</option>{references.filter(reference=>protocol==='ssh'||reference.kind==='password').map(reference=><option key={reference.id} value={reference.id}>{reference.names?.[0]||'未关联凭据'} · {reference.kind==='password'?'密码':'私钥'} · {reference.connection_ids?.length||0} 个连接</option>)}</SelectControl></label></details>}
      {!temporary && <details className="connection-options" open={!!preference?.environment || !!preference?.tags?.length}><summary>环境与标签</summary><div className="connection-options-fields">
      <label className="form-field">环境<SelectControl name="environment" defaultValue={preference?.environment || ''} disabled={busy || saving}><option value="">未设置</option><option value="production">生产</option><option value="staging">预发布</option><option value="development">开发</option></SelectControl></label>
      <Input name="tags" label="标签（逗号分隔）" labelPlacement="outside" defaultValue={preference?.tags?.join(', ') || ''} maxLength={1040} size="sm" isDisabled={busy || saving} />
      </div></details>}
      {protocol === 'rdp' && <details className="connection-options"><summary>远程桌面选项</summary><div className="connection-options-fields"><label className="checkbox-label"><input type="checkbox" checked={rdpClipboard} onChange={e=>setRDPClipboard(e.target.checked)} disabled={busy||saving} />文本剪贴板</label><label className="form-field">远端分辨率<SelectControl value={rdpResolution} onChange={e=>setRDPResolution(e.target.value)} disabled={busy||saving}><option value="dynamic">适应窗口</option><option value="1280x800">1280 × 800</option><option value="1920x1080">1920 × 1080</option>{rdpClient==='system'&&<option value="multimon">全部显示器</option>}</SelectControl></label></div></details>}
      {protocol==='ssh'&&<details open={route!=='direct'}><summary>跳板与代理</summary><div className="connection-options-fields"><label className="form-field">连接路径<SelectControl value={route} onChange={event=>setRoute(event.target.value)} disabled={busy||saving}><option value="direct">直连</option><option value="jump">SSH 跳板</option><option value="proxy">SOCKS5 代理</option></SelectControl></label>{route==='jump'&&<label className="form-field">下一跳<SelectControl name="jump" defaultValue={saved?.jump_id||''} disabled={busy||saving} required><option value="">选择跳板机</option>{jumpCandidates.map(c=><option key={c.id} value={c.id}>{c.name}{c.jump_id?' · 经 '+(connectionIndex.get(c.jump_id)?.name||'跳板'):''}</option>)}</SelectControl></label>}{route==='proxy'&&<Input name="proxy_address" label="SOCKS5 代理（主机:端口）" labelPlacement="outside" placeholder="127.0.0.1:1080" defaultValue={saved?.proxy_address} size="sm" isRequired errorMessage="请输入 SOCKS5 代理地址" isDisabled={busy||saving}/>}</div></details>}
      </div>
      {stored && connectionError && <p className="muted">配置已保存，连接未成功。</p>}
      {(error || connectionError) && <p role="alert" className="error">{error || connectionError}</p>}
      {!!connectionSteps.length && <details><summary>连接诊断{busy && ` · ${connectionSteps[connectionSteps.length - 1]?.stage}`}</summary><ConnectionDiagnostics steps={connectionSteps} busy={busy} /></details>}
    </form></ModalBody>
    <ModalFooter>{temporary && <span className="temporary-label">临时连接</span>}<Button variant="light" isDisabled={saving} onPress={() => { onCancel(); onClose(); }}>{busy ? '取消连接' : '取消'}</Button>{!temporary && <Button variant="bordered" isDisabled={busy || saving} onPress={() => void submit('save')}>保存</Button>}<Button color="primary" type="submit" form="connection-dialog-form" isDisabled={!targetReady || parsing} isLoading={busy || saving}>{temporary ? '连接' : '保存并连接'}</Button></ModalFooter>
  </ModalContent></Modal>;
}
