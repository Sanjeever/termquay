import { useEffect, useState } from 'react';
import { Button, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react';
import { ListCredentialReferences, UpdateCredential } from '../../../bindings/github.com/Sanjeever/termquay/appservice';
import type { CredentialReference } from '../../../bindings/github.com/Sanjeever/termquay/models';
import type { Request } from '../../../bindings/github.com/Sanjeever/termquay/internal/ssh/models';

export default function CredentialSettings({ onChanged }: { onChanged(): void }) {
  const [items, setItems] = useState<CredentialReference[]>([]);
  const [editing, setEditing] = useState<CredentialReference>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function load() { try { setItems(await ListCredentialReferences() || []); } catch (e) { setError(String(e)); } }
  useEffect(() => { void load(); }, []);
  return <section className="settings-panel"><h2>凭据</h2>{error && <p role="alert" className="error">{error}</p>}<ul className="credential-list">{items.map(item => <li key={item.id}><div><strong>{item.names?.[0] || '未关联凭据'}</strong><span className="muted">{item.kind === 'private_key' ? '私钥' : '密码'} · {item.connection_ids?.length || 0} 个连接</span>{(item.names?.length || 0) > 1 && <details><summary>关联连接</summary><ul>{item.names?.map((name,index) => <li key={index}>{name}</li>)}</ul></details>}</div><Button size="sm" variant="light" onPress={() => { setError(''); setEditing(item); }}>更新凭据</Button></li>)}</ul>
    <Modal isOpen={!!editing} onClose={() => !busy && setEditing(undefined)} className="app-dialog" isDismissable={!busy}><ModalContent><ModalHeader>更新共享凭据</ModalHeader><form onSubmit={async event => { event.preventDefault(); if (!editing || busy) return; const data = new FormData(event.currentTarget); const auth: Request = { host:'',port:22,username:'',password:String(data.get('password') || ''),private_key:String(data.get('private_key') || ''),passphrase:String(data.get('passphrase') || ''),fingerprint:'',cols:80,rows:24 }; setBusy(true); try { await UpdateCredential(editing.id,auth,editing.connection_ids || []); setEditing(undefined); await load(); onChanged(); } catch (e) { setError(String(e)); } finally { setBusy(false); auth.password='';auth.private_key='';auth.passphrase=''; } }}><ModalBody><p>更新将用于以下 {editing?.connection_ids?.length || 0} 个连接的新会话</p><ul className="batch-paths">{editing?.names?.map((name,index) => <li key={index}>{name}</li>)}</ul>{editing?.kind === 'private_key' ? <><label className="form-field">新私钥<textarea name="private_key" aria-label="新私钥" rows={5} autoComplete="off" spellCheck={false} required disabled={busy}/></label><Input name="passphrase" type="password" label="私钥口令" labelPlacement="outside" autoComplete="off" isDisabled={busy}/></> : <Input autoFocus name="password" type="password" label="新密码" labelPlacement="outside" autoComplete="new-password" isRequired isDisabled={busy}/>} {error && <p role="alert" className="error">{error}</p>}</ModalBody><ModalFooter><Button variant="light" isDisabled={busy} onPress={() => setEditing(undefined)}>取消</Button><Button color="primary" type="submit" isLoading={busy}>更新 {editing?.connection_ids?.length || 0} 个连接</Button></ModalFooter></form></ModalContent></Modal>
  </section>;
}
