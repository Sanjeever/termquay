import Modal from '../../components/Modal';
import { eventError, errorMessage } from '../../lib/errors.ts';
import { t as translate, currentLocale } from '../../i18n/index.ts';
import { useMessageState } from '../../i18n/useMessageState.ts';
import { useTranslation } from 'react-i18next';
import { useEffect, useRef, useState } from 'react';
import { Button, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@heroui/react';
import { ListBackupDevices, PreviewSnapshotPrune, ConfirmSnapshotPrune, CancelSnapshotPrune } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { SnapshotPrunePreview, SnapshotPruneResult } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import SelectControl from '../../components/SelectControl';
import ErrorNotice from '../../components/ErrorNotice';

import { bytes } from '../files/transferFormat';

export default function SnapshotPruneDialog({deviceID,names,onClose,onChanged}:{deviceID:string;names:Record<string,string|undefined>;onClose():void;onChanged():void}) {
  useTranslation();
  const [devices,setDevices]=useState<string[]>([]);
  const [device,setDevice]=useState(deviceID);const [keep,setKeep]=useState(10);
  const [preview,setPreview]=useState<SnapshotPrunePreview>();
  const [results,setResults]=useState<SnapshotPruneResult[]>();
  const [busy,setBusy]=useState(false);const [executing,setExecuting]=useState(false);const [error,setError]=useMessageState('');
  const request=useRef<{cancel():unknown}>();
  useEffect(()=>{const listing=ListBackupDevices();listing.then(value=>setDevices(value||[])).catch(error=>setError(error));return()=>{listing.cancel();request.current?.cancel();};},[]);
  async function plan(){if(busy)return;setBusy(true);setError('');setPreview(undefined);setResults(undefined);const operation=PreviewSnapshotPrune(device,keep);request.current=operation;try{setPreview(await operation);}catch(error){setError(error);}finally{request.current=undefined;setBusy(false);}}
  async function confirm(){if(!preview||busy)return;setBusy(true);setExecuting(true);setError('');const operation=ConfirmSnapshotPrune(preview.id);request.current=operation;try{const value=await operation;setResults(value||[]);setPreview(undefined);onChanged();}catch(error){setError(error);onChanged();}finally{request.current=undefined;setBusy(false);setExecuting(false);}}
  return <Modal isOpen onClose={()=>!busy&&onClose()} isDismissable={!busy} isKeyboardDismissDisabled={busy} className="app-dialog" scrollBehavior="inside"><ModalContent><ModalHeader>{translate('settings:pruneBackupHistory')}</ModalHeader><ModalBody>
    <label className="form-field">{translate('settings:device2')}<SelectControl aria-label={translate('settings:backupDevicesToPrune')} value={device} disabled={busy} onChange={event=>{setDevice(event.target.value);setPreview(undefined);setResults(undefined);}}><option value="">{translate('settings:selectDevices')}</option>{devices.map(id=><option key={id} value={id}>{names[id]||id}</option>)}</SelectControl></label>
    <label className="form-field">{translate('settings:recentCopiesToKeep')}<input className="native-input" aria-label={translate('settings:recentCopiesToKeep')} type="number" min={1} max={1000} step={1} value={keep} disabled={busy} onChange={event=>{setKeep(Number(event.target.value));setPreview(undefined);setResults(undefined);}}/></label>
    <Button size="sm" variant="bordered" isDisabled={busy||!device||!Number.isInteger(keep)||keep<1||keep>1000} onPress={()=>void plan()}>{translate('settings:previewPruning')}</Button>
    {preview&&<><p>{translate('settings:keep')}{preview.retained?.length||0} {translate('settings:copiesDelete')}{preview.removed?.length||0} {translate('settings:copies2')}{bytes(preview.bytes)}</p>{preview.remaining>0&&<p>{translate('settings:thereAre')}{preview.remaining} {translate('settings:olderSnapshotsPreviewAgainAfterPruningToContinue')}</p>}{preview.skipped>0&&<p>{preview.skipped} {translate('settings:itemsDoNotMatchTheSnapshotNamingScheme')}</p>}<details><summary>{translate('settings:snapshotsToKeep')}</summary><ul>{preview.retained?.map(item=><li key={item.path} className="file-path">{item.path}</li>)}</ul></details><details open><summary>{translate('settings:snapshotsToDelete')}</summary><ul>{preview.removed?.map(item=><li key={item.path} className="file-path">{new Date(item.published).toLocaleString(currentLocale())} · {bytes(item.size)}<small>{item.path}</small></li>)}</ul></details>{!!preview.removed?.length&&<p className="error">{translate('settings:deletingRemoteSnapshotsCannotBeUndone')}</p>}</>}
    {results&&<ul>{results.map(item=><li key={item.path} className="file-path">{item.path}<span className={item.state==='failed'?'error':'muted'}>{item.state==='done'?translate('settings:deleted'):item.state==='failed'?translate('settings:failed'):translate('settings:notExecuted')}{errorMessage(eventError(item))&&` · ${errorMessage(eventError(item))}`}</span></li>)}</ul>}
    <ErrorNotice message={error}/>
  </ModalBody><ModalFooter>{executing&&preview?<Button variant="light" onPress={()=>void CancelSnapshotPrune(preview.id).catch(error=>setError(error))}>{translate('settings:stopPruning')}</Button>:<Button variant="light" isDisabled={busy} onPress={onClose}>{translate('settings:off')}</Button>}<Button color="danger" isLoading={busy&&executing} isDisabled={busy||!preview?.removed?.length} onPress={()=>void confirm()}>{translate('settings:confirmDeletingListedSnapshots')}</Button></ModalFooter></ModalContent></Modal>;
}
