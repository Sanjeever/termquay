import { useEffect, useState } from 'react';
import { Button, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@heroui/react';
import { GetBackupRecoveryRecipient, ExportBackupRecoveryKey, SelectBackupRecoveryRecipient, SetBackupRecoveryRecipient } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import ErrorNotice from '../../components/ErrorNotice';
import { errorMessage } from '../../lib/errors';

export default function BackupRecoverySettings({disabled}:{disabled:boolean}) {
  const [recipient,setRecipient]=useState('');const [pending,setPending]=useState<{recipient:string;path:string}>();
  const [saved,setSaved]=useState(false);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  useEffect(()=>{let ended=false;GetBackupRecoveryRecipient().then(value=>{if(!ended)setRecipient(value);}).catch(error=>{if(!ended)setError(errorMessage(error));});return()=>{ended=true;};},[]);
  async function choose(create:boolean){if(busy)return;setBusy(true);setError('');setSaved(false);try{const value=create?await ExportBackupRecoveryKey():{recipient:await SelectBackupRecoveryRecipient(),path:''};if(value.recipient)setPending(value);}catch(error){setError(errorMessage(error));}finally{setBusy(false);}}
  async function save(){if(!pending||busy)return;setBusy(true);setError('');try{await SetBackupRecoveryRecipient(pending.recipient);setRecipient(pending.recipient);setPending(undefined);}catch(error){setError(errorMessage(error));}finally{setBusy(false);}}
  return <section className="backup-section"><div className="backup-section-heading"><h3>恢复密钥</h3></div>
    {recipient&&<code className="fingerprint">{recipient}</code>}
    <div className="button-row"><Button size="sm" variant="bordered" isDisabled={disabled||busy} onPress={()=>void choose(true)}>{recipient?'更换恢复密钥':'创建恢复密钥'}</Button><Button size="sm" variant="light" isDisabled={disabled||busy} onPress={()=>void choose(false)}>使用已有密钥</Button>{recipient&&<Button size="sm" variant="light" isDisabled={disabled||busy} onPress={()=>{setSaved(false);setError('');setPending({recipient:'',path:''});}}>停用</Button>}</div>
    <ErrorNotice message={!pending?error:''}/>
    <Modal isOpen={!!pending} onClose={()=>!busy&&setPending(undefined)} isDismissable={!busy} isKeyboardDismissDisabled={busy} className="app-dialog"><ModalContent><ModalHeader>{pending?.recipient?'启用备份恢复密钥':'停用备份恢复密钥'}</ModalHeader><ModalBody>
      {pending?.recipient?<>{pending.path&&<p className="file-path">已导出到 {pending.path}</p>}<code className="fingerprint">{pending.recipient}</code><p>持有恢复密钥可解密此后生成的对应备份。请离线保存，避免与备份放在一起。</p><label className="checkbox-label"><input type="checkbox" checked={saved} disabled={busy} onChange={event=>setSaved(event.target.checked)}/>已妥善保存恢复密钥</label></>:<p>此后生成的备份使用备份密码解锁。</p>}
      <p>已有备份仍需原备份密码或其对应的恢复密钥。</p><ErrorNotice message={error}/>
    </ModalBody><ModalFooter><Button variant="light" isDisabled={busy} onPress={()=>setPending(undefined)}>取消</Button><Button color={pending?.recipient?'primary':'danger'} isLoading={busy} isDisabled={!!pending?.recipient&&!saved} onPress={()=>void save()}>{pending?.recipient?'确认启用':'确认停用'}</Button></ModalFooter></ModalContent></Modal>
  </section>;
}
