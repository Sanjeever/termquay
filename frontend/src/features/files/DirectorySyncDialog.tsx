import SelectControl from '../../components/SelectControl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@heroui/react';
import { PreviewDirectorySync, CancelDirectorySyncPreview, ExecuteDirectorySync } from '../../../bindings/github.com/Sanjeever/termquay/appservice';
import type { DirectorySyncPreview } from '../../../bindings/github.com/Sanjeever/termquay/models';

const states:Record<string,string>={new:'新增',update:'更新',same:'相同',conflict:'冲突 / 不支持'};
export default function DirectorySyncDialog({id,remote,onClose}:{id:string;remote:string;onClose():void}){
  const [direction,setDirection]=useState('upload');const [preview,setPreview]=useState<DirectorySyncPreview>();const [selected,setSelected]=useState(new Set<string>());const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [page,setPage]=useState(0);
  const [local,setLocal]=useState('');
  const pending=useRef<ReturnType<typeof PreviewDirectorySync>>();const disposed=useRef(false);const latest=useRef(preview);latest.current=preview;
  useEffect(()=>()=>{disposed.current=true;pending.current?.cancel();if(latest.current)void CancelDirectorySyncPreview(latest.current.id);},[]);
  const allowed=useMemo(()=>{const blocked=new Set<string>();const changes=new Set<string>();for(const e of preview?.entries||[]){const parents=e.path.split('/');parents.pop();while(parents.length){const parent=parents.join('/');if(e.state==='conflict')blocked.add(parent);if(e.state==='new'||e.state==='update')changes.add(parent);parents.pop();}}return new Set((preview?.entries||[]).filter(e=>e.state!=='conflict'&&(!e.directory||!blocked.has(e.path))&&(e.state==='new'||e.state==='update'||e.directory&&changes.has(e.path))).map(e=>e.path));},[preview]);
  function invalidate(){if(preview)CancelDirectorySyncPreview(preview.id).catch(e=>setError(String(e)));setPreview(undefined);setSelected(new Set());}
  async function scan(){setBusy(true);setError('');try{if(preview)await CancelDirectorySyncPreview(preview.id);setPreview(undefined);setSelected(new Set());setPage(0);const request=PreviewDirectorySync(id,direction,local.trim(),remote);pending.current=request;const value=await request;if(!disposed.current&&value.id){setPreview(value);setLocal(value.local);}}catch(e){if(!disposed.current)setError(String(e));}finally{pending.current=undefined;if(!disposed.current)setBusy(false);}}
  return <Modal isOpen onClose={()=>{pending.current?.cancel();onClose();}} className="app-dialog directory-sync-dialog" scrollBehavior="inside"><ModalContent><ModalHeader>目录同步</ModalHeader><ModalBody>
    <label className="form-field">方向<SelectControl value={direction} onChange={e=>{setDirection(e.target.value);invalidate();}} disabled={busy}><option value="upload">本地 → 远端</option><option value="download">远端 → 本地</option></SelectControl></label>
    <label className="form-field">本地目录<input aria-label="本地同步目录" value={local} onChange={e=>{setLocal(e.target.value);invalidate();}} disabled={busy}/></label>
    <p className="file-path">远端 {preview?.remote||remote}</p>{preview&&<p className="file-path">本地 {preview.local}</p>}
    <Button size="sm" variant="bordered" isDisabled={busy} onPress={()=>void scan()}>{preview?'重新预览':local.trim()?'预览差异':'选择本地目录并预览'}</Button>
    {busy&&<p role="status">正在扫描…</p>}{error&&<p role="alert" className="error">{error}</p>}
    {preview&&<><div className="button-row"><Button size="sm" variant="light" onPress={()=>setSelected(new Set(allowed))}>全选可同步项</Button><Button size="sm" variant="light" onPress={()=>setSelected(new Set())}>清除选择</Button><span className="muted">{selected.size} / {preview.entries?.length||0}</span></div>
      <table className="sync-preview"><thead><tr><th>选择</th><th>路径</th><th>差异</th><th>字节</th></tr></thead><tbody>{(preview.entries||[]).slice(page*100,(page+1)*100).map(e=><tr key={e.path}><td><input type="checkbox" aria-label={`同步 ${e.path}`} disabled={!allowed.has(e.path)} checked={selected.has(e.path)} onChange={event=>setSelected(prev=>{const next=new Set(prev);if(event.target.checked)next.add(e.path);else next.delete(e.path);return next;})}/></td><td className="file-path">{e.path}{e.directory?'/':''}</td><td>{states[e.state]}</td><td>{e.directory?'':e.size}</td></tr>)}</tbody></table>
      {(preview.entries?.length||0)>100&&<div className="button-row"><Button size="sm" isDisabled={page===0} onPress={()=>setPage(p=>p-1)}>上一页</Button><span>{page+1} / {Math.ceil((preview.entries?.length||0)/100)}</span><Button size="sm" isDisabled={(page+1)*100>=(preview.entries?.length||0)} onPress={()=>setPage(p=>p+1)}>下一页</Button></div>}
    </>}
  </ModalBody><ModalFooter><Button variant="light" onPress={()=>{pending.current?.cancel();onClose();}}>取消</Button><Button color="primary" isDisabled={!preview||!selected.size||busy} onPress={async()=>{if(!preview)return;setBusy(true);try{await ExecuteDirectorySync(preview.id,[...selected]);onClose();}catch(e){setError(String(e));}finally{if(!disposed.current)setBusy(false);}}}>执行所选差异</Button></ModalFooter></ModalContent></Modal>;
}
