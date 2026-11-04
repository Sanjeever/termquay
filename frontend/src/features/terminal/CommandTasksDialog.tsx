import { useEffect, useRef, useState } from 'react';
import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react';
import SelectControl from '../../components/SelectControl';
import { DeleteCommandTask, ListCommandTasks, RunCommandStep, PrepareInspectionBaseline, ValidateCommandSteps, SaveCommandTask, ExportCommandResults } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { CommandStep, CommandTask, InspectionBaseline, InspectionCheckResult } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import type { CommandResult } from '../../../bindings/github.com/Sanjeever/termquay/internal/ssh/models';
import { errorMessage } from '../../lib/errors';
import { expandSnippet, snippetParameters } from '../../lib/snippets';
import ReadonlyDiffView from '../files/ReadonlyDiffView';
import CommandTargets, { type CommandTarget } from './CommandTargets';
import type { Group } from '../../../bindings/github.com/Sanjeever/termquay/internal/store/models';
import { runCommandTask } from './commandTaskRunner';
import CommandCheckEditor from './CommandCheckEditor';

type Target = CommandTarget;
type Result = { key: string; target: Target; step: string; index: number; state: string; result?: CommandResult; check?: InspectionCheckResult; baseline?: string; error?: string };
type TaskDraft = CommandTask & { steps: CommandStep[] };
const emptyTask = (): TaskDraft => ({ id: '', name: '', steps: [{ name: '步骤 1', script: '', timeout_seconds: 60 }], stop_on_failure: true });

export default function CommandTasksDialog({ targets, groups: catalogGroups, onClose }: { targets: Target[]; groups?: Group[]; onClose(): void }) {
  const [tasks, setTasks] = useState<CommandTask[]>([]);
  const [task, setTask] = useState<TaskDraft>(emptyTask);
  const [baseline, setBaseline] = useState(() => JSON.stringify(emptyTask()));
  const [selected, setSelected] = useState(new Set<string>());
  const [parameters, setParameters] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Result[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [discard, setDiscard] = useState<CommandTask | 'close'>();
  const [deleting, setDeleting] = useState(false);
  const [group, setGroup] = useState('target');
  const [comparison, setComparison] = useState<[string, string]>(['', '']);
  const [output, setOutput] = useState<'stdout' | 'stderr'>('stdout');
  const mounted = useRef(true);
  const pending = useRef(new Map<string, { cancel(): unknown }>());
  const running = useRef(false);
  const cancelled = useRef(false);
  const [waitingBatch, setWaitingBatch] = useState(false);
  const batchApproval = useRef<(approved: boolean) => void>();
  const [exportSelection, setExportSelection] = useState(new Set<string>());
  const [baselineTarget, setBaselineTarget] = useState('');
  const dirty = JSON.stringify(task) !== baseline;
  const names = [...new Set(task.steps.flatMap(step => snippetParameters(step.check?.kind === 'file' ? step.check.file_path || '' : step.script)))];
  const expanded = task.steps.map(step => { const script = expandSnippet(step.script, parameters); const file = expandSnippet(step.check?.file_path || '', parameters); return { ...step, ...script, error: script.error || file.error, check: step.check ? { ...step.check, file_path: file.text } : undefined }; });
  const invalid = task.steps.some(step => !step.name.trim() || (step.check?.kind === 'file' ? !step.check.file_path?.startsWith('/') : !step.script.trim()) || (step.check && step.check.kind !== 'file' && !step.check.expected) || step.timeout_seconds < 1 || step.timeout_seconds > 600 || !Number.isInteger(step.timeout_seconds)) || !Number.isInteger(task.concurrency || 3) || (task.concurrency || 3) < 1 || (task.concurrency || 3) > 3 || !Number.isInteger(task.batch_size || 64) || (task.batch_size || 64) < 1 || (task.batch_size || 64) > 64;
  const needsBaseline = task.steps.some(step => step.check?.kind === 'file');
  const expansionError = expanded.find(step => step.error || new TextEncoder().encode(step.text).length > 32768);
  function cancel() { cancelled.current = true; batchApproval.current?.(false); batchApproval.current = undefined; setWaitingBatch(false); pending.current.forEach(request => request.cancel()); }
  useEffect(() => {
    mounted.current = true;
    const request = ListCommandTasks();
    request.then(values => { if (mounted.current) setTasks(values || []); }).catch(e => { if (mounted.current) setError(errorMessage(e)); }).finally(() => { if (mounted.current) setLoading(false); });
    return () => { mounted.current = false; request.cancel(); cancel(); };
  }, []);
  function choose(value: CommandTask) { if (!value.steps?.length) { setError('命令任务缺少步骤'); return; } const draft = { ...value, steps: value.steps }; setTask(draft); setBaseline(JSON.stringify(draft)); setParameters({}); setError(''); }
  function requestChoose(value: CommandTask | 'close') { if (dirty) setDiscard(value); else if (value === 'close') onClose(); else choose(value); }
  function updateStep(index: number, patch: Partial<CommandStep>) { setTask(previous => ({ ...previous, steps: previous.steps.map((step, i) => i === index ? { ...step, ...patch } : step) })); }
  async function save() {
    setBusy(true); setError('');
    try { const value = await SaveCommandTask(task); if (mounted.current) { setTasks(previous => [...previous.filter(item => item.id !== value.id), value]); choose(value); } }
    catch (e) { if (mounted.current) setError(errorMessage(e)); }
    finally { if (mounted.current) setBusy(false); }
  }
  function update(key: string, patch: Partial<Result>) { if (mounted.current) setResults(previous => previous.map(result => result.key === key ? { ...result, ...patch } : result)); }
  async function run() {
    if (running.current || busy || invalid || expansionError || !selected.size) return;
    const chosen = targets.filter(target => selected.has(target.id));
    if (!chosen.length) return;
    if (chosen.length > 64) { setError('每次最多执行 64 个工作区'); return; }
    if (needsBaseline && !targets.some(target => target.id === baselineTarget)) { setError('请选择已连接的基线主机'); return; }
    const steps: CommandStep[] = expanded.map(step => ({ name: step.name, script: step.text, timeout_seconds: step.timeout_seconds, check: step.check }));
    const baselines = new Map<number, InspectionBaseline>();
    const baselineName = targets.find(target => target.id === baselineTarget);
    running.current = true; cancelled.current = false; setBusy(true); setError(''); setComparison(['', '']);
    setResults(chosen.flatMap(target => steps.map((step, index) => ({ key: `${target.id}:${index}`, target, step: step.name, index, state: '等待', baseline: step.check?.kind === 'file' && baselineName ? `${baselineName.name} · ${baselineName.address} · ${step.check.file_path}` : undefined }))));
    setExportSelection(new Set());
    setGroup(steps.some(step => step.check) ? 'matrix' : 'target');
    try {
      const validation = ValidateCommandSteps(steps); pending.current.set('validation', validation);
      try { await validation; } finally { pending.current.delete('validation'); }
      if (cancelled.current) return;
      for (let index = 0; index < steps.length; index++) {
        const check = steps[index].check;
        if (check?.kind !== 'file') continue;
        if (cancelled.current) return;
        const request = PrepareInspectionBaseline(baselineTarget, check.file_path || '', steps[index].timeout_seconds);
        pending.current.set(`baseline:${index}`, request);
        try { baselines.set(index, await request); } finally { pending.current.delete(`baseline:${index}`); }
      }
      await runCommandTask(chosen, steps, task, {
        cancelled: () => cancelled.current,
        async execute(target, step, index) {
          const key = `${target.id}:${index}`;
          update(key, { state: '执行中' });
          const request = RunCommandStep(target.id, step, baselines.get(index) || null);
          pending.current.set(key, request);
          try {
            const result = await request;
            const command = result.command || undefined;
            const check = result.check || undefined;
            const failed = check ? check.state !== 'pass' : !command || !!command.error || command.exit_code !== 0;
            update(key, { result: command, check, state: check ? ({ pass: '通过', fail: '不通过', unknown: '无法判定' }[check.state] || '无法判定') : command?.error ? '失败' : failed ? '非零退出' : '完成' });
            return failed;
          } catch (e) {
            update(key, { state: cancelled.current ? '已请求取消' : step.check ? '无法判定' : '失败', error: errorMessage(e), check: step.check ? { state: 'unknown', message: errorMessage(e) } : undefined });
            return true;
          } finally {
            pending.current.delete(key);
          }
        },
        async approveFirstHost() {
          setWaitingBatch(true);
          const approved = await new Promise<boolean>(resolve => { batchApproval.current = resolve; });
          batchApproval.current = undefined;
          if (mounted.current) setWaitingBatch(false);
          return approved;
        },
      });
    } catch (e) { if (mounted.current && !cancelled.current) setError(errorMessage(e)); }
    finally {
      running.current = false;
      if (mounted.current) { setBusy(false); setResults(previous => previous.map(result => result.state === '等待' ? { ...result, state: '未执行' } : result)); }
    }
  }
  const comparable = results.filter(item => item.result);
  const left = results.find(item => item.key === comparison[0]), right = results.find(item => item.key === comparison[1]);
  const matrixTargets = new Map(results.map(result => [result.target.id, result.target]));
  const matrixSteps = new Map(results.map(result => [result.index, result.step]));
  const matrixResults = new Map(results.map(result => [result.key, result]));
  const groups = new Map<string, Result[]>();
  results.forEach(result => {
    const key = group === 'exit' ? result.result ? `退出码 ${result.result.exit_code}` : result.state : group === 'output' && result.result ? JSON.stringify([result.result.exit_code, result.result.stdout, result.result.stderr, result.result.truncated, result.result.error]) : result.target.id;
    groups.set(key, [...(groups.get(key) || []), result]);
  });
  return <Modal isOpen onClose={() => { if (!busy) requestChoose('close'); }} isDismissable={!busy} isKeyboardDismissDisabled={busy} size="5xl" className="app-dialog" scrollBehavior="inside"><ModalContent><ModalHeader>多主机任务与巡检</ModalHeader><ModalBody>
    <label className="form-field">任务<SelectControl disabled={busy || loading} value={task.id} onChange={event => requestChoose(tasks.find(item => item.id === event.target.value) || emptyTask())}><option value="">新任务</option>{tasks.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</SelectControl></label>
    <label className="form-field">名称<input disabled={busy} maxLength={128} value={task.name} onChange={event => setTask({ ...task, name: event.target.value })} /></label>
    <div className="button-row"><label className="form-field">并发主机数<input type="number" min={1} max={3} value={task.concurrency || 3} disabled={busy} onChange={event => setTask({ ...task, concurrency: Number(event.target.value) })} /></label><label className="form-field">每批主机数<input type="number" min={1} max={64} value={task.batch_size || ''} placeholder="全部目标" disabled={busy} onChange={event => setTask({ ...task, batch_size: Number(event.target.value) })} /></label><label className="checkbox-label"><input type="checkbox" checked={!!task.first_host_approval} disabled={busy} onChange={event => setTask({ ...task, first_host_approval: event.target.checked })} />首台完成后人工确认</label><label className="checkbox-label"><input type="checkbox" checked={!!task.stop_all_on_failure} disabled={busy} onChange={event => setTask({ ...task, stop_all_on_failure: event.target.checked })} />任一失败停止后续主机与批次</label></div>
    {waitingBatch && <div className="button-row" role="status"><span>首台执行结束，请核对结果</span><Button size="sm" onPress={() => batchApproval.current?.(true)}>继续剩余主机</Button><Button size="sm" variant="light" onPress={cancel}>停止后续执行</Button></div>}
    {task.steps.map((step, index) => <fieldset key={index} disabled={busy}><legend>步骤 {index + 1}</legend>
      <label className="form-field">名称<input maxLength={128} value={step.name} onChange={event => updateStep(index, { name: event.target.value })} /></label>
      <CommandCheckEditor check={step.check} onChange={check => updateStep(index, { check, ...(check?.kind === 'file' ? { script: '' } : {}) })} />
      {step.check?.kind !== 'file' && <label className="form-field">命令<textarea className="command-source" rows={3} maxLength={32768} value={step.script} spellCheck={false} onChange={event => updateStep(index, { script: event.target.value })} /></label>}
      <label className="form-field">超时（秒）<input type="number" min={1} max={600} value={step.timeout_seconds} onChange={event => updateStep(index, { timeout_seconds: Number(event.target.value) })} /></label>
      <Button size="sm" variant="light" isDisabled={busy || task.steps.length === 1} onPress={() => setTask({ ...task, steps: task.steps.filter((_, i) => i !== index) })}>移除此步骤</Button>
    </fieldset>)}
    <div className="button-row"><Button size="sm" variant="light" isDisabled={busy || task.steps.length >= 16} onPress={() => setTask({ ...task, steps: [...task.steps, { name: `步骤 ${task.steps.length + 1}`, script: '', timeout_seconds: 60 }] })}>添加步骤</Button><label className="checkbox-label"><input type="checkbox" disabled={busy} checked={task.stop_on_failure} onChange={event => setTask({ ...task, stop_on_failure: event.target.checked })} />失败后停止该主机后续步骤</label></div>
    {names.map(name => <label className="form-field" key={name}>{name}<input maxLength={4096} disabled={busy} value={parameters[name] || ''} onChange={event => setParameters({ ...parameters, [name]: event.target.value })} /></label>)}
    {!!names.length && <details><summary>展开后的命令</summary>{expanded.map((step, index) => <pre key={index}>{step.text}</pre>)}</details>}
    <CommandTargets targets={targets} groups={catalogGroups} selected={selected} onChange={setSelected} busy={busy} />
    {needsBaseline && <label className="form-field">文件基线主机<SelectControl value={baselineTarget} disabled={busy} onChange={event => setBaselineTarget(event.target.value)}><option value="">选择已连接 SSH 工作区</option>{targets.map(target => <option key={target.id} value={target.id}>{target.name} · {target.address}</option>)}</SelectControl></label>}
    {error && <p className="error" role="alert">{error}</p>}{expansionError && <p className="error" role="alert">{expansionError.error || '替换后命令超过 32 KiB'}</p>}
    {!!results.length && <><label className="form-field">结果视图<SelectControl value={group} onChange={event => setGroup(event.target.value)}><option value="matrix">巡检总览</option><option value="target">按主机</option><option value="exit">按退出码</option><option value="output">按相同输出</option></SelectControl></label>
      {group === 'matrix' ? <div className="inspection-matrix"><table><thead><tr><th>主机</th>{Array.from(matrixSteps, ([index, name]) => <th key={index}>{name}</th>)}</tr></thead><tbody>{Array.from(matrixTargets.values(), target => <tr key={target.id}><th scope="row">{target.name}</th>{Array.from(matrixSteps.keys(), index => { const item = matrixResults.get(`${target.id}:${index}`); return <td key={index}><span className={item?.check?.state === 'fail' || item?.check?.state === 'unknown' ? 'error' : ''} title={item?.check?.message || item?.error}>{item?.state || '未执行'}</span></td>; })}</tr>)}</tbody></table></div> : Array.from(groups.values(), (items, index) => <details key={index} open={group === 'target'}><summary>{group === 'target' ? items[0].target.name : group === 'exit' ? items[0].result ? `退出码 ${items[0].result.exit_code}` : items[0].state : `输出组 ${index + 1}`} · {items.length} 项</summary><table><thead><tr><th>主机</th><th>步骤</th><th>状态</th><th>退出码</th><th>耗时</th><th>详情</th></tr></thead><tbody>{items.map(item => <tr key={item.key}><td>{item.target.name}</td><td>{item.step}</td><td>{item.state}</td><td>{item.result?.exit_code ?? '—'}</td><td>{item.result ? `${(item.result.duration_ms / 1000).toFixed(2)}s` : '—'}</td><td><details><summary>查看</summary>{item.check && <><p>{item.check.message}</p>{item.check.actual !== undefined && <pre>实际值 {item.check.actual}</pre>}{item.check.expected !== undefined && <pre>预期值 {item.check.expected}</pre>}</>}{item.baseline && <p>基线 {item.baseline}</p>}{(item.error || item.result?.error) && <p className="error">{item.error || item.result?.error}</p>}<pre>{item.result?.stdout}</pre><pre className="error">{item.result?.stderr}</pre>{item.result?.truncated && <p>输出已截断</p>}</details></td></tr>)}</tbody></table></details>)}
    </>}
    {!!results.length && <details><summary>选择并导出执行结果</summary>{results.map(item => <label className="checkbox-label" key={item.key}><input type="checkbox" checked={exportSelection.has(item.key)} onChange={event => setExportSelection(previous => { const next = new Set(previous); if (event.target.checked) next.add(item.key); else next.delete(item.key); return next; })} />{item.target.name} · {item.step} · {item.state}</label>)}<Button size="sm" variant="light" isDisabled={busy || !exportSelection.size} onPress={() => { ExportCommandResults(results.filter(item => exportSelection.has(item.key)).map(item => ({ target: item.target.name, address: item.target.address, step: item.step, state: item.state, result: item.result, check: item.check, baseline: item.baseline, error: item.error || '' }))).catch(e => setError(errorMessage(e))); }}>导出所选结果</Button></details>}
    {comparable.length > 1 && <><div className="file-compare-sides">{comparison.map((value, index) => <label className="form-field" key={index}>{index ? '右侧结果' : '左侧结果'}<SelectControl value={value} onChange={event => setComparison(previous => previous.map((key, i) => index === i ? event.target.value : key) as [string, string])}><option value="">选择结果</option>{comparable.map(item => <option key={item.key} value={item.key}>{item.target.name} · {item.step}</option>)}</SelectControl></label>)}</div><SelectControl aria-label="对比输出通道" value={output} onChange={event => setOutput(event.target.value as 'stdout' | 'stderr')}><option value="stdout">stdout</option><option value="stderr">stderr</option></SelectControl>
      <ReadonlyDiffView left={left?.result?.[output]} right={right?.result?.[output]} leftLabel="左侧执行结果" rightLabel="右侧执行结果" />
    </>}
  </ModalBody><ModalFooter><Button variant="light" isDisabled={busy} onPress={() => requestChoose('close')}>关闭</Button>{task.id && <Button color="danger" variant="light" isDisabled={busy} onPress={() => setDeleting(true)}>删除任务</Button>}<Button variant="light" isDisabled={busy || loading || !task.name.trim() || invalid || !dirty} onPress={() => void save()}>保存任务</Button>{running.current ? <Button color="danger" variant="light" onPress={cancel}>请求取消</Button> : <Button color="primary" isDisabled={busy || loading || !selected.size || invalid || !!expansionError} onPress={() => void run()}>在 {selected.size} 个工作区执行</Button>}</ModalFooter>
  </ModalContent>
    <Modal isOpen={!!discard} onClose={() => setDiscard(undefined)} className="app-dialog"><ModalContent><ModalHeader>任务尚未保存</ModalHeader><ModalFooter><Button variant="light" onPress={() => setDiscard(undefined)}>返回编辑</Button><Button color="danger" onPress={() => { const next = discard; setDiscard(undefined); if (next === 'close') onClose(); else if (next) choose(next); }}>放弃修改</Button></ModalFooter></ModalContent></Modal>
    <Modal isOpen={deleting} onClose={() => !busy && setDeleting(false)} className="app-dialog"><ModalContent><ModalHeader>删除任务“{task.name}”？</ModalHeader><ModalFooter><Button variant="light" isDisabled={busy} onPress={() => setDeleting(false)}>取消</Button><Button color="danger" isLoading={busy} onPress={async () => { setBusy(true); try { await DeleteCommandTask(task.id); setTasks(previous => previous.filter(item => item.id !== task.id)); choose(emptyTask()); setDeleting(false); } catch (e) { setError(errorMessage(e)); setDeleting(false); } finally { setBusy(false); } }}>删除</Button></ModalFooter></ModalContent></Modal>
  </Modal>;
}
