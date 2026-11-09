import { t as translate } from '../../i18n/index.ts';
import { message as uiMessage, type MessageKey } from '../../i18n/messages.ts';
import { linter, lintGutter, type Diagnostic } from '@codemirror/lint';
import { ViewPlugin } from '@codemirror/view';
import { tooltipDelay } from '../../components/Tooltip';

type Job = { id:number; text:string; resolve(value:Diagnostic[]):void };
export function editorDiagnostics(language:'json'|'yaml', onError:(error:unknown)=>void) {
  let worker: Worker | undefined;
  let active: Job | undefined;
  let queued: Job | undefined;
  let sequence = 0;
  let disposed = false;
  function send(job:Job) {
    active = job;
    try {
      if (!worker) {
        worker = new Worker(new URL('./editorDiagnostics.worker.ts',import.meta.url),{type:'module'});
        worker.onmessage = (event:MessageEvent<{id:number; diagnostics:(Diagnostic & { messageCode?: MessageKey })[]; error?:string}>)=>{
          if (disposed || active?.id!==event.data.id) return;
          const completed = active; active=undefined;
          onError(event.data.error || ''); completed.resolve(event.data.diagnostics.map(item => item.messageCode ? { ...item, message: translate(item.messageCode) } : item));
          if (queued) {const next=queued;queued=undefined;send(next);}
        };
        worker.onerror = event=>{
          if(disposed)return;
          onError(uiMessage('files:syntaxCheckFailed', { value1: event.message }));
          active?.resolve([]);queued?.resolve([]);active=queued=undefined;worker?.terminate();worker=undefined;
        };
      }
      worker.postMessage({id:job.id,text:job.text,language});
    } catch (error) {
      active=undefined;job.resolve([]);onError(error instanceof Error?error.message:String(error));
    }
  }
  return [
    linter(view=>new Promise<Diagnostic[]>(resolve=>{
      const job={id:++sequence,text:view.state.doc.toString(),resolve};
      if (disposed) {resolve([]);return;}
      if (active) {queued?.resolve([]);queued=job;} else send(job);
    }),{delay:500}),lintGutter({hoverTime:tooltipDelay}),
    ViewPlugin.define(()=>({destroy(){disposed=true;worker?.terminate();active?.resolve([]);queued?.resolve([]);active=queued=undefined;}})),
  ];
}
