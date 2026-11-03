import { useEffect, useState } from 'react';
import { Events } from '@wailsio/runtime';
import { CancelTransfer, ClearTransfer, ClearFinishedTransfers, ListTransfers, RetryTransfer, ResumeTransfer, DiscardTransferResume } from '../../../bindings/github.com/Sanjeever/termquay/appservice';
import type { Transfer } from '../../../bindings/github.com/Sanjeever/termquay/models';

export default function useTransfers() {
  const [transfers, setTransfers] = useState<Record<string, Transfer>>({});
  const [error, setError] = useState('');
  useEffect(() => {
    let disposed = false;
    const off = Events.On('transfer:changed', event => { const t = event.data as Transfer; setTransfers(prev => ({ ...prev, [t.id]: t })); });
    ListTransfers().then(list => { if (!disposed) setTransfers(prev => ({ ...Object.fromEntries((list ?? []).map(t => [t.id, t])), ...prev })); }).catch(e => { if (!disposed) setError(String(e)); });
    return () => { disposed = true; off(); };
  }, []);
  const items = Object.values(transfers).sort((a,b)=>a.sequence-b.sequence);
  async function cancel(id: string) { try { await CancelTransfer(id); setError(''); } catch (e) { setError(String(e)); } }
  async function clear(id: string) { try { await ClearTransfer(id); setTransfers(prev => { const next = { ...prev }; delete next[id]; return next; }); setError(''); } catch (e) { setError(String(e)); } }
  async function retry(id:string,name:string,overwrite:boolean){try{await RetryTransfer(id,name,overwrite);setError('');return true;}catch(e){setError(String(e));return false;}}
  async function resume(id:string,workspace:string){try{await ResumeTransfer(id,workspace);setError('');return true;}catch(e){setError(String(e));return false;}}
  async function discard(id:string,workspace:string){try{await DiscardTransferResume(id,workspace);setTransfers(previous=>{const next={...previous};delete next[id];return next;});setError('');return true;}catch(e){setError(String(e));return false;}}
  async function clearFinished(){try{const removed=new Set(await ClearFinishedTransfers()||[]);setTransfers(prev=>Object.fromEntries(Object.entries(prev).filter(([id])=>!removed.has(id))));setError('');}catch(e){setError(String(e));}}
  return { items, error, cancel, clear, clearFinished, retry, resume, discard, running: items.filter(t => t.state === 'running').length, waiting:items.filter(t=>t.state==='queued').length, failed: items.filter(t => t.state === 'failed').length };
}
