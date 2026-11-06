import { memo, useMemo } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Browser } from '@wailsio/runtime';
import type { AIMessage, AIRunView } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import { errorMessage } from '../../lib/errors';
import AIToolCall from './AIToolCall';
import { aiRunning } from './useAIConversation';

const AIText = memo(function AIText({ text, onError }: { text: string; onError(error: string): void }) {
  if (text.length > 32768) return <pre className="ai-plain-text">{text}</pre>;
  return <Markdown skipHtml remarkPlugins={[remarkGfm]} components={{
    img: ({ alt }) => <span>{alt || '[图片]'}</span>,
    a: ({ href, children }) => href && /^https?:\/\//i.test(href) ? <a href={href} onClick={event => { event.preventDefault(); void Browser.OpenURL(href).catch(e => onError(errorMessage(e))); }}>{children}</a> : <span>{children}</span>,
  }}>{text}</Markdown>;
});

export default function AIConversation({ messages, run, busy, onDecide, onError }: { messages: AIMessage[]; run?: AIRunView; busy: boolean; onDecide(approved: boolean): void; onError(error: string): void }) {
  const results = useMemo(() => new Map(messages.filter(m => m.message.role === 'tool').map(m => [`${m.run_id}:${m.message.tool_call_id}`, m])), [messages]);
  const calls = useMemo(() => new Set(messages.flatMap(m => (m.message.tool_calls || []).map(call => `${m.run_id}:${call.id}`))), [messages]);
  return <>{messages.map(item => {
    const m = item.message;
    if (m.role === 'status') return item.state === 'complete' ? null : <p className="ai-run-status muted" key={item.seq}>{m.content}</p>;
    if (m.role === 'tool') return calls.has(`${item.run_id}:${m.tool_call_id}`) ? null : <details className="ai-tool-call" key={item.seq}><summary>工具结果 · {m.tool_call_id}</summary><pre>{m.content}</pre></details>;
    return <article className={`ai-message ${m.role}`} key={item.seq}>
      <div className="ai-message-role">{m.role === 'user' ? '你' : '助手'}{item.state === 'interrupted' ? ' · 回复中断' : ''}</div>
      {m.role === 'user' ? <div className="ai-user-text">{m.content}</div> : <div className="ai-markdown"><AIText text={m.content} onError={onError} /></div>}
      {m.references?.map((r, index) => <details className="ai-reference" key={index}><summary>终端引用 · {r.label || r.terminal.slice(0, 8)}</summary><pre>{r.text}</pre></details>)}
      {m.tool_calls?.map(call => <AIToolCall key={call.id} call={call} result={results.get(`${item.run_id}:${call.id}`)} pending={run?.pending?.call.id === call.id && run.id === item.run_id} active={run?.id === item.run_id && aiRunning(run)} busy={busy} onDecide={onDecide} />)}
    </article>;
  })}</>;
}
