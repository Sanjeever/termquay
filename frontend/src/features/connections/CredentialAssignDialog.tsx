import Modal from '../../components/Modal';
import { t as translate } from '../../i18n/index.ts';
import { useMessageState } from '../../i18n/useMessageState.ts';
import { useTranslation } from 'react-i18next';

import { useEffect, useState } from 'react';
import { Button, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react';
import SelectControl from '../../components/SelectControl';
import { AssignCredential, ListCredentialReferences } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { CredentialReference } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import type { Connection } from '../../../bindings/github.com/Sanjeever/termquay/internal/store/models';

export default function CredentialAssignDialog({ connections, onChanged, onClose }: { connections: Connection[]; onChanged(): void; onClose(): void }) {
  useTranslation();
  const [references,setReferences]=useState<CredentialReference[]>([]);const [selected,setSelected]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useMessageState('');
  useEffect(()=>{ListCredentialReferences().then(values=>setReferences(values||[])).catch(e=>setError(e));},[]);
  return <Modal isOpen onClose={()=>!busy&&onClose()} className="app-dialog" isDismissable={!busy}><ModalContent><ModalHeader>{translate('connections:reuseCredentials')}</ModalHeader><ModalBody><label className="form-field">{translate('connections:credentials')}<SelectControl value={selected} disabled={busy} onChange={event=>setSelected(event.target.value)}><option value="">{translate('connections:selectExistingCredentials')}</option>{references.filter(reference=>!connections.some(connection=>connection.protocol==='rdp')||reference.kind==='password').map(reference=><option value={reference.id} key={reference.id}>{reference.names?.[0]||translate('connections:noLinkedCredentials')} · {reference.kind==='password'?translate('connections:password'):translate('connections:privateKey')} · {reference.connection_ids?.length||0} {translate('connections:connections')}</option>)}</SelectControl></label><ul className="batch-paths">{connections.map(connection=><li key={connection.id}>{connection.name}<small className="muted"> · {connection.host}</small></li>)}</ul>{error&&<p role="alert" className="error">{error}</p>}</ModalBody><ModalFooter><Button variant="light" isDisabled={busy} onPress={onClose}>{translate('connections:cancel')}</Button><Button color="primary" isDisabled={!selected||busy} onPress={async()=>{setBusy(true);try{await AssignCredential(connections.map(connection=>connection.id),selected);onChanged();onClose();}catch(e){setError(e);}finally{setBusy(false);}}}>{translate('connections:applyTo')}{connections.length} {translate('connections:connections')}</Button></ModalFooter></ModalContent></Modal>;
}
