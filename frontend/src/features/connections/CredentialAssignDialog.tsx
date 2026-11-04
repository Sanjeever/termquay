import { errorMessage } from "../../lib/errors";
import { useEffect, useState } from 'react';
import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react';
import SelectControl from '../../components/SelectControl';
import { AssignCredential, ListCredentialReferences } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { CredentialReference } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import type { Connection } from '../../../bindings/github.com/Sanjeever/termquay/internal/store/models';

export default function CredentialAssignDialog({ connections, onChanged, onClose }: { connections: Connection[]; onChanged(): void; onClose(): void }) {
  const [references,setReferences]=useState<CredentialReference[]>([]);const [selected,setSelected]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  useEffect(()=>{ListCredentialReferences().then(values=>setReferences(values||[])).catch(e=>setError(errorMessage(e)));},[]);
  return <Modal isOpen onClose={()=>!busy&&onClose()} className="app-dialog" isDismissable={!busy}><ModalContent><ModalHeader>复用凭据</ModalHeader><ModalBody><label className="form-field">凭据<SelectControl value={selected} disabled={busy} onChange={event=>setSelected(event.target.value)}><option value="">选择已有凭据</option>{references.filter(reference=>!connections.some(connection=>connection.protocol==='rdp')||reference.kind==='password').map(reference=><option value={reference.id} key={reference.id}>{reference.names?.[0]||'未关联凭据'} · {reference.kind==='password'?'密码':'私钥'} · {reference.connection_ids?.length||0} 个连接</option>)}</SelectControl></label><ul className="batch-paths">{connections.map(connection=><li key={connection.id}>{connection.name}<small className="muted"> · {connection.host}</small></li>)}</ul>{error&&<p role="alert" className="error">{error}</p>}</ModalBody><ModalFooter><Button variant="light" isDisabled={busy} onPress={onClose}>取消</Button><Button color="primary" isDisabled={!selected||busy} onPress={async()=>{setBusy(true);try{await AssignCredential(connections.map(connection=>connection.id),selected);onChanged();onClose();}catch(e){setError(errorMessage(e));}finally{setBusy(false);}}}>用于 {connections.length} 个连接</Button></ModalFooter></ModalContent></Modal>;
}
