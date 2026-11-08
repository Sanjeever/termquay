import { useEffect, useRef, useState } from 'react';
import { Button, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@heroui/react';
import { ListBackupDevices, PreviewSnapshotPrune, ConfirmSnapshotPrune, CancelSnapshotPrune } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { SnapshotPrunePreview, SnapshotPruneResult } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import SelectControl from '../../components/SelectControl';
import ErrorNotice from '../../components/ErrorNotice';
import { errorMessage } from '../../lib/errors';
import { bytes } from '../files/transferFormat';

export default function SnapshotPruneDialog({deviceID,names,onClose,onChanged}:{deviceID:string;names:Record<string,string|undefined>;onClose():void;onChanged():void}) {
  const [devices,setDevices]=useState<string[]>([]);
  const [device,setDevice]=useState(deviceID);const [keep,setKeep]=useState(10);
  const [preview,setPreview]=useState<SnapshotPrunePreview>();
  const [results,setResults]=useState<SnapshotPruneResult[]>();
  const [busy,setBusy]=useState(false);const [executing,setExecuting]=useState(false);const [error,setError]=useState('');
  const request=useRef<{cancel():unknown}>();
  useEffect(()=>{const listing=ListBackupDevices();listing.then(value=>setDevices(value||[])).catch(error=>setError(errorMessage(error)));return()=>{listing.cancel();request.current?.cancel();};},[]);
  async function plan(){if(busy)return;setBusy(true);setError('');setPreview(undefined);setResults(undefined);const operation=PreviewSnapshotPrune(device,keep);request.current=operation;try{setPreview(await operation);}catch(error){setError(errorMessage(error));}finally{request.current=undefined;setBusy(false);}}
  async function confirm(){if(!preview||busy)return;setBusy(true);setExecuting(true);setError('');const operation=ConfirmSnapshotPrune(preview.id);request.current=operation;try{const value=await operation;setResults(value||[]);setPreview(undefined);onChanged();}catch(error){setError(errorMessage(error));onChanged();}finally{request.current=undefined;setBusy(false);setExecuting(false);}}
  return <Modal isOpen onClose={()=>!busy&&onClose()} isDismissable={!busy} isKeyboardDismissDisabled={busy} className="app-dialog" scrollBehavior="inside"><ModalContent><ModalHeader>清理历史备份</ModalHeader><ModalBody>
    <label className="form-field">设备<SelectControl aria-label="清理备份设备" value={device} disabled={busy} onChange={event=>{setDevice(event.target.value);setPreview(undefined);setResults(undefined);}}><option value="">选择设备</option>{devices.map(id=><option key={id} value={id}>{names[id]||id}</option>)}</SelectControl></label>
    <label className="form-field">保留最近份数<input className="native-input" aria-label="保留最近份数" type="number" min={1} max={1000} step={1} value={keep} disabled={busy} onChange={event=>{setKeep(Number(event.target.value));setPreview(undefined);setResults(undefined);}}/></label>
    <Button size="sm" variant="bordered" isDisabled={busy||!device||!Number.isInteger(keep)||keep<1||keep>1000} onPress={()=>void plan()}>预览清理</Button>
    {preview&&<><p>保留 {preview.retained?.length||0} 份 · 本次删除 {preview.removed?.length||0} 份 · {bytes(preview.bytes)}</p>{preview.remaining>0&&<p>还有 {preview.remaining} 份旧快照，完成后可再次预览清理。</p>}{preview.skipped>0&&<p>{preview.skipped} 项不符合正式快照命名，保留原样。</p>}<details><summary>保留快照</summary><ul>{preview.retained?.map(item=><li key={item.path} className="file-path">{item.path}</li>)}</ul></details><details open><summary>待删除快照</summary><ul>{preview.removed?.map(item=><li key={item.path} className="file-path">{new Date(item.published).toLocaleString()} · {bytes(item.size)}<small>{item.path}</small></li>)}</ul></details>{!!preview.removed?.length&&<p className="error">删除远端快照后无法撤销。</p>}</>}
    {results&&<ul>{results.map(item=><li key={item.path} className="file-path">{item.path}<span className={item.state==='failed'?'error':'muted'}>{item.state==='done'?'已删除':item.state==='failed'?'失败':'未执行'}{item.error&&` · ${item.error}`}</span></li>)}</ul>}
    <ErrorNotice message={error}/>
  </ModalBody><ModalFooter>{executing&&preview?<Button variant="light" onPress={()=>void CancelSnapshotPrune(preview.id).catch(error=>setError(errorMessage(error)))}>停止清理</Button>:<Button variant="light" isDisabled={busy} onPress={onClose}>关闭</Button>}<Button color="danger" isLoading={busy&&executing} isDisabled={busy||!preview?.removed?.length} onPress={()=>void confirm()}>确认删除所列快照</Button></ModalFooter></ModalContent></Modal>;
}
