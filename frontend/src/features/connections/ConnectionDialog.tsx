import Modal from '../../components/Modal';
import { t as translate } from '../../i18n/index.ts';
import { message as uiMessage } from '../../i18n/messages.ts';
import { useMessageState } from '../../i18n/useMessageState.ts';
import { useTranslation } from 'react-i18next';
import SelectControl from '../../components/SelectControl';
import { useEffect,useRef, useState } from 'react';
import { Button, Input, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react';
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
  useTranslation();
  const [saved, setSaved] = useState(connection);
  const [protocol, setProtocol] = useState(connection?.protocol || 'ssh');
  const [authKind, setAuthKind] = useState(connection?.auth_method||'password');
  const [mfa, setMFA] = useState(connection?.mfa || false);
  const [referenceID,setReferenceID]=useState('');const [references,setReferences]=useState<CredentialReference[]>([]);
  const [certificate,setCertificate]=useState(connection?.certificate||'');
  const [route,setRoute]=useState(connection?.jump_id?'jump':connection?.proxy_address?'proxy':'direct');
  const connectionIndex=new Map(connections.map(value=>[value.id,value]));
  const jumpCandidates=connections.filter(value=>{if(value.protocol!=='ssh')return false;let current:Connection|undefined=value;let depth=0;const seen=new Set<string>();while(current){if(current.id===saved?.id||seen.has(current.id)||depth++>=4)return false;seen.add(current.id);current=connectionIndex.get(current.jump_id||'');}return true;});
  useEffect(()=>{let ended=false;ListCredentialReferences().then(values=>{if(!ended)setReferences(values||[]);}).catch(e=>{if(!ended)setError(e);});return()=>{ended=true;};},[]);
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
  const [error, setError] = useMessageState('');
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
    request.then(value => { if (active) { originalPassword.current = value; setPassword(value); } }).catch(e => { if (active) setError(uiMessage('connections:couldNotReadPassword', { value1: e })); }).finally(() => { if (active) setPasswordLoading(false); });
    return () => { active = false; request.cancel(); originalPassword.current = ''; };
  }, []);

  async function parseAddress() {
    if (!quickAddress.trim() || parsing) return;
    setParsing(true); setError('');
    try { const value = await ParseQuickConnection(quickAddress); clearSecrets(); setProtocol('ssh'); setAuthKind('password'); setReplace(true); setParsed(prev => ({ value, epoch: (prev?.epoch || 0) + 1 })); setTargetReady(true); }
    catch (e) { setError(e); }
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
        catch (e) { setError(uiMessage('connections:configurationSavedButPreferencesCouldNotBeSaved', { value1: e })); return; }
        onSaved(); setSaving(false);
        if (mode === 'save') { onClose(); return; }
        clearSecrets();
        request.password = ''; request.private_key = ''; request.passphrase = '';
        if (await onConnect(result, undefined, {clipboard:rdpClipboard,resolution:rdpResolution,client:rdpClient,gateway:rdpClient==='internal'?rdpGateway:''})) onClose();
      } else if (await onConnect(config, request, {clipboard:rdpClipboard,resolution:rdpResolution,client:rdpClient,gateway:rdpClient==='internal'?rdpGateway:''})) onClose();
    } catch (e) { setError(e); }
    finally { setSaving(false); clearSecrets(); request.password = ''; request.private_key = ''; request.passphrase = ''; }
  }
  function clearSecrets() {
    setPassword(''); setShowPassword(false); originalPassword.current = '';
    if(privateKeyRef.current){ReleasePrivateKey(privateKeyRef.current.id);setPrivateKey(undefined);}
    for (const name of ['password', 'private_key', 'passphrase']) { const field = form.current?.elements.namedItem(name) as HTMLInputElement | null; if (field) field.value = ''; }
    if (form.current) setCredentialEpoch(value => value + 1);
  }
  return <Modal isOpen onClose={() => { if (!saving) { onCancel(); onClose(); } }} isDismissable={!busy && !saving} isKeyboardDismissDisabled={saving} size="lg" className="app-dialog connection-dialog" scrollBehavior="inside"><ModalContent>
    <ModalHeader>{temporary ? translate('connections:quickConnect') : saved ? translate('connections:editConnection') : translate('connections:newConnection')}</ModalHeader>
    <ModalBody><form ref={form} id="connection-dialog-form" className="connection-form" onSubmit={e => { e.preventDefault(); if (temporary && !targetReady) void parseAddress(); else void submit(temporary ? 'connect' : 'both'); }}>
      {temporary && <details open={!targetReady} className="quick-entry"><summary>{translate('connections:parseSSHAddress')}</summary><div className="quick-address"><Input autoFocus={!connection} label={translate('connections:addressOrSSHCommand')} labelPlacement="outside" placeholder="user@host:22 / ssh -p 22 -l user host" value={quickAddress} onValueChange={value => { setQuickAddress(value); setTargetReady(false); }} isDisabled={busy || saving || parsing} onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); void parseAddress(); } }} /><Button size="sm" variant="bordered" isLoading={parsing} isDisabled={busy || saving || !quickAddress.trim()} onPress={() => void parseAddress()}>{translate('connections:parse')}</Button></div><Button className="manual-connection" size="sm" variant="light" isDisabled={busy || saving || parsing} onPress={() => setTargetReady(true)}>{translate('connections:enterSSHRDPManually')}</Button></details>}
      <div className="connection-target" hidden={!targetReady}>
      <div className="protocol-filters connection-protocol-picker" role="group" aria-label={translate('connections:protocol')}>{['ssh','rdp'].map(value=><button type="button" key={value} aria-pressed={protocol===value} disabled={busy||saving} onClick={()=>{if(value===protocol)return;clearSecrets();setAuthKind('password');setProtocol(value);setReplace(true);}}><Icon name={value==='ssh'?'terminal':'desktop'} width="15" />{value.toUpperCase()}</button>)}</div>
      {!temporary && <div className="connection-identity"><Input name="name" label={translate('connections:name')} labelPlacement="outside" placeholder={translate('connections:defaultsToHostAddress')} defaultValue={saved?.name} size="sm" isDisabled={busy || saving} /><label className="form-field">{translate('connections:groups')}<SelectControl name="group" defaultValue={saved?.group_id || ''} disabled={busy || saving}><option value="">{translate('connections:ungrouped')}</option>{groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</SelectControl></label></div>}
      <div className="host-port" key={`address-${parsed?.epoch || 0}`}><Input autoFocus={!temporary} name="host" label={translate('connections:host')} labelPlacement="outside" placeholder={translate('connections:hostnameOrIP')} defaultValue={parsed?.value.host ?? saved?.host} isRequired errorMessage={translate('connections:enterAHostnameOrIP')} size="sm" isDisabled={busy || saving} autoComplete="off" /><Input key={protocol} name="port" label={translate('connections:port')} labelPlacement="outside" placeholder={translate('connections:port')} type="number" defaultValue={String(protocol === 'ssh' && parsed ? parsed.value.port : (saved?.protocol === protocol ? saved.port : protocol === 'ssh' ? 22 : 3389))} min={1} max={65535} isRequired errorMessage={translate('connections:enterAnIntegerFrom1To65535')} size="sm" isDisabled={busy || saving} /></div>
      <Input className="connection-username" key={`user-${parsed?.epoch || 0}`} name="username" label={translate('connections:username')} labelPlacement="outside" placeholder={translate('connections:username')} defaultValue={parsed?.value.username ?? saved?.username} isRequired errorMessage={translate('connections:enterAUsername')} size="sm" isDisabled={busy || saving} autoComplete="off" />
      {protocol === 'rdp' && <Input className="connection-auth" name="domain" label={translate('connections:domainOptional')} labelPlacement="outside" placeholder={translate('connections:domain')} defaultValue={saved?.domain} size="sm" isDisabled={busy || saving} />}
      {protocol === 'rdp' && <label className="form-field">{translate('connections:client')}<SelectControl value={rdpClient} disabled={busy || saving} onChange={e => {setRDPClient(e.target.value);if(e.target.value!=='system'&&rdpResolution==='multimon')setRDPResolution('dynamic');}}><option value="internal">{translate('connections:builtInClient')}</option><option value="system" disabled={!systemRDP}>{translate('connections:systemClientMstsc')}</option></SelectControl></label>}
      {protocol==='rdp'&&rdpClient==='internal'&&<label className="form-field">{translate('connections:connectionRoute')}<SelectControl value={rdpGateway} disabled={busy||saving} onChange={event=>setRDPGateway(event.target.value)}><option value="">{translate('connections:direct')}</option>{gateways.map(gateway=><option key={gateway.id} value={gateway.id}>{translate('connections:viaSSH')}{gateway.name}</option>)}</SelectControl></label>}
      {referenceID ? <p className="muted">{translate('connections:reuseSelected')}{authKind==='private_key'?translate('connections:privateKey'):translate('connections:password')}{translate('connections:credentials')}</p> : saved?.credential_id && !replace ? <div className="saved-credential"><span>{translate('connections:savedCredentials')}</span><Button size="sm" variant="light" isDisabled={busy || saving} onPress={() => setReplace(true)}>{translate('connections:replaceCredentials')}</Button></div> : authKind === 'keyboard_interactive' && protocol === 'ssh' ? <label className="form-field">{translate('connections:authenticationMethod')}<SelectControl value={authKind} disabled={busy || saving} onChange={event => { clearSecrets(); setAuthKind(event.target.value); }}><option value="password">{translate('connections:password')}</option><option value="private_key">{translate('connections:privateKey')}</option><option value="agent">SSH Agent</option><option value="keyboard_interactive">{translate('connections:interactiveAuthenticationVerificationCode')}</option></SelectControl></label> : <>
        {saved?.credential_id && authKind === 'private_key' && <div className="muted">{translate('connections:leaveBlankToReuseSavedCredentials')}</div>}
        {protocol === 'ssh' && <label className="form-field connection-auth">{translate('connections:authenticationMethod')}<SelectControl value={authKind} disabled={busy || saving} onChange={e => {clearSecrets();setAuthKind(e.target.value);}}><option value="password">{translate('connections:password')}</option><option value="private_key">{translate('connections:privateKey')}</option><option value="agent">SSH Agent</option><option value="keyboard_interactive">{translate('connections:interactiveAuthenticationVerificationCode')}</option></SelectControl></label>}
        {protocol==='ssh'&&authKind==='agent'?<Input name="identity_agent" label={translate('connections:agentAddressOptional')} labelPlacement="outside" defaultValue={saved?.identity_agent} isDisabled={busy||saving} size="sm"/>:protocol === 'ssh' && authKind === 'private_key' ? <><label className="form-field">{translate('connections:privateKeySource')}<SelectControl value={keySource} disabled={busy || saving} onChange={e => { clearSecrets(); setKeySource(e.target.value); }}><option value="file">{translate('connections:localFile')}</option><option value="paste">{translate('connections:pasteContents')}</option></SelectControl></label>{keySource === 'file' ? <div className="button-row"><Button size="sm" variant="bordered" isDisabled={busy||saving} onPress={async()=>{try{const selection=await SelectPrivateKey();if(selection.id){clearSecrets();setPrivateKey(selection);}}catch(e){setError(e);}}}>{translate('connections:selectPrivateKeyFile')}</Button>{privateKey&&<span className="file-path">{privateKey.name}</span>}</div> : <label className="form-field">{translate('connections:privateKeyContents')}<textarea key={`key-${credentialEpoch}`} name="private_key" rows={3} disabled={busy || saving} spellCheck={false} autoComplete="off" /></label>}<Input key={`passphrase-${credentialEpoch}`} name="passphrase" label={translate('connections:privateKeyPassphrase')} labelPlacement="outside" placeholder={translate('connections:optional')} type="password" size="sm" autoComplete="off" isDisabled={busy || saving} /></> : <Input key={`password-${credentialEpoch}`} name="password" label={translate('connections:password')} labelPlacement="outside" placeholder={passwordLoading ? translate('connections:reading') : translate('connections:password')} type={showPassword ? 'text' : 'password'} value={password} onValueChange={setPassword} size="sm" autoComplete="off" isDisabled={busy || saving || passwordLoading} endContent={<button type="button" className="password-toggle" aria-label={showPassword ? translate('connections:hidePassword') : translate('connections:showPassword')} aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)}><Icon name={showPassword ? 'eyeOff' : 'eye'} width="17" /></button>} />}
      </>}
      {protocol === 'ssh' && authKind !== 'keyboard_interactive' && <label className="checkbox-label"><input type="checkbox" checked={mfa} disabled={busy || saving} onChange={event => setMFA(event.target.checked)} />{translate('connections:continueInteractiveAuthenticationMFA')}</label>}
      {protocol==='ssh'&&authKind==='private_key'&&<details><summary>{translate('connections:sSHUserCertificate')}</summary><div className="connection-options-fields"><Button size="sm" variant="light" isDisabled={busy||saving} onPress={async()=>{try{const value=await SelectSSHCertificate();if(value)setCertificate(value);}catch(e){setError(e);}}}>{translate('connections:selectCertificateFile')}</Button><label className="form-field">{translate('connections:userCertificate')}<textarea aria-label={translate('connections:sSHUserCertificate')} rows={3} value={certificate} maxLength={65536} onChange={event=>setCertificate(event.target.value)} disabled={busy||saving} spellCheck={false}/></label></div></details>}
      {!temporary&&!!references.length&&<details><summary>{translate('connections:reuseExistingCredentials')}</summary><label className="form-field">{translate('connections:credentials')}<SelectControl aria-label={translate('connections:reuseExistingCredentials')} value={referenceID} disabled={busy||saving} onChange={event=>{const value=references.find(reference=>reference.id===event.target.value);clearSecrets();setReferenceID(event.target.value);setAuthKind(value?.kind||saved?.auth_method||'password');}}><option value="">{translate('connections:configureIndependentlyForThisConnection')}</option>{references.filter(reference=>protocol==='ssh'||reference.kind==='password').map(reference=><option key={reference.id} value={reference.id}>{reference.names?.[0]||translate('connections:noLinkedCredentials')} · {reference.kind==='password'?translate('connections:password'):translate('connections:privateKey')} · {reference.connection_ids?.length||0} {translate('connections:connections')}</option>)}</SelectControl></label></details>}
      {!temporary && <details className="connection-options" open={!!preference?.environment || !!preference?.tags?.length}><summary>{translate('connections:environmentAndTags')}</summary><div className="connection-options-fields">
      <label className="form-field">{translate('connections:environment')}<SelectControl name="environment" defaultValue={preference?.environment || ''} disabled={busy || saving}><option value="">{translate('connections:notSet')}</option><option value="production">{translate('connections:production')}</option><option value="staging">{translate('connections:staging')}</option><option value="development">{translate('connections:development')}</option></SelectControl></label>
      <Input name="tags" label={translate('connections:tagsCommaSeparated')} labelPlacement="outside" defaultValue={preference?.tags?.join(', ') || ''} maxLength={1040} size="sm" isDisabled={busy || saving} />
      </div></details>}
      {protocol === 'rdp' && <details className="connection-options"><summary>{translate('connections:remoteDesktopOptions')}</summary><div className="connection-options-fields"><label className="checkbox-label"><input type="checkbox" checked={rdpClipboard} onChange={e=>setRDPClipboard(e.target.checked)} disabled={busy||saving} />{translate('connections:textClipboard')}</label><label className="form-field">{translate('connections:remoteResolution')}<SelectControl value={rdpResolution} onChange={e=>setRDPResolution(e.target.value)} disabled={busy||saving}><option value="dynamic">{translate('connections:fitWindow')}</option><option value="1280x800">1280 × 800</option><option value="1920x1080">1920 × 1080</option>{rdpClient==='system'&&<option value="multimon">{translate('connections:allMonitors')}</option>}</SelectControl></label></div></details>}
      {protocol==='ssh'&&<details open={route!=='direct'}><summary>{translate('connections:jumpHostsAndProxy')}</summary><div className="connection-options-fields"><label className="form-field">{translate('connections:connectionRoute')}<SelectControl value={route} onChange={event=>setRoute(event.target.value)} disabled={busy||saving}><option value="direct">{translate('connections:direct')}</option><option value="jump">{translate('connections:sSHJumpHost')}</option><option value="proxy">{translate('connections:sOCKS5Proxy')}</option></SelectControl></label>{route==='jump'&&<label className="form-field">{translate('connections:nextHop')}<SelectControl name="jump" defaultValue={saved?.jump_id||''} disabled={busy||saving} required><option value="">{translate('connections:selectJumpHost')}</option>{jumpCandidates.map(c=><option key={c.id} value={c.id}>{c.name}{c.jump_id?translate('connections:via')+(connectionIndex.get(c.jump_id)?.name||translate('connections:jumpHost')):''}</option>)}</SelectControl></label>}{route==='proxy'&&<Input name="proxy_address" label={translate('connections:sOCKS5ProxyHostPort')} labelPlacement="outside" placeholder="127.0.0.1:1080" defaultValue={saved?.proxy_address} size="sm" isRequired errorMessage={translate('connections:enterASOCKS5ProxyAddress')} isDisabled={busy||saving}/>}</div></details>}
      </div>
      {stored && connectionError && <p className="muted">{translate('connections:configurationSavedConnectionDidNotSucceed')}</p>}
      {(error || connectionError) && <p role="alert" className="error">{error || connectionError}</p>}
      {!!connectionSteps.length && <details><summary>{translate('connections:connectionDiagnostics')}{busy && ` · ${connectionSteps[connectionSteps.length - 1]?.stage}`}</summary><ConnectionDiagnostics steps={connectionSteps} busy={busy} /></details>}
    </form></ModalBody>
    <ModalFooter>{temporary && <span className="temporary-label">{translate('connections:temporaryConnection')}</span>}<Button variant="light" isDisabled={saving} onPress={() => { onCancel(); onClose(); }}>{busy ? translate('connections:cancelConnection') : translate('connections:cancel')}</Button>{!temporary && <Button variant="bordered" isDisabled={busy || saving} onPress={() => void submit('save')}>{translate('connections:save')}</Button>}<Button color="primary" type="submit" form="connection-dialog-form" isDisabled={!targetReady || parsing} isLoading={busy || saving}>{temporary ? translate('connections:connect') : translate('connections:saveAndConnect')}</Button></ModalFooter>
  </ModalContent></Modal>;
}
