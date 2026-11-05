import { useEffect, useRef, useState } from 'react';
import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react';
import { Events } from '@wailsio/runtime';
import SelectControl from '../../components/SelectControl';
import { DeleteCommandTask, ListCommandTasks, SaveCommandTask, ExportCommandResults, StartCommandRun, GetCommandRun, ContinueCommandRun, CancelCommandRun, SaveCommandRun, DeleteCommandRun } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { CommandStep, CommandTask, CommandRunItem, CommandRunRecord, CommandRunSummary } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import { errorMessage } from '../../lib/errors';
import { expandSnippet, snippetParameters } from '../../lib/snippets';
import ReadonlyDiffView from '../files/ReadonlyDiffView';
import CommandTargets, { type CommandTarget } from './CommandTargets';
import type { Group } from '../../../bindings/github.com/Sanjeever/termquay/internal/store/models';
import CommandCheckEditor from './CommandCheckEditor';

type Target = CommandTarget;
type Result = CommandRunItem & { key: string };
type TaskDraft = CommandTask & { steps: CommandStep[] };
const emptyTask = (): TaskDraft => ({ id: '', name: '', steps: [{ name: '步骤 1', script: '', timeout_seconds: 60 }], stop_on_failure: true });

export default function CommandTasksDialog({ open, targets, groups: catalogGroups, initialTask = '', runs, historyError, onRun, onRefresh, onClose }: { open: boolean; targets: Target[]; groups?: Group[]; initialTask?: string; runs: CommandRunSummary[]; historyError: string; onRun(value: CommandRunSummary): void; onRefresh(): void; onClose(): void }) {
  const [tasks, setTasks] = useState<CommandTask[]>([]);
  const [task, setTask] = useState<TaskDraft>(emptyTask);
  const [baseline, setBaseline] = useState(() => JSON.stringify(emptyTask()));
  const [selected, setSelected] = useState(new Set<string>());
  const [parameters, setParameters] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Result[]>([]);
  const [error, setError] = useState('');
  const [submitting, setBusy] = useState(false);
  const [runID, setRunID] = useState(runs[0]?.id || '');
  const [record, setRecord] = useState<CommandRunRecord>();
  const summary = runs.find(item => item.id === runID) || (record?.summary.id === runID ? record.summary : undefined);
  const activeRun = !!summary && !summary.finished_at;
  const waitingBatch = summary?.state === '等待确认';
  const busy = submitting || activeRun;
  const [savingHistory, setSavingHistory] = useState(false);
  const [deletingHistory, setDeletingHistory] = useState(false);
  const [loading, setLoading] = useState(true);
  const [discard, setDiscard] = useState<{ task: CommandTask; clearRun: boolean }>();
  const [deleting, setDeleting] = useState(false);
  const [group, setGroup] = useState('target');
  const [comparison, setComparison] = useState<[string, string]>(['', '']);
  const [output, setOutput] = useState<'stdout' | 'stderr'>('stdout');
  const mounted = useRef(true);
  const starting = useRef(false);
  const [loadingRecord, setLoadingRecord] = useState(false);
  const [exportSelection, setExportSelection] = useState(new Set<string>());
  const [baselineTarget, setBaselineTarget] = useState('');
  useEffect(() => { if (open) { const waiting = runs.find(item => item.state === '等待确认'); if (waiting) setRunID(waiting.id); } }, [open]);
  const dirty = JSON.stringify(task) !== baseline;
  const names = [...new Set(task.steps.flatMap(step => snippetParameters(step.check?.kind === 'file' ? step.check.file_path || '' : step.script)))];
  const expanded = task.steps.map(step => { const script = expandSnippet(step.script, parameters); const file = expandSnippet(step.check?.file_path || '', parameters); return { ...step, ...script, error: script.error || file.error, check: step.check ? { ...step.check, file_path: file.text } : undefined }; });
  const invalid = task.steps.some(step => !step.name.trim() || (step.check?.kind === 'file' ? !step.check.file_path?.startsWith('/') : !step.script.trim()) || (step.check && step.check.kind !== 'file' && !step.check.expected) || step.timeout_seconds < 1 || step.timeout_seconds > 600 || !Number.isInteger(step.timeout_seconds)) || !Number.isInteger(task.concurrency || 3) || (task.concurrency || 3) < 1 || (task.concurrency || 3) > 3 || !Number.isInteger(task.batch_size || 64) || (task.batch_size || 64) < 1 || (task.batch_size || 64) > 64;
  const needsBaseline = task.steps.some(step => step.check?.kind === 'file');
  const expansionError = expanded.find(step => step.error || new TextEncoder().encode(step.text).length > 32768);
  function cancel() { CancelCommandRun(runID).catch(e => setError(errorMessage(e))); }
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (!open) return;
    let ended = false;
    setLoading(true);
    const request = ListCommandTasks();
    request.then(values => { if (!ended) setTasks(values || []); }).catch(e => { if (!ended) setError(errorMessage(e)); }).finally(() => { if (!ended) setLoading(false); });
    return () => { ended = true; request.cancel(); };
  }, [open]);
  const finishedAt = summary?.finished_at;
  useEffect(() => {
    if (!open || !initialTask || loading || activeRun) return;
    const value = tasks.find(item => item.id === initialTask);
    if (value) requestChoose(value, true); else setError('任务引用已失效，请编辑操作手册');
  }, [open, initialTask, loading]);
  useEffect(() => {
    setResults([]); setRecord(undefined); setComparison(['', '']); setExportSelection(new Set());
    setLoadingRecord(false);
    if (!runID || !open) return;
    setLoadingRecord(true);
    let ended = false;
    const updates = new Map<string, CommandRunItem>();
    const keyOf = (item: CommandRunItem) => `${item.target.id}:${item.index}`;
    const off = Events.On('command-run:item', event => {
      const value = event.data as { id: string; item: CommandRunItem };
      if (value.id !== runID) return;
      const key = keyOf(value.item);
      updates.set(key, value.item);
      setResults(previous => previous.map(item => item.key === key && item.revision < value.item.revision ? { ...value.item, key } : item));
    });
    const request = GetCommandRun(runID);
    request.then(value => {
      if (ended) return;
      setRecord(value);
      setResults((value.results || []).map(item => { const key = keyOf(item), update = updates.get(key); return { ...(update && update.revision > item.revision ? update : item), key }; }));
      setGroup(value.task.steps?.some(step => step.check) ? 'matrix' : 'target');
    }).catch(e => { if (!ended) setError(errorMessage(e)); }).finally(() => { if (!ended) setLoadingRecord(false); });
    return () => { ended = true; off(); request.cancel(); };
  }, [runID, finishedAt, open]);
  function choose(value: CommandTask) { if (!value.steps?.length) { setError('命令任务缺少步骤'); return; } const draft = { ...value, steps: value.steps }; setTask(draft); setBaseline(JSON.stringify(!value.id && value.name ? emptyTask() : draft)); setParameters({}); setError(''); }
  function requestChoose(value: CommandTask, clearRun = false) { if (dirty) setDiscard({ task: value, clearRun }); else { choose(value); if (clearRun) setRunID(''); } }
  function updateStep(index: number, patch: Partial<CommandStep>) { setTask(previous => ({ ...previous, steps: previous.steps.map((step, i) => i === index ? { ...step, ...patch } : step) })); }
  async function save() {
    setBusy(true); setError('');
    try { const value = await SaveCommandTask(task); if (mounted.current) { setTasks(previous => [...previous.filter(item => item.id !== value.id), value]); choose(value); } }
    catch (e) { if (mounted.current) setError(errorMessage(e)); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function run() {
    if (starting.current || busy || invalid || expansionError || !selected.size) return;
    const chosen = targets.filter(target => selected.has(target.id));
    if (!chosen.length) return;
    if (chosen.length > 64) { setError('每次最多执行 64 个工作区'); return; }
    if (needsBaseline && !targets.some(target => target.id === baselineTarget)) { setError('请选择已连接的基线主机'); return; }
    const steps: CommandStep[] = expanded.map(step => ({ name: step.name, script: step.text, timeout_seconds: step.timeout_seconds, check: step.check }));
    starting.current = true; setBusy(true); setError('');
    try {
      const value = await StartCommandRun({ ...task, steps }, chosen.map(({ id, name, address }) => ({ id, name, address })), baselineTarget);
      onRun(value);
      if (mounted.current) { setRunID(value.id); setRecord(undefined); }
    } catch (e) { if (mounted.current) setError(errorMessage(e)); }
    finally { starting.current = false; if (mounted.current) setBusy(false); }
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
  return <Modal isOpen={open} onClose={() => { if (!submitting) onClose(); }} isDismissable={!submitting} isKeyboardDismissDisabled={submitting} size="5xl" className="app-dialog" scrollBehavior="inside"><ModalContent><ModalHeader>多主机任务与巡检</ModalHeader><ModalBody>
    <label className="form-field">执行记录<SelectControl value={runID} disabled={submitting} onChange={event => { setRunID(event.target.value); setError(''); }}><option value="">新执行</option>{runs.map(item => <option key={item.id} value={item.id}>{item.name} · {new Date(item.started_at).toLocaleString()} · {item.state}{item.saved ? ' · 已保存' : ''}</option>)}</SelectControl></label>
    {historyError && <div className="button-row"><p role="alert" className="error">{historyError}</p><Button size="sm" variant="light" onPress={onRefresh}>重试读取记录</Button></div>}
    {summary && <div className="button-row" role="status"><span>{summary.state} · 已执行 {summary.completed}/{summary.total}</span>{!activeRun && <><Button size="sm" variant="light" isDisabled={!record || submitting} onPress={() => { if (record) requestChoose({ ...record.task, id: '' }, true); }}>载入为新任务</Button><Button size="sm" variant="light" isDisabled={summary.saved || submitting} onPress={() => setSavingHistory(true)}>{summary.saved ? '已加密保存' : '保存加密记录'}</Button><Button size="sm" color="danger" variant="light" isDisabled={submitting} onPress={() => setDeletingHistory(true)}>移除记录</Button></>}</div>}
    {summary?.error && <p role="alert" className="error">{summary.error}</p>}
    {loadingRecord && <p role="status" className="muted">正在读取执行记录…</p>}
    {record && <details><summary>本次执行定义</summary>{record.task.steps?.map((step, index) => <div key={index}><strong>{step.name}</strong><pre className="inspection-command">{step.check?.kind === 'file' ? step.check.file_path : step.script}</pre></div>)}</details>}
    <label className="form-field">任务<SelectControl disabled={busy || loading} value={task.id} onChange={event => requestChoose(tasks.find(item => item.id === event.target.value) || emptyTask())}><option value="">新任务</option>{tasks.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</SelectControl></label>
    <label className="form-field">名称<input disabled={busy} maxLength={128} value={task.name} onChange={event => setTask({ ...task, name: event.target.value })} /></label>
    <div className="button-row"><label className="form-field">并发主机数<input type="number" min={1} max={3} value={task.concurrency || 3} disabled={busy} onChange={event => setTask({ ...task, concurrency: Number(event.target.value) })} /></label><label className="form-field">每批主机数<input type="number" min={1} max={64} value={task.batch_size || ''} placeholder="全部目标" disabled={busy} onChange={event => setTask({ ...task, batch_size: Number(event.target.value) })} /></label><label className="checkbox-label"><input type="checkbox" checked={!!task.first_host_approval} disabled={busy} onChange={event => setTask({ ...task, first_host_approval: event.target.checked })} />首台完成后人工确认</label><label className="checkbox-label"><input type="checkbox" checked={!!task.stop_all_on_failure} disabled={busy} onChange={event => setTask({ ...task, stop_all_on_failure: event.target.checked })} />任一失败停止后续主机与批次</label></div>
    {waitingBatch && <div className="button-row" role="status"><span>首台执行结束，请核对结果</span><Button size="sm" onPress={() => { ContinueCommandRun(runID).catch(e => setError(errorMessage(e))); }}>继续剩余主机</Button><Button size="sm" variant="light" onPress={cancel}>停止后续执行</Button></div>}
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
  </ModalBody><ModalFooter><Button variant="light" isDisabled={submitting} onPress={onClose}>{activeRun ? '收起到后台' : '关闭'}</Button>{task.id && <Button color="danger" variant="light" isDisabled={busy} onPress={() => setDeleting(true)}>删除任务</Button>}<Button variant="light" isDisabled={busy || loading || !task.name.trim() || invalid || !dirty} onPress={() => void save()}>保存任务</Button>{activeRun ? <Button color="danger" variant="light" onPress={cancel}>请求取消</Button> : <Button color="primary" isDisabled={busy || loading || !selected.size || invalid || !!expansionError} onPress={() => void run()}>在 {selected.size} 个工作区执行</Button>}</ModalFooter>
  </ModalContent>
    <Modal isOpen={!!discard} onClose={() => setDiscard(undefined)} className="app-dialog"><ModalContent><ModalHeader>任务尚未保存</ModalHeader><ModalFooter><Button variant="light" onPress={() => setDiscard(undefined)}>返回编辑</Button><Button color="danger" onPress={() => { const next = discard; setDiscard(undefined); if (next) { choose(next.task); if (next.clearRun) setRunID(''); } }}>放弃修改</Button></ModalFooter></ModalContent></Modal>
    <Modal isOpen={savingHistory} onClose={() => !submitting && setSavingHistory(false)} className="app-dialog"><ModalContent><ModalHeader>保存执行记录</ModalHeader><ModalBody><p>展开后的命令、目标地址和输出将加密保存在本机，不进入常规备份。</p>{error && <p role="alert" className="error">{error}</p>}</ModalBody><ModalFooter><Button variant="light" isDisabled={submitting} onPress={() => setSavingHistory(false)}>取消</Button><Button color="primary" isLoading={submitting} onPress={async () => { setBusy(true); setError(''); try { const value = await SaveCommandRun(runID); onRun(value); setSavingHistory(false); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); } }}>加密保存</Button></ModalFooter></ModalContent></Modal>
    <Modal isOpen={deletingHistory} onClose={() => !submitting && setDeletingHistory(false)} className="app-dialog"><ModalContent><ModalHeader>移除执行记录？</ModalHeader><ModalBody><p>{summary?.saved ? '将删除本机加密记录和本次运行中的结果。' : '将丢弃本次运行中的结果。'}</p>{error && <p role="alert" className="error">{error}</p>}</ModalBody><ModalFooter><Button variant="light" isDisabled={submitting} onPress={() => setDeletingHistory(false)}>取消</Button><Button color="danger" isLoading={submitting} onPress={async () => { setBusy(true); setError(''); try { await DeleteCommandRun(runID); setRunID(''); setDeletingHistory(false); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); } }}>移除</Button></ModalFooter></ModalContent></Modal>
    <Modal isOpen={deleting} onClose={() => !busy && setDeleting(false)} className="app-dialog"><ModalContent><ModalHeader>删除任务“{task.name}”？</ModalHeader><ModalFooter><Button variant="light" isDisabled={busy} onPress={() => setDeleting(false)}>取消</Button><Button color="danger" isLoading={busy} onPress={async () => { setBusy(true); try { await DeleteCommandTask(task.id); setTasks(previous => previous.filter(item => item.id !== task.id)); choose(emptyTask()); setDeleting(false); } catch (e) { setError(errorMessage(e)); setDeleting(false); } finally { setBusy(false); } }}>删除</Button></ModalFooter></ModalContent></Modal>
  </Modal>;
}
