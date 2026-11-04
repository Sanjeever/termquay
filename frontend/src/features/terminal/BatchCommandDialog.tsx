import { errorMessage } from "../../lib/errors";
import { useEffect, useRef, useState } from 'react';
import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react';
import SelectControl from '../../components/SelectControl';
import { RunRemoteCommand } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { CommandResult } from '../../../bindings/github.com/Sanjeever/termquay/internal/ssh/models';
import type { Snippet } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import { expandSnippet, snippetParameters } from '../../lib/snippets';
import CommandTargets, { type CommandTarget } from './CommandTargets';
import type { Group } from '../../../bindings/github.com/Sanjeever/termquay/internal/store/models';

type Target = CommandTarget;
type Result = { target: Target; state: string; result?: CommandResult; error?: string };

export default function BatchCommandDialog({ targets, groups, initial, snippets, onClose }: { targets: Target[]; groups?: Group[]; initial?: string; snippets: Snippet[]; onClose(): void }) {
  const [selected, setSelected] = useState(new Set(initial ? [initial] : []));
  const [body, setBody] = useState('');
  const [parameters, setParameters] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Result[]>([]);
  const [busy, setBusy] = useState(false);
  const [timeout, setTimeoutSeconds] = useState(60);
  const pending = useRef(new Map<string, ReturnType<typeof RunRemoteCommand>>());
  const cancelled = useRef(false);
  const mounted = useRef(true);
  const names = snippetParameters(body);
  const expanded = expandSnippet(body, parameters);
  function cancel() { cancelled.current = true; pending.current.forEach(request => request.cancel()); }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; cancel(); }; }, []);
  function update(id: string, value: Partial<Result>) { if (mounted.current) setResults(previous => previous.map(result => result.target.id === id ? { ...result, ...value } : result)); }
  async function run() {
    if (busy || expanded.error) return;
    const chosen = targets.filter(target => selected.has(target.id));
    const command = expanded.text;
    cancelled.current = false; setBusy(true); setResults(chosen.map(target => ({ target, state: '等待' })));
    let cursor = 0;
    async function worker() {
      while (!cancelled.current && cursor < chosen.length) {
        const target = chosen[cursor++]; update(target.id, { state: '执行中' });
        const request = RunRemoteCommand(target.id, command, timeout); pending.current.set(target.id, request);
        try { const result = await request; update(target.id, { result, state: result.error ? '失败' : result.exit_code === 0 ? '完成' : '非零退出' }); }
        catch (e) { update(target.id, { state: cancelled.current ? '已请求取消' : '失败', error: errorMessage(e) }); }
        finally { pending.current.delete(target.id); }
      }
    }
    await Promise.all(Array.from({ length: Math.min(3, chosen.length) }, worker));
    if (mounted.current) { setBusy(false); setResults(previous => previous.map(result => result.state === '等待' ? { ...result, state: '未执行' } : result)); }
  }
  return <Modal isOpen onClose={() => { cancel(); onClose(); }} size="3xl" className="app-dialog" scrollBehavior="inside" isDismissable={!busy}><ModalContent><ModalHeader>多主机命令</ModalHeader><ModalBody>
    <CommandTargets targets={targets} groups={groups} selected={selected} onChange={setSelected} busy={busy} />
    {!!snippets.length && <label className="form-field">命令片段<SelectControl value="" disabled={busy} onChange={event => { const snippet = snippets.find(value => value.id === event.target.value); if (snippet) { setBody(snippet.body); setParameters({}); } }}><option value="">选择片段</option>{snippets.map(snippet => <option key={snippet.id} value={snippet.id}>{snippet.name}</option>)}</SelectControl></label>}
    <label className="form-field">命令<textarea className="command-source" aria-label="多主机命令" rows={5} value={body} maxLength={32768} disabled={busy} onChange={event => setBody(event.target.value)} spellCheck={false}/></label>
    {names.map(name => <label className="form-field" key={name}>{name}<input value={parameters[name] || ''} disabled={busy} maxLength={4096} onChange={event => setParameters({ ...parameters, [name]: event.target.value })}/></label>)}
    {!!names.length && <pre className="paste-preview">{expanded.text}</pre>}
    <label className="form-field">超时（秒）<input type="number" min={1} max={600} value={timeout} disabled={busy} onChange={event => setTimeoutSeconds(Number(event.target.value))}/></label>
    {expanded.error && <p role="alert" className="error">{expanded.error}</p>}
    <div className="command-results">{results.map(({target,state,result,error}) => <details key={target.id}><summary><span>{target.name}</span><span className={error || result?.error || result && result.exit_code !== 0 ? 'error' : 'muted'}>{state}{result && ` · ${result.exit_code < 0 ? '未知退出状态' : `退出码 ${result.exit_code}`} · ${(result.duration_ms / 1000).toFixed(2)}s`}</span></summary>{(error || result?.error) && <p role="alert" className="error">{error || result?.error}</p>}{result?.stdout && <pre>{result.stdout}</pre>}{result?.stderr && <pre className="error">{result.stderr}</pre>}{result?.truncated && <p className="muted">输出超过上限，已截断</p>}</details>)}</div>
  </ModalBody><ModalFooter><Button variant="light" onPress={() => { cancel(); onClose(); }}>关闭</Button>{busy ? <Button color="danger" variant="light" onPress={cancel}>请求取消</Button> : <Button color="primary" isDisabled={!selected.size || !body.trim() || !!expanded.error || timeout < 1 || timeout > 600} onPress={() => void run()}>在 {selected.size} 个工作区执行</Button>}</ModalFooter></ModalContent></Modal>;
}
