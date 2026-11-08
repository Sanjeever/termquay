import { errorMessage } from "../../lib/errors";
import { useEffect, useMemo, useRef, useState } from 'react';
import { Events } from '@wailsio/runtime';
import { CancelTransfer, CancelAndDiscardTransfer, ClearTransfer, ClearFinishedTransfers, ListTransfers, RestoreTransferResumes, RetryTransfer, ResumeTransfer, DiscardTransferResume } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
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
  const known = useRef(new Map<string,Transfer>());
  const removedThrough = useRef(0);
  function remove(ids: string[]) {
    ++loadVersion.current;
    for (const id of ids) {
      removedThrough.current = Math.max(removedThrough.current, known.current.get(id)?.sequence || 0);
      known.current.delete(id); pending.current.delete(id);
    }
    const removed = new Set(ids);
    setTransfers(previous=>Object.fromEntries(Object.entries(previous).filter(([id])=>!removed.has(id))));
  }
  async function refresh() {
    const version = ++loadVersion.current;
    try {
      await RestoreTransferResumes();
      const list = await ListTransfers();
      if (!live.current || loadVersion.current !== version) return;
      for (const task of list || []) known.current.set(task.id, task);
      setTransfers(previous=>({...Object.fromEntries((list || []).map(task=>[task.id,task])),...previous})); setLoadError('');
    } catch (error) { if (live.current && loadVersion.current === version) setLoadError(errorMessage(error)); }
  }
  useEffect(() => {
    live.current = true;
    let frame = 0;
    const off = Events.On('transfer:changed', event => { const t = event.data as Transfer; if (t.sequence <= removedThrough.current && !known.current.has(t.id)) return; known.current.set(t.id,t); pending.current.set(t.id,t); if(!frame)frame=requestAnimationFrame(()=>{frame=0;const updates=Object.fromEntries(pending.current);pending.current.clear();setTransfers(prev=>({...prev,...updates}));}); });
    return () => { live.current = false; off(); cancelAnimationFrame(frame); pending.current.clear(); operations.current.clear(); };
  }, []);
  useEffect(() => { if (ready) void refresh(); }, [ready]);
  const items = useMemo(()=>Object.values(transfers).sort((a,b)=>a.sequence-b.sequence),[transfers]);
  function accept(items: Transfer[]) { for (const task of items) known.current.set(task.id,task); setTransfers(previous => ({ ...Object.fromEntries(items.map(item => [item.id, item])), ...previous })); }
  function clearError(id: string) { setActionError(previous=>previous?.task===id?undefined:previous); }
  async function run(id: string, action: () => Promise<unknown>) {
    const version = ++operationVersion.current; operations.current.set(id,version); clearError(id);
    try { await action(); return true; }
    catch (error) { if (live.current && operations.current.get(id)===version) setActionError({task:id,message:errorMessage(error)}); return false; }
    finally { if (operations.current.get(id)===version) operations.current.delete(id); }
  }
  const cancel = (id: string) => run(id,()=>CancelTransfer(id));
  const clear = (id: string) => run(id,async()=>{const removed=await ClearTransfer(id);remove([removed]);});
  const cancelAndDiscard = (id: string,workspace: string) => run(id,async()=>{await CancelAndDiscardTransfer(id,workspace);remove([id]);});
  const retry = (id: string,name: string,overwrite: boolean) => run(id,()=>RetryTransfer(id,name,overwrite));
  const resume = (id: string,workspace: string) => run(id,()=>ResumeTransfer(id,workspace));
  const discard = (id: string,workspace: string) => run(id,async()=>{await DiscardTransferResume(id,workspace);remove([id]);});
  const clearFinished = () => run('',async()=>{remove(await ClearFinishedTransfers()||[]);});
  const speed = items.reduce((sum, task) => sum + (task.state === 'running' ? task.speed : 0), 0);
  return { items, error:actionError?.message || loadError, errorTask:actionError?.task || '', errorKind:actionError?'action':'load', clearError, refresh, accept, cancel, cancelAndDiscard, clear, clearFinished, retry, resume, discard, speed, summary: transferSummary(items), running: items.filter(t => t.state === 'running').length, waiting:items.filter(t=>t.state==='queued').length, failed: items.filter(t => t.state === 'failed').length };
}
