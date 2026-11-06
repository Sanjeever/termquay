import { useEffect, useRef, useState } from 'react';
import { Stream } from '@wailsio/runtime';
import { CreateAIConversation, DeleteAIConversation, GetAIConversation, GetAIRun, OpenAIConversation, StartAIRun, StopAIRun, ApproveAIToolCall, RejectAIToolCall } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { AIConversationPage, AIRunView, AIToolDecision } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import type { Reference } from '../../../bindings/github.com/Sanjeever/termquay/internal/ai/models';
import { errorMessage } from '../../lib/errors';

export const aiRunning = (view?: AIRunView) => !!view && ['running', 'awaiting_approval', 'compressing'].includes(view.state);

export default function useAIConversation(workspace: string, visible: boolean, configRevision: number) {
  const [run, setRun] = useState<AIRunView>();
  const [page, setPage] = useState<AIConversationPage>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const generation = useRef(0);
  const operated = useRef(false);
  const current = useRef(run); current.current = run;
  const currentPage = useRef(page); currentPage.current = page;
  const browsing = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++; }; }, []);
  function reconnect() { generation.current++; setEpoch(previous => previous + 1); }

  useEffect(() => {
    if (!visible) return;
    const token = ++generation.current;
    let ended = false;
    let stream: ReturnType<typeof Stream> | undefined;
    let loadingPage = false;
    let pageDirty = false;
    const valid = () => !ended && token === generation.current;
    async function refreshPage() {
      if (!valid() || browsing.current || !current.current?.conversation_id) return;
      if (loadingPage) { pageDirty = true; return; }
      loadingPage = true;
      try {
        do {
          pageDirty = false;
          const id = current.current!.conversation_id;
          const next = await GetAIConversation(workspace, id, 0, 24);
          if (valid() && !browsing.current && current.current?.conversation_id === id) { currentPage.current = next; setPage(next); }
        } while (valid() && pageDirty);
      } catch (e) { if (valid()) setError(errorMessage(e)); }
      finally { loadingPage = false; }
    }
    function receive(next: AIRunView) {
      if (!valid() || next.workspace !== workspace) return;
      const previous = current.current;
      if (previous?.id === next.id && next.revision < previous.revision) return;
      current.current = next; setRun(next);
      if (!next.conversation_id) { currentPage.current = undefined; setPage(undefined); }
      else if (next.conversation_id !== currentPage.current?.conversation.id || previous?.last_seq !== next.last_seq) void refreshPage();
    }
    setLoading(true); setError('');
    void GetAIRun(workspace).then(async next => {
      if (!valid()) return;
      current.current=next;setRun(next);
      if (next.conversation_id) await refreshPage();
      else {currentPage.current=undefined;setPage(undefined);}
      if (!valid()) return;
      stream = Stream('ai');
      stream.onopen = () => { if (valid()) stream?.send(new TextEncoder().encode(workspace)); };
      stream.onmessage = event => {
        if (!valid()) return;
        try { receive(JSON.parse(new TextDecoder().decode(event.data)) as AIRunView); }
        catch (e) { setError(`AI 状态读取失败：${errorMessage(e)}`); }
      };
      stream.onerror = () => { if (valid()) setError('AI 状态流已断开，请重新载入'); };
      stream.onclose = () => { if (valid()) setError('AI 状态流已断开，请重新载入'); };
    }).catch(e => { if (valid()) setError(errorMessage(e)); }).finally(() => { if (valid()) setLoading(false); });
    return () => { ended = true; stream?.close(); };
  }, [workspace, visible, epoch, configRevision]);

  async function act(action: () => Promise<void>) {
    if (operated.current) return false;
    operated.current = true; setBusy(true); setError('');
    try { await action(); return true; }
    catch (e) { if (mounted.current) setError(errorMessage(e)); return false; }
    finally { operated.current = false; if (mounted.current) setBusy(false); }
  }
  async function send(text: string, references: Reference[], acceptTargetChange: boolean) {
    return act(async () => {
      let id = current.current?.conversation_id;
      if (!id) id = (await CreateAIConversation(workspace)).id;
      const next = await StartAIRun({ workspace, conversation_id: id, text, references, accept_target_change: acceptTargetChange });
      if (!mounted.current) return;
      browsing.current = false; current.current = next; setRun(next); reconnect();
    });
  }
  async function newConversation() {
    return act(async () => {
      await CreateAIConversation(workspace);
      if (mounted.current) { browsing.current = false; currentPage.current = undefined; setPage(undefined); reconnect(); }
    });
  }
  async function openConversation(id: string) {
    return act(async () => {
      await OpenAIConversation(workspace, id);
      if (mounted.current) { browsing.current = false; currentPage.current = undefined; setPage(undefined); reconnect(); }
    });
  }
  async function deleteConversation(id: string) {
    return act(async () => {
      await DeleteAIConversation(workspace, id);
      if (mounted.current) { browsing.current = false; currentPage.current = undefined; setPage(undefined); reconnect(); }
    });
  }
  async function stop() { return act(async () => { if (current.current?.id) await StopAIRun(workspace, current.current.id); }); }
  async function decide(approved: boolean) {
    return act(async () => {
      const v = current.current;
      if (!v?.pending) throw new Error('此命令批准已失效');
      const d: AIToolDecision = { workspace, run_id: v.id, conversation_id: v.conversation_id, token: v.pending.token, call_id: v.pending.call.id, arguments: v.pending.call.arguments, timeout_seconds: v.pending.timeout_seconds };
      await (approved ? ApproveAIToolCall(d) : RejectAIToolCall(d));
    });
  }
  async function loadPage(earlier: boolean) {
    return act(async () => {
      const id = current.current?.conversation_id;
      if (!id) return;
      browsing.current = earlier;
      const first = currentPage.current?.messages?.[0]?.seq || 0;
      const next = await GetAIConversation(workspace, id, earlier ? first : 0, 24);
      if (mounted.current) { currentPage.current = next; setPage(next); }
    });
  }
  return { run, page, error, busy, loading, browsing: browsing.current, send, newConversation, openConversation, deleteConversation, stop, decide, loadPage, retry: reconnect, setError };
}
