import { message as uiMessage } from '../../i18n/messages.ts';
import { useMessageState } from '../../i18n/useMessageState.ts';
import { errorMessage } from "../../lib/errors";
import{useEffect,useRef,useState}from'react';import{GetWorkspaceLayout,SaveWorkspaceLayout}from'../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';import type{WorkspaceLayout}from'../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
export default function useWorkspaceRestore(enabled = true){
 const[startup,setStartup]=useState<WorkspaceLayout>();const[error,setError]=useMessageState('');const ready=useRef(false);const activated=useRef(false);const pending=useRef<WorkspaceLayout>();const running=useRef<Promise<void>>();const timer=useRef<ReturnType<typeof setTimeout>>();const last=useRef('');const failure=useRef('');
 useEffect(()=>{if(!enabled)return;let ended=false;GetWorkspaceLayout().then(value=>{if(ended)return;ready.current=true;setStartup(value);failure.current='';setError('');}).catch(e=>{if(!ended){failure.current=errorMessage(e);setError(e);}});return()=>{ended=true;clearTimeout(timer.current);};},[enabled]);
 async function flush():Promise<void>{clearTimeout(timer.current);if(running.current){await running.current;return flush();}if(!pending.current)return;if(!ready.current)throw failure.current ? new Error(failure.current) : uiMessage('workspaces:workspaceLayoutHasNotLoadedYet');const operation=(async()=>{while(pending.current){const value=pending.current;pending.current=undefined;try{await SaveWorkspaceLayout(value);setError('');}catch(e){if(!pending.current)pending.current=value;setError(e);throw e;}}})();running.current=operation;try{await operation;}finally{running.current=undefined;}}
 function queue(value:WorkspaceLayout){if(!activated.current&&!value.entries?.length)return;activated.current=true;const encoded=JSON.stringify(value);if(encoded===last.current)return;last.current=encoded;pending.current=value;clearTimeout(timer.current);timer.current=setTimeout(()=>{void flush().catch(()=>{});},400);}
 return{startup,error,queue,flush};
}
