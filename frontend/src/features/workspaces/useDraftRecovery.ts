import { message as uiMessage } from '../../i18n/messages.ts';
import { useMessageState } from '../../i18n/useMessageState.ts';

import{useEffect,useRef,useState}from'react';
import{GetDraftRecoveryState,SetDraftRecoveryEnabled,SaveRecoveryDrafts,ClearRecoveryDrafts}from'../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type{DraftRecoveryState,RecoveryDraftInput,WorkspaceDraftUpdate}from'../../../bindings/github.com/Sanjeever/termquay/internal/app/models';

export default function useDraftRecovery(ready: boolean){
 const names=useRef(new Map<string,string>());
 const generation=useRef(0);
 const[state,setState]=useState<DraftRecoveryState>();const[error,setError]=useMessageState('');const enabled=useRef(false);const suspended=useRef(false);const pending=useRef(new Map<string,RecoveryDraftInput[]>());const snapshots=useRef(new Map<string,RecoveryDraftInput[]>());const live=useRef(new Set<string>());const writing=useRef<Promise<void>>();const timer=useRef<ReturnType<typeof setTimeout>>();const constraint=useRef<unknown>('');
 async function refresh(){const request=++generation.current;try{const value=await GetDraftRecoveryState();if(request!==generation.current)return;enabled.current=value.enabled;setState(value);if(constraint.current)setError(constraint.current);else if(!pending.current.size)setError('');}catch(e){if(request===generation.current)setError(e);}}
 useEffect(()=>{if(!ready)return;void refresh();return()=>clearTimeout(timer.current);},[ready]);
 async function flush():Promise<void>{
  clearTimeout(timer.current);if(constraint.current)throw constraint.current;if(writing.current){await writing.current;return flush();}if(!pending.current.size)return;
  const operation=(async()=>{while(pending.current.size){const batch=pending.current;pending.current=new Map();try{await SaveRecoveryDrafts([...batch].map(([workspace,documents])=>({workspace,documents,name:names.current.get(workspace)||''})));setError('');for(const[id,documents]of batch){if(!documents.length&&!live.current.has(id)){snapshots.current.delete(id);names.current.delete(id);if(!pending.current.get(id)?.length)pending.current.delete(id);}}}catch(e){for(const[id,documents]of batch)if(!pending.current.has(id))pending.current.set(id,documents);setError(e);throw e;}}})();writing.current=operation;try{await operation;}finally{writing.current=undefined;}
 }
 function queue(updates:WorkspaceDraftUpdate[]){
  if(!enabled.current||suspended.current)return;live.current=new Set(updates.map(u=>u.workspace));const count=updates.reduce((n,u)=>n+(u.documents?.length||0),0);const chars=updates.reduce((n,u)=>n+(u.documents||[]).reduce((s,d)=>s+d.content.length,0),0);if(count>64||chars>8*1024*1024){constraint.current=uiMessage('workspaces:localDraftsExceedTheLimitOf64Drafts');setError(constraint.current);return;}constraint.current='';let changed=false;
  for(const update of updates){names.current.set(update.workspace,update.name);const documents=update.documents||[];const old=snapshots.current.get(update.workspace);if(old&&old.length===documents.length&&old.every((d,i)=>d.path===documents[i].path&&d.content===documents[i].content))continue;snapshots.current.set(update.workspace,documents);if(documents.length||old?.length||state?.drafts?.some(d=>d.workspace===update.workspace)){pending.current.set(update.workspace,documents);changed=true;}}
  for(const[id,old]of snapshots.current){if(live.current.has(id))continue;if(old.length){snapshots.current.set(id,[]);pending.current.set(id,[]);changed=true;}else if(!pending.current.has(id)){snapshots.current.delete(id);names.current.delete(id);}}
  if(pending.current.size>128){constraint.current=uiMessage('workspaces:tooManyWorkspacesWithDraftsWaitingToBe');setError(constraint.current);return;}if(changed){clearTimeout(timer.current);timer.current=setTimeout(()=>{void flush().catch(()=>{});},600);}
 }
 async function setEnabled(value:boolean){suspended.current=true;generation.current++;clearTimeout(timer.current);try{if(writing.current)await writing.current.catch(()=>{});pending.current.clear();snapshots.current.clear();names.current.clear();constraint.current='';await SetDraftRecoveryEnabled(value);enabled.current=value;await refresh();}finally{suspended.current=false;}}
 async function clear(){suspended.current=true;generation.current++;clearTimeout(timer.current);try{if(writing.current)await writing.current.catch(()=>{});pending.current.clear();snapshots.current.clear();names.current.clear();constraint.current='';await ClearRecoveryDrafts();await refresh();}finally{suspended.current=false;}}
 return{state,error,enabled:state?.enabled||false,queue,flush,refresh,setEnabled,clear};
}
