import { useEffect, useRef, useState } from 'react';
import Icon from '../../components/Icon';
import useAIConversation, { aiRunning } from './useAIConversation';
import AIConversation from './AIConversation';
import AIHistory from './AIHistory';
import AIToolCall from './AIToolCall';

const states: Record<string, string> = { running: '正在回复', awaiting_approval: '等待命令批准', compressing: '正在压缩较早上下文', stopped: '已停止', failed: '失败' };

export default function AIPanel({ workspace, visible, configRevision, onClose }: { workspace: string; visible: boolean; configRevision: number; onClose(): void }) {
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
  useEffect(() => { if (visible && !history) input.current?.focus(); }, [visible, history]);
  useEffect(() => { if (visible && pinned.current && !ai.browsing) transcript.current?.scrollTo({ top: transcript.current.scrollHeight }); }, [visible, ai.run?.revision, ai.page, history]);
  async function send() {
    if (!visible || running || ai.busy || ai.loading || !text.trim()) return;
    if (await ai.send(text, [], acceptTarget)) { setText(''); pinned.current = true; input.current?.focus(); }
  }
  const pending = ai.run?.pending;
  const pendingInPage = pending && messages.some(item => item.run_id === ai.run?.id && item.message.tool_calls?.some(call => call.id === pending.call.id));
  return <section className="ai-panel" aria-label="AI 助手">
    <header className="ai-panel-header"><strong>AI 助手</strong><div><button className="icon-button" aria-label="新对话" disabled={ai.busy || ai.loading} onClick={async () => { if (await ai.newConversation()) { setHistory(false); pinned.current = true; } }}><Icon name="plus" width="15" /></button><button className="icon-button" aria-label="对话历史" aria-pressed={history} onClick={() => setHistory(value => !value)}><Icon name="list" width="15" /></button><button className="icon-button" aria-label="收起 AI 助手" onClick={onClose}><Icon name="close" width="15" /></button></div></header>
    {history ? <AIHistory workspace={workspace} current={ai.run?.conversation_id} busy={ai.busy} onOpen={async id => { const ok = await ai.openConversation(id); if (ok) { setHistory(false); pinned.current = true; } return ok; }} onDelete={ai.deleteConversation} /> : <>
      {ai.page?.conversation.summary_through ? <details className="ai-context-summary"><summary>较早上下文已压缩</summary><p>{ai.page.conversation.summary}</p></details> : null}
      {targetChanged && <div className="ai-target-change"><div>原目标 {ai.page!.conversation.target}</div><div>当前目标 {ai.page!.current_target}</div><label><input type="checkbox" checked={acceptTarget} onChange={event => setAcceptTarget(event.target.checked)} />在当前目标继续</label></div>}
      <div ref={transcript} className="ai-transcript" aria-label="AI 对话记录" onScroll={event => { const host = event.currentTarget; pinned.current = host.scrollHeight - host.scrollTop - host.clientHeight < 48; }}>
        {ai.page?.has_more && <button className="session-tool" disabled={ai.busy} onClick={() => void ai.loadPage(true)}>较早消息</button>}
        {ai.browsing && <button className="session-tool" disabled={ai.busy} onClick={() => { pinned.current = true; void ai.loadPage(false); }}>最近消息</button>}
        {ai.loading && <p className="muted" role="status">正在载入…</p>}
        <AIConversation messages={messages} run={ai.run} busy={ai.busy} onDecide={approved => void ai.decide(approved)} onError={ai.setError} />
        {!ai.browsing && ai.run?.live_text && <article className="ai-message assistant"><div className="ai-message-role">助手</div><div className="ai-stream-text">{ai.run.live_text}</div></article>}
      </div>
      {pending && !pendingInPage && <AIToolCall call={pending.call} pending active busy={ai.busy} onDecide={approved => void ai.decide(approved)} />}
      <div className="ai-status" role="status">{states[ai.run?.state || ''] || ''}</div>
      <form className="ai-composer" onSubmit={event => { event.preventDefault(); void send(); }}><textarea ref={input} aria-label="发送给 AI 的问题" placeholder="询问当前主机…" rows={3} maxLength={32768} value={text} onChange={event => setText(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} /><div className="ai-composer-actions">{running ? <button type="button" className="session-tool" disabled={ai.busy} onClick={() => void ai.stop()}>停止</button> : <button type="submit" className="session-tool ai-send" disabled={ai.busy || ai.loading || !text.trim() || targetChanged && !acceptTarget}>发送</button>}</div></form>
    </>}
    {(ai.error || ai.run?.error) && <div className="ai-error" role="alert">{ai.error || ai.run?.error}{ai.error && <button className="session-tool" onClick={ai.retry}>重新载入</button>}</div>}
  </section>;
}
