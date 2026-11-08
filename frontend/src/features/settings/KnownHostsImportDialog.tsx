import { useState } from 'react';
import { Button, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@heroui/react';
import { SelectKnownHostsImport, ConfirmKnownHostsImport } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { KnownHostsPreview } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import SelectControl from '../../components/SelectControl';
import ErrorNotice from '../../components/ErrorNotice';
import { errorMessage } from '../../lib/errors';

export default function KnownHostsImportDialog({onClose,onImported}:{onClose():void;onImported():void}) {
  const [preview,setPreview]=useState<KnownHostsPreview>();
  const [actions,setActions]=useState<Record<string,string>>({});
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  async function select() {
    setBusy(true);setError('');
    try { const value=await SelectKnownHostsImport();setPreview(value);setActions(Object.fromEntries((value.rows||[]).map(row=>[row.id,row.conflict?'skip':'new']))); }
    catch(error){setError(errorMessage(error));}finally{setBusy(false);}
  }
  async function confirm() {
    if(!preview||busy)return;setBusy(true);setError('');
    try{await ConfirmKnownHostsImport(preview.id,Object.entries(actions).map(([id,action])=>({id,action})));onImported();onClose();}
    catch(error){setError(errorMessage(error));}finally{setBusy(false);}
  }
  return <Modal isOpen onClose={()=>!busy&&onClose()} isDismissable={!busy} isKeyboardDismissDisabled={busy} className="app-dialog directory-sync-dialog" scrollBehavior="inside"><ModalContent><ModalHeader>导入主机指纹</ModalHeader><ModalBody>
    <Button size="sm" variant="bordered" isDisabled={busy} onPress={()=>void select()}>选择 known_hosts</Button>
    {preview&&<><details><summary>匹配范围与跳过项</summary>{preview.warnings?.map((warning,index)=><p key={index}>{warning}</p>)}</details><table className="sync-preview"><thead><tr><th>目标</th><th>密钥指纹</th><th>选择</th></tr></thead><tbody>{preview.rows?.map(row=><tr key={row.id}><td>{row.host}:{row.port}{row.via&&<small>经跳板 {row.via}</small>}</td><td>{row.keys?.map(key=><div key={`${key.algorithm}:${key.fingerprint}`}><small>{key.algorithm}</small><code className="fingerprint">{key.fingerprint}</code></div>)}{row.conflict&&<details><summary className="error">与现有信任冲突</summary>{row.old_keys?.map(key=><code key={key.fingerprint} className="fingerprint">{key.fingerprint}</code>)}</details>}</td><td><SelectControl aria-label={`导入指纹 ${row.host}:${row.port}${row.via?' 经跳板':''}`} value={actions[row.id]||'skip'} disabled={busy} onChange={event=>setActions(previous=>({...previous,[row.id]:event.target.value}))}><option value="skip">跳过</option>{!row.conflict&&<option value="new">导入</option>}<option value="replace">替换此目标全部指纹</option></SelectControl></td></tr>)}</tbody></table></>}
    <ErrorNotice message={error}/>
  </ModalBody><ModalFooter><Button variant="light" isDisabled={busy} onPress={onClose}>取消</Button><Button color="primary" isLoading={busy} isDisabled={!preview||!Object.values(actions).some(action=>action!=='skip')} onPress={()=>void confirm()}>核对并导入</Button></ModalFooter></ModalContent></Modal>;
}
