import { t } from '../../i18n/index.ts';
import { useMessageState } from '../../i18n/useMessageState.ts';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { Button, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@heroui/react';
import { SelectKnownHostsImport, ConfirmKnownHostsImport } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { KnownHostsPreview } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import SelectControl from '../../components/SelectControl';
import ErrorNotice from '../../components/ErrorNotice';


export default function KnownHostsImportDialog({onClose,onImported}:{onClose():void;onImported():void}) {
  useTranslation();
  const [preview,setPreview]=useState<KnownHostsPreview>();
  const [actions,setActions]=useState<Record<string,string>>({});
  const [busy,setBusy]=useState(false);const [error,setError]=useMessageState('');
  async function select() {
    setBusy(true);setError('');
    try { const value=await SelectKnownHostsImport();setPreview(value);setActions(Object.fromEntries((value.rows||[]).map(row=>[row.id,row.conflict?'skip':'new']))); }
    catch(error){setError(error);}finally{setBusy(false);}
  }
  async function confirm() {
    if(!preview||busy)return;setBusy(true);setError('');
    try{await ConfirmKnownHostsImport(preview.id,Object.entries(actions).map(([id,action])=>({id,action})));onImported();onClose();}
    catch(error){setError(error);}finally{setBusy(false);}
  }
  return <Modal isOpen onClose={()=>!busy&&onClose()} isDismissable={!busy} isKeyboardDismissDisabled={busy} className="app-dialog directory-sync-dialog" scrollBehavior="inside"><ModalContent><ModalHeader>{t('settings:importHostFingerprints')}</ModalHeader><ModalBody>
    <Button size="sm" variant="bordered" isDisabled={busy} onPress={()=>void select()}>{t('settings:selectKnownHosts')}</Button>
    {preview&&<><details><summary>{t('settings:matchingScopeAndSkippedEntries')}</summary>{preview.warnings?.map((warning,index)=><p key={index}>{warning}</p>)}</details><table className="sync-preview"><thead><tr><th>{t('settings:destination')}</th><th>{t('settings:keyFingerprint')}</th><th>{t('settings:select')}</th></tr></thead><tbody>{preview.rows?.map(row=><tr key={row.id}><td>{row.host}:{row.port}{row.via&&<small>{t('settings:viaJumpHost')}{row.via}</small>}</td><td>{row.keys?.map(key=><div key={`${key.algorithm}:${key.fingerprint}`}><small>{key.algorithm}</small><code className="fingerprint">{key.fingerprint}</code></div>)}{row.conflict&&<details><summary className="error">{t('settings:conflictsWithExistingTrust')}</summary>{row.old_keys?.map(key=><code key={key.fingerprint} className="fingerprint">{key.fingerprint}</code>)}</details>}</td><td><SelectControl aria-label={t('settings:importFingerprint', { value1: row.host, value2: row.port, value3: row.via?' 经跳板':'' })} value={actions[row.id]||'skip'} disabled={busy} onChange={event=>setActions(previous=>({...previous,[row.id]:event.target.value}))}><option value="skip">{t('settings:skip')}</option>{!row.conflict&&<option value="new">{t('settings:import')}</option>}<option value="replace">{t('settings:replaceAllFingerprintsForThisDestination')}</option></SelectControl></td></tr>)}</tbody></table></>}
    <ErrorNotice message={error}/>
  </ModalBody><ModalFooter><Button variant="light" isDisabled={busy} onPress={onClose}>{t('settings:cancel')}</Button><Button color="primary" isLoading={busy} isDisabled={!preview||!Object.values(actions).some(action=>action!=='skip')} onPress={()=>void confirm()}>{t('settings:verifyAndImport')}</Button></ModalFooter></ModalContent></Modal>;
}
