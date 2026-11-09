import { eventError, errorMessage } from '../../lib/errors.ts';
import { t as translate } from '../../i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { useEffect, useRef, useState } from 'react';
import Icon from '../../components/Icon';
import useAIConversation, { aiRunning } from './useAIConversation';
import AIConversation from './AIConversation';
import AIHistory from './AIHistory';
import AIToolCall from './AIToolCall';
import type { Reference } from '../../../bindings/github.com/Sanjeever/termquay/internal/ai/models';
import type { AIRunView } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';

const states: Record<string, string> = { get running() { return translate('ai:processing'); }, get awaiting_approval() { return translate('ai:awaitingCommandApproval'); }, get compressing() { return translate('ai:compactingEarlierContext'); } };

function AIRequestStatus({run,visible}:{run?:AIRunView;visible:boolean}) {
  useTranslation();
  const [now,setNow]=useState(Date.now);
  const started=run?.model_started_at||0;
  useEffect(()=>{
    if(!visible||!started)return;
    setNow(Date.now());
    const timer=setInterval(()=>setNow(Date.now()),1000);
    return()=>clearInterval(timer);
  },[visible,started]);
  let label=states[run?.state||'']||'';
  if(started&&run?.state==='running') {
    const idle=now-(run.model_last_activity_at||started);
    label=!run.live_text?translate('ai:waitingForModelResponse'):idle>=30000?translate('ai:waitingForModelToContinue'):translate('ai:responding');
  }
  const seconds=started?Math.max(0,Math.floor((now-started)/1000)):0;
  return <div className="ai-status" role="status">{label}{started?<span aria-live="off"> · {run?.live_text?translate('ai:elapsed'):translate('ai:waiting')} {Math.floor(seconds/60)}:{String(seconds%60).padStart(2,'0')}</span>:null}</div>;
}

export default function AIPanel({ workspace, visible, configRevision, references, onRemoveReference, onReferencesSent, onClose }: { workspace: string; visible: boolean; configRevision: number; references: Reference[]; onRemoveReference(index: number): void; onReferencesSent(sent: Reference[]): void; onClose(): void }) {
  useTranslation();
  const ai = useAIConversation(workspace, visible, configRevision);
  const [text, setText] = useState('');
  const [history, setHistory] = useState(false);
  const [acceptTarget, setAcceptTarget] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const running = aiRunning(ai.run);
  const messages = ai.page?.messages || [];
  const targetChanged = !!ai.page && ai.page.current_target !== ai.page.conversation.target;
  useEffect(() => { setAcceptTarget(false); }, [ai.page?.conversation.id, ai.page?.current_target]);
  useEffect(() => { if (references.length) setHistory(false); }, [references]);
  useEffect(() => { if (!visible || history) return; const frame=requestAnimationFrame(()=>input.current?.focus());return()=>cancelAnimationFrame(frame); }, [visible, history, references]);
  useEffect(() => { if (visible && pinned.current && !ai.browsing) transcript.current?.scrollTo({ top: transcript.current.scrollHeight }); }, [visible, ai.run?.revision, ai.page, history]);
  async function send() {
    if (!visible || running || ai.busy || ai.loading || (!text.trim() && !references.length)) return;
    const sent=references.slice();
    if (await ai.send(text, sent, acceptTarget)) { setText(''); onReferencesSent(sent); pinned.current = true; input.current?.focus(); }
  }
  const pending = ai.run?.pending;
  const pendingInPage = pending && messages.some(item => item.run_id === ai.run?.id && item.message.tool_calls?.some(call => call.id === pending.call.id));
  return <section className="ai-panel" aria-label={translate('ai:aIAssistant')}>
    <header className="ai-panel-header"><strong>{translate('ai:aIAssistant')}</strong><div><button className="icon-button" aria-label={translate('ai:newConversation')} disabled={ai.busy || ai.loading} onClick={async () => { if (await ai.newConversation()) { setHistory(false); pinned.current = true; } }}><Icon name="plus" width="15" /></button><button className="icon-button" aria-label={translate('ai:conversationHistory')} aria-pressed={history} onClick={() => setHistory(value => !value)}><Icon name="list" width="15" /></button><button className="icon-button" aria-label={translate('ai:collapseAIAssistant')} onClick={onClose}><Icon name="close" width="15" /></button></div></header>
    {history ? <AIHistory workspace={workspace} current={ai.run?.conversation_id} busy={ai.busy} operationError={errorMessage(eventError(ai))} onOpen={async id => { const ok = await ai.openConversation(id); if (ok) { setHistory(false); pinned.current = true; } return ok; }} onDelete={ai.deleteConversation} /> : <>
      {ai.page?.conversation.summary_through ? <details className="ai-context-summary"><summary>{translate('ai:earlierContextCompacted')}</summary><p>{ai.page.conversation.summary}</p></details> : null}
      {targetChanged && <div className="ai-target-change"><div>{translate('ai:originalDestination')}{ai.page!.conversation.target}</div><div>{translate('ai:currentDestination')}{ai.page!.current_target}</div><label><input type="checkbox" checked={acceptTarget} onChange={event => setAcceptTarget(event.target.checked)} />{translate('ai:continueOnCurrentDestination')}</label></div>}
      <div ref={transcript} className="ai-transcript" aria-label={translate('ai:aIConversationHistory')} onScroll={event => { const host = event.currentTarget; pinned.current = host.scrollHeight - host.scrollTop - host.clientHeight < 48; }}>
        {ai.page?.has_more && <button className="session-tool" disabled={ai.busy} onClick={() => void ai.loadPage(true)}>{translate('ai:earlierMessages')}</button>}
        {ai.browsing && <button className="session-tool" disabled={ai.busy} onClick={() => { pinned.current = true; void ai.loadPage(false); }}>{translate('ai:recentMessages')}</button>}
        {ai.loading && <p className="muted" role="status">{translate('ai:loading')}</p>}
        <AIConversation messages={messages} run={ai.run} busy={ai.busy} onDecide={approved => void ai.decide(approved)} onError={ai.setError} />
        {!ai.browsing && ai.run?.live_text && <article className="ai-message assistant"><div className="ai-message-role">{translate('ai:assistant')}</div><div className="ai-stream-text">{ai.run.live_text}</div></article>}
      </div>
      {pending && !pendingInPage && <AIToolCall call={pending.call} shell={pending.shell} pending active busy={ai.busy} onDecide={approved => void ai.decide(approved)} />}
      <AIRequestStatus run={ai.run} visible={visible}/>
      <form className="ai-composer" onSubmit={event => { event.preventDefault(); void send(); }}>
        {!!references.length && <div className="ai-pending-references" aria-label={translate('ai:pendingTerminalReferences')}>{references.map((reference,index)=><div className="ai-pending-reference" key={index}><details><summary>{reference.label || translate('ai:terminal', { value1: reference.terminal.slice(0,8) })}</summary><pre>{reference.text}</pre></details><button type="button" className="icon-button" aria-label={translate('ai:removeReference', { value1: index+1 })} onClick={()=>onRemoveReference(index)}><Icon name="close" width="12"/></button></div>)}</div>}
        <textarea ref={input} disabled={ai.busy || !visible} aria-label={translate('ai:questionToSendToAI')} placeholder={translate('ai:askAboutThisHost')} rows={3} maxLength={32768} value={text} onChange={event => setText(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} /><div className="ai-composer-actions">{running ? <button type="button" className="session-tool" disabled={ai.busy} onClick={() => void ai.stop()}>{translate('ai:stop')}</button> : <button type="submit" className="session-tool ai-send" disabled={!visible || ai.busy || ai.loading || !text.trim() && !references.length || targetChanged && !acceptTarget}>{translate('ai:send')}</button>}</div></form>
    </>}
    {(errorMessage(eventError(ai)) || errorMessage(eventError(ai.run))) && <div className="ai-error" role="alert">{errorMessage(eventError(ai)) || errorMessage(eventError(ai.run))}{errorMessage(eventError(ai)) && <button className="session-tool" onClick={ai.retry}>{translate('ai:reload')}</button>}</div>}
  </section>;
}
