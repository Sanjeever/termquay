import { errorMessage } from "../../lib/errors";
import { useEffect, useMemo, useRef, useState } from 'react';
import { Events } from '@wailsio/runtime';
import { CancelTransfer, ClearTransfer, ClearFinishedTransfers, ListTransfers, RetryTransfer, ResumeTransfer, DiscardTransferResume } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { Transfer } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import { transferSummary } from './transferFormat';

export default function useTransfers(ready: boolean) {
  const [transfers, setTransfers] = useState<Record<string, Transfer>>({});
  const [actionError, setActionError] = useState<{ task: string; message: string }>();
  const [loadError, setLoadError] = useState('');
  const live = useRef(false);
  const loadVersion = useRef(0);
  const operationVersion = useRef(0);
  const operations = useRef(new Map<string, number>());
  const pending = useRef(new Map<string,Transfer>());
  async function refresh() {
    const version = ++loadVersion.current;
    try {
      const list = await ListTransfers();
      if (!live.current || loadVersion.current !== version) return;
      setTransfers(previous=>({...Object.fromEntries((list || []).map(task=>[task.id,task])),...previous})); setLoadError('');
    } catch (error) { if (live.current && loadVersion.current === version) setLoadError(errorMessage(error)); }
  }
  useEffect(() => {
    live.current = true;
    let frame = 0;
    const off = Events.On('transfer:changed', event => { const t = event.data as Transfer; pending.current.set(t.id,t); if(!frame)frame=requestAnimationFrame(()=>{frame=0;const updates=Object.fromEntries(pending.current);pending.current.clear();setTransfers(prev=>({...prev,...updates}));}); });
    return () => { live.current = false; off(); cancelAnimationFrame(frame); pending.current.clear(); operations.current.clear(); };
  }, []);
  useEffect(() => { if (ready) void refresh(); }, [ready]);
  const items = useMemo(()=>Object.values(transfers).sort((a,b)=>a.sequence-b.sequence),[transfers]);
  function accept(items: Transfer[]) { setTransfers(previous => ({ ...Object.fromEntries(items.map(item => [item.id, item])), ...previous })); }
  function clearError(id: string) { setActionError(previous=>previous?.task===id?undefined:previous); }
  async function run(id: string, action: () => Promise<unknown>) {
    const version = ++operationVersion.current; operations.current.set(id,version); clearError(id);
    try { await action(); return true; }
    catch (error) { if (live.current && operations.current.get(id)===version) setActionError({task:id,message:errorMessage(error)}); return false; }
    finally { if (operations.current.get(id)===version) operations.current.delete(id); }
  }
  const cancel = (id: string) => run(id,()=>CancelTransfer(id));
  const clear = (id: string) => run(id,async()=>{await ClearTransfer(id);pending.current.delete(id);setTransfers(previous=>{const next={...previous};delete next[id];return next;});});
  const retry = (id: string,name: string,overwrite: boolean) => run(id,()=>RetryTransfer(id,name,overwrite));
  const resume = (id: string,workspace: string) => run(id,()=>ResumeTransfer(id,workspace));
  const discard = (id: string,workspace: string) => run(id,async()=>{await DiscardTransferResume(id,workspace);pending.current.delete(id);setTransfers(previous=>{const next={...previous};delete next[id];return next;});});
  const clearFinished = () => run('',async()=>{const removed=new Set(await ClearFinishedTransfers()||[]);for(const id of removed)pending.current.delete(id);setTransfers(previous=>Object.fromEntries(Object.entries(previous).filter(([id])=>!removed.has(id))));});
  const speed = items.reduce((sum, task) => sum + (task.state === 'running' ? task.speed : 0), 0);
  return { items, error:actionError?.message || loadError, errorTask:actionError?.task || '', errorKind:actionError?'action':'load', clearError, refresh, accept, cancel, clear, clearFinished, retry, resume, discard, speed, summary: transferSummary(items), running: items.filter(t => t.state === 'running').length, waiting:items.filter(t=>t.state==='queued').length, failed: items.filter(t => t.state === 'failed').length };
}
