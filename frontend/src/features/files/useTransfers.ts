import { errorMessage } from "../../lib/errors";
import { useEffect, useMemo, useRef, useState } from 'react';
import { Events } from '@wailsio/runtime';
import { CancelTransfer, ClearTransfer, ClearFinishedTransfers, ListTransfers, RetryTransfer, ResumeTransfer, DiscardTransferResume } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { Transfer } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import { transferSummary } from './transferFormat';

export default function useTransfers() {
  const [transfers, setTransfers] = useState<Record<string, Transfer>>({});
  const [error, setError] = useState('');
  const pending = useRef(new Map<string,Transfer>());
  useEffect(() => {
    let disposed = false;
    let frame = 0;
    const off = Events.On('transfer:changed', event => { const t = event.data as Transfer; pending.current.set(t.id,t); if(!frame)frame=requestAnimationFrame(()=>{frame=0;const updates=Object.fromEntries(pending.current);pending.current.clear();setTransfers(prev=>({...prev,...updates}));}); });
    ListTransfers().then(list => { if (!disposed) setTransfers(prev => ({ ...Object.fromEntries((list ?? []).map(t => [t.id, t])), ...prev })); }).catch(e => { if (!disposed) setError(errorMessage(e)); });
    return () => { disposed = true; off(); cancelAnimationFrame(frame); pending.current.clear(); };
  }, []);
  const items = useMemo(()=>Object.values(transfers).sort((a,b)=>a.sequence-b.sequence),[transfers]);
  function accept(items: Transfer[]) { setTransfers(previous => ({ ...Object.fromEntries(items.map(item => [item.id, item])), ...previous })); }
  async function cancel(id: string) { try { await CancelTransfer(id); setError(''); } catch (e) { setError(errorMessage(e)); } }
  async function clear(id: string) { try { await ClearTransfer(id); pending.current.delete(id); setTransfers(prev => { const next = { ...prev }; delete next[id]; return next; }); setError(''); } catch (e) { setError(errorMessage(e)); } }
  async function retry(id:string,name:string,overwrite:boolean){try{await RetryTransfer(id,name,overwrite);setError('');return true;}catch(e){setError(errorMessage(e));return false;}}
  async function resume(id:string,workspace:string){try{await ResumeTransfer(id,workspace);setError('');return true;}catch(e){setError(errorMessage(e));return false;}}
  async function discard(id:string,workspace:string){try{await DiscardTransferResume(id,workspace);pending.current.delete(id);setTransfers(previous=>{const next={...previous};delete next[id];return next;});setError('');return true;}catch(e){setError(errorMessage(e));return false;}}
  async function clearFinished(){try{const removed=new Set(await ClearFinishedTransfers()||[]);for(const id of removed)pending.current.delete(id);setTransfers(prev=>Object.fromEntries(Object.entries(prev).filter(([id])=>!removed.has(id))));setError('');}catch(e){setError(errorMessage(e));}}
  const speed = items.reduce((sum, task) => sum + (task.state === 'running' ? task.speed : 0), 0);
  return { items, error, accept, cancel, clear, clearFinished, retry, resume, discard, speed, summary: transferSummary(items), running: items.filter(t => t.state === 'running').length, waiting:items.filter(t=>t.state==='queued').length, failed: items.filter(t => t.state === 'failed').length };
}
