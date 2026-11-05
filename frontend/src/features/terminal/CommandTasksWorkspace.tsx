import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react';
import { Events } from '@wailsio/runtime';
import SelectControl from '../../components/SelectControl';
import ErrorNotice from '../../components/ErrorNotice';
import { DeleteCommandTask, ListCommandTasks, SaveCommandTask, StartCommandRun, GetCommandRun, ContinueCommandRun, CancelCommandRun, SaveCommandRun, DeleteCommandRun } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { CommandStep, CommandTask, CommandRunItem, CommandRunRecord, CommandRunSummary, Snippet } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import type { Group } from '../../../bindings/github.com/Sanjeever/termquay/internal/store/models';
import { errorMessage } from '../../lib/errors';
import { expandSnippet, snippetParameters } from '../../lib/snippets';
import CommandTargets, { type CommandTarget } from './CommandTargets';
import CommandCheckEditor from './CommandCheckEditor';
import CommandRunResults from './CommandRunResults';

const CommandRunComparison = lazy(() => import('./CommandRunComparison'));
type Section = 'execute' | 'inspect' | 'history';
type TaskDraft = CommandTask & { steps: CommandStep[] };
export type CommandTasksRequest = { id: number; section: Section; targets?: string[]; task?: string };
const emptyTask = (inspect = false): TaskDraft => ({ id: '', name: '', steps: [{ name: inspect ? '检查项 1' : '步骤 1', script: '', timeout_seconds: 60, ...(inspect ? { check: { kind: 'exit', expected: '0' } } : {}) }], stop_on_failure: true });
const isInspection = (task: CommandTask) => !!task.steps?.some(step => step.check);
const checkLabels: Record<string, string> = { exit: '退出码', text: '输出包含', regex: '输出匹配正则', json: 'JSON 字段', file: '文件与基线一致' };
const operatorLabels: Record<string, string> = { eq: '等于', ne: '不等于', gt: '大于', gte: '大于等于', lt: '小于', lte: '小于等于' };
const examples: { id: string; name: string; step: CommandStep }[] = [
  { id: 'uptime', name: '采集主机运行时间', step: { name: '主机运行时间', script: 'uptime', timeout_seconds: 60, check: { kind: 'exit', expected: '0' } } },
  { id: 'disk', name: '根分区使用率低于 80%', step: { name: '根分区使用率', script: `df -P / | awk 'NR == 2 { gsub(/%/, "", $5); print "{\\"used_percent\\":" $5 "}" }'`, timeout_seconds: 60, check: { kind: 'json', source: 'stdout', pointer: '/used_percent', operator: 'lt', expected: '80' } } },
  { id: 'service', name: 'systemd 服务正在运行', step: { name: '服务状态', script: 'systemctl is-active -- {{service}}', timeout_seconds: 60, check: { kind: 'text', source: 'stdout', expected: 'active' } } },
];

export default function CommandTasksWorkspace({ open, request, targets, groups, snippets, snippetError, runs, historyError, onConnectTargets, onRun, onRefresh, onNewConnection }: {
  open: boolean; request?: CommandTasksRequest; targets: CommandTarget[]; groups?: Group[]; snippets: Snippet[]; snippetError: string; runs: CommandRunSummary[]; historyError: string;
  onConnectTargets(targets: CommandTarget[]): Promise<{ connected: { before: string; target: CommandTarget }[]; failures: string[] }>;
  onRun(value: CommandRunSummary): void; onRefresh(): void; onNewConnection(): void;
}) {
  const [section, setSection] = useState<Section>('execute');
  const [tasks, setTasks] = useState<CommandTask[]>([]);
  const [task, setTask] = useState<TaskDraft>(() => emptyTask());
  const [baseline, setBaseline] = useState(() => JSON.stringify(emptyTask()));
  const [selected, setSelected] = useState(new Set<string>());
  const [parameters, setParameters] = useState<Record<string, string>>({});
  const [baselineTarget, setBaselineTarget] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [connectionFailures, setConnectionFailures] = useState<string[]>([]);
  const [discard, setDiscard] = useState<{ task: CommandTask; section: Section; selection?: string[] }>();
  const [savingTask, setSavingTask] = useState(false);
  const [taskName, setTaskName] = useState('');
  const [deletingTask, setDeletingTask] = useState(false);
  const [runID, setRunID] = useState('');
  const [record, setRecord] = useState<CommandRunRecord>();
  const [results, setResults] = useState<CommandRunItem[]>([]);
  const [loadingRecord, setLoadingRecord] = useState(false);
  const [savingHistory, setSavingHistory] = useState(false);
  const [deletingHistory, setDeletingHistory] = useState(false);
  const [comparingRuns, setComparingRuns] = useState(false);
  const handled = useRef(0);
  const starting = useRef(false);
  const mounted = useRef(true);
  const dirty = JSON.stringify(task) !== baseline;
  const inspecting = section === 'inspect';
  const summary = runs.find(item => item.id === runID) || (record?.summary.id === runID ? record.summary : undefined);
  const activeRun = !!summary && !summary.finished_at;
  const waiting = summary?.state === '等待确认';
  const names = [...new Set(task.steps.flatMap(step => snippetParameters(step.check?.kind === 'file' ? step.check.file_path || '' : step.script)))];
  const expanded = task.steps.map(step => {
    const script = expandSnippet(step.script, parameters), file = expandSnippet(step.check?.file_path || '', parameters);
    return { ...step, script: script.text, error: script.error || file.error, check: step.check ? { ...step.check, file_path: file.text } : undefined };
  });
  const needsBaseline = task.steps.some(step => step.check?.kind === 'file');
  const stepError = task.steps.map((step, index) => {
    const prefix = task.steps.length > 1 ? `${inspecting ? '检查项' : '步骤'} ${index + 1}：` : '';
    if (!step.name.trim()) return `${prefix}请填写名称`;
    if (step.check?.kind === 'file' ? !step.check.file_path?.startsWith('/') : !step.script.trim()) return `${prefix}${step.check?.kind === 'file' ? '请填写远端文件的绝对路径' : '请填写命令'}`;
    if (step.check && step.check.kind !== 'file' && !step.check.expected) return `${prefix}请填写通过条件的预期值`;
    if (!Number.isInteger(step.timeout_seconds) || step.timeout_seconds < 1 || step.timeout_seconds > 600) return `${prefix}超时须为 1 至 600 秒`;
    return '';
  }).find(Boolean) || '';
  const strategyError = !Number.isInteger(task.concurrency ?? 3) || (task.concurrency ?? 3) < 1 || (task.concurrency ?? 3) > 3 ? '并发主机数须为 1 至 3' : !Number.isInteger(task.batch_size ?? 0) || (task.batch_size ?? 0) < 0 || (task.batch_size ?? 0) > 64 ? '每批主机数须为 1 至 64，留空表示全部目标' : '';
  const expansionError = expanded.find(step => step.error || new TextEncoder().encode(step.script).length > 32768);
  const chosen = targets.filter(target => selected.has(target.id));
  const disconnected = chosen.filter(target => target.disconnected);
  const unavailable = chosen.length !== selected.size;
  const invalid = !!stepError || !!strategyError;
  const runReason = loading ? '正在读取任务…' : !selected.size ? '请选择目标主机' : selected.size > 64 ? '每次最多选择 64 台主机' : unavailable ? '部分所选主机已失效，请清空并重新选择' : disconnected.length ? `先连接所选 ${disconnected.length} 台未连接主机` : stepError || strategyError || expansionError?.error || (expansionError ? '替换后命令超过 32 KiB' : '') || (needsBaseline && !targets.some(target => target.id === baselineTarget && !target.disconnected) ? '请选择已连接的基线主机' : '');

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!open) return;
    let ended = false;
    setLoading(true);
    const pending = ListCommandTasks();
    pending.then(values => { if (!ended) setTasks(values || []); }).catch(e => { if (!ended) setError(errorMessage(e)); }).finally(() => { if (!ended) setLoading(false); });
    return () => { ended = true; pending.cancel(); };
  }, [open]);
  useEffect(() => {
    if (!open || loading || !request || handled.current === request.id) return;
    handled.current = request.id;
    if (request.section === 'history') {
      setSection('history'); setError('');
      setRunID((runs.find(item => item.state === '等待确认') || runs.find(item => !item.finished_at) || runs[0])?.id || '');
    } else if (request.task) {
      const value = tasks.find(item => item.id === request.task);
      if (value) requestChoose(value, isInspection(value) ? 'inspect' : 'execute', request.targets); else setError('任务引用已失效，请编辑操作手册');
    } else if (isInspection(task) !== (request.section === 'inspect')) requestChoose(emptyTask(request.section === 'inspect'), request.section, request.targets);
    else { setSection(request.section); if (request.targets) setSelected(new Set(request.targets)); }
  }, [open, loading, request]);
  useEffect(() => {
    if (section === 'history' && !runs.some(item => item.id === runID)) setRunID((runs.find(item => item.state === '等待确认') || runs.find(item => !item.finished_at) || runs[0])?.id || '');
  }, [runs, section, runID]);
  const finishedAt = summary?.finished_at;
  useEffect(() => {
    setRecord(previous => open && section === 'history' && previous?.summary.id === runID ? previous : undefined);
    setResults(previous => open && section === 'history' && record?.summary.id === runID ? previous : []);
    setLoadingRecord(false);
    if (!open || section !== 'history' || !runID) return;
    let ended = false;
    setLoadingRecord(true);
    const updates = new Map<string, CommandRunItem>();
    const keyOf = (item: CommandRunItem) => `${item.target.id}:${item.index}`;
    const off = Events.On('command-run:item', event => {
      const value = event.data as { id: string; item: CommandRunItem };
      if (ended || value.id !== runID) return;
      const key = keyOf(value.item); updates.set(key, value.item);
      setResults(previous => previous.map(item => keyOf(item) === key && item.revision < value.item.revision ? value.item : item));
    });
    const pending = GetCommandRun(runID);
    pending.then(value => {
      if (ended) return;
      setRecord(value);
      setResults((value.results || []).map(item => { const update = updates.get(keyOf(item)); return update && update.revision > item.revision ? update : item; }));
    }).catch(e => { if (!ended) setError(errorMessage(e)); }).finally(() => { if (!ended) setLoadingRecord(false); });
    return () => { ended = true; off(); pending.cancel(); };
  }, [open, section, runID, finishedAt]);

  function choose(value: CommandTask, next: Section, selection?: string[]) {
    if (!value.steps?.length) { setError('任务缺少步骤'); return; }
    const draft = { ...value, steps: value.steps };
    setTask(draft); setBaseline(JSON.stringify(value.id || !value.name ? draft : emptyTask(next === 'inspect')));
    setParameters({}); setBaselineTarget(''); setConnectionFailures([]); setError(''); setSection(next);
    if (selection) setSelected(new Set(selection));
  }
  function requestChoose(value: CommandTask, next: Section, selection?: string[]) {
    if (dirty) setDiscard({ task: value, section: next, selection }); else choose(value, next, selection);
  }
  function switchSection(next: Section) {
    if (submitting) return;
    setError('');
    if (next === 'history') { setSection(next); return; }
    if (isInspection(task) !== (next === 'inspect')) requestChoose(emptyTask(next === 'inspect'), next); else setSection(next);
  }
  function updateStep(index: number, patch: Partial<CommandStep>) {
    setTask(previous => ({ ...previous, steps: previous.steps.map((step, i) => i === index ? { ...step, ...patch } : step) }));
  }
  async function connectTargets(values = disconnected) {
    if (submitting || !values.length) return;
    if (values.length > 64) { setError('每次最多连接 64 台主机'); return; }
    setSubmitting(true); setError(''); setConnectionFailures([]);
    try {
      const value = await onConnectTargets(values);
      if (mounted.current) { setSelected(previous => { const next = new Set(previous); for (const item of value.connected) { next.delete(item.before); next.add(item.target.id); } return next; }); setConnectionFailures(value.failures); }
    } catch (e) { if (mounted.current) setError(errorMessage(e)); }
    finally { if (mounted.current) setSubmitting(false); }
  }
  async function saveTask() {
    if (submitting || invalid || !taskName.trim()) return;
    setSubmitting(true); setError('');
    try { const value = await SaveCommandTask({ ...task, name: taskName.trim() }); if (mounted.current && value.steps?.length) { setTasks(previous => [...previous.filter(item => item.id !== value.id), value]); setTask({ ...value, steps: value.steps }); setBaseline(JSON.stringify(value)); setSavingTask(false); } }
    catch (e) { if (mounted.current) setError(errorMessage(e)); }
    finally { if (mounted.current) setSubmitting(false); }
  }
  async function run() {
    if (starting.current || submitting || runReason) return;
    starting.current = true; setSubmitting(true); setError('');
    try {
      const value = await StartCommandRun({ ...task, steps: expanded.map(step => ({ name: step.name, script: step.script, timeout_seconds: step.timeout_seconds, check: step.check })) }, chosen.map(({ id, name, address, connection }) => ({ id, name, address, connection_id: connection?.id })), baselineTarget);
      onRun(value);
      if (mounted.current) { setRunID(value.id); setSection('history'); }
    } catch (e) { if (mounted.current) setError(errorMessage(e)); }
    finally { starting.current = false; if (mounted.current) setSubmitting(false); }
  }
  async function controlRun(continueRun = false) {
    if (submitting) return;
    setSubmitting(true); setError('');
    try { if (continueRun) await ContinueCommandRun(runID); else await CancelCommandRun(runID); }
    catch (e) { setError(errorMessage(e)); }
    finally { setSubmitting(false); }
  }
  function prepareAgain(failedOnly = false) {
    if (!record) return;
    const selection: string[] = [], missing: string[] = [];
    if (failedOnly) {
      const failed = new Map(results.filter(item => ['失败', '非零退出', '不通过', '无法判定', '已请求取消'].includes(item.state)).map(item => [item.target.id, item.target]));
      for (const old of failed.values()) {
        const candidates = targets.filter(target => target.address === old.address && (!old.connection_id || target.connection?.id === old.connection_id));
        if (candidates.length === 1) selection.push(candidates[0].id); else missing.push(old.name);
      }
      if (missing.length) { setError(`无法唯一匹配原目标，请核对连接配置：${missing.join('、')}`); return; }
      if (!selection.length) { setError('没有可重跑的失败主机'); return; }
    }
    requestChoose({ ...record.task, id: '' }, isInspection(record.task) ? 'inspect' : 'execute', selection);
  }

  return <div className="command-tasks-workspace" aria-label="多主机操作">
    <header className="command-workspace-header"><h1>多主机操作</h1><nav className="command-workspace-sections" aria-label="多主机操作视图">{([['execute', '执行命令'], ['inspect', '巡检'], ['history', '执行记录']] as const).map(([value, label]) => <button key={value} aria-current={section === value ? 'page' : undefined} disabled={submitting} onClick={() => switchSection(value)}>{label}{value === 'history' && runs.some(item => !item.finished_at) && <span>{runs.filter(item => !item.finished_at).length}</span>}</button>)}</nav></header>
    <ErrorNotice message={error || (section === 'execute' ? snippetError : '')} onDismiss={error ? () => setError('') : undefined} />
    {section === 'history' ? <div className="command-history-layout">
      <aside className="command-history-list" aria-label="执行记录"><ErrorNotice message={historyError}><button className="session-tool" onClick={onRefresh}>重试读取</button></ErrorNotice>{runs.map(item => <button key={item.id} disabled={submitting} className={`command-history-item ${item.id === runID ? 'selected' : ''}`} aria-pressed={item.id === runID} onClick={() => { setRunID(item.id); setError(''); }}><strong>{item.name}</strong><span>{item.state} · {item.completed}/{item.total}</span><small>{new Date(item.started_at).toLocaleString()}{item.saved ? ' · 已保存' : ''}</small></button>)}{!runs.length && !historyError && <div className="command-history-empty"><p className="muted">暂无执行记录</p><Button size="sm" variant="bordered" onPress={() => switchSection('execute')}>执行命令</Button></div>}</aside>
      <section className="command-run-view" aria-label="本次执行">
        {summary && <><div className="command-run-heading"><div><h2>{summary.name}</h2><span className="muted">{summary.state} · 已完成 {summary.completed}/{summary.total} 项</span></div><div className="button-row">{activeRun ? <Button size="sm" color="danger" variant="light" isLoading={submitting} onPress={() => void controlRun()}>请求取消</Button> : <><Button size="sm" variant="bordered" isDisabled={!record || submitting} onPress={() => prepareAgain()}>再次执行…</Button><Button size="sm" variant="light" isDisabled={summary.saved || submitting || loadingRecord} onPress={() => setSavingHistory(true)}>{summary.saved ? '已加密保存' : '保存记录…'}</Button><Button size="sm" color="danger" variant="light" isDisabled={submitting} onPress={() => setDeletingHistory(true)}>移除</Button></>}</div></div><progress className="command-run-progress" value={summary.completed} max={summary.total || 1} aria-label="执行进度" /><ErrorNotice message={summary.error || ''} />{waiting && <div className="command-run-approval" role="status"><strong>首台执行结束，请核对结果</strong><div className="button-row"><Button size="sm" color="primary" isLoading={submitting} onPress={() => void controlRun(true)}>继续剩余主机</Button><Button size="sm" variant="light" isDisabled={submitting} onPress={() => void controlRun()}>停止后续执行</Button></div></div>}</>}
        {loadingRecord && <p className="muted" role="status">正在读取执行结果…</p>}
        {record && <>
          <details className="command-run-definition"><summary>本次执行内容 · {new Set(results.map(item => item.target.id)).size} 台主机 · {record.task.steps?.length || 0} 个步骤</summary>{record.task.steps?.map((step, index) => <div key={index}><strong>{step.name}</strong><pre className="command-output">{step.check?.kind === 'file' ? step.check.file_path : step.script}</pre>{step.check && <p className="muted">通过条件：{checkLabels[step.check.kind]}{step.check.pointer && ` ${step.check.pointer}`} {operatorLabels[step.check.operator || '']} {step.check.expected}</p>}</div>)}</details>
          <CommandRunResults key={record.summary.id} results={results} steps={record.task.steps || []} inspecting={isInspection(record.task)} finished={!activeRun} />
          {!activeRun && <div className="command-history-tools"><Button size="sm" variant="light" isDisabled={submitting} onPress={() => prepareAgain(true)}>准备失败主机重跑（全部步骤）…</Button><Button size="sm" variant="light" aria-expanded={comparingRuns} onPress={() => setComparingRuns(!comparingRuns)}>比较其他执行记录…</Button></div>}
          {comparingRuns && <Suspense fallback={<p role="status">正在载入记录对比…</p>}><CommandRunComparison key={record.summary.id} current={{ ...record, results }} runs={runs} /></Suspense>}
        </>}
      </section>
    </div> : <>
      <div className="command-editor-layout">
        <aside className="command-targets-pane" aria-label="目标主机"><div className="command-pane-heading"><h2>目标主机</h2><span className="muted">已选 {selected.size} 台</span></div><CommandTargets targets={targets} groups={groups} selected={selected} onChange={setSelected} onConnect={target => void connectTargets([target])} busy={submitting} />{!targets.length && <Button size="sm" variant="bordered" onPress={onNewConnection}>新建 SSH 连接…</Button>}{!!disconnected.length && <Button size="sm" variant="bordered" isLoading={submitting} onPress={() => void connectTargets()}>连接所选 {disconnected.length} 台未连接主机</Button>}{connectionFailures.map((message, index) => <p className="error" role="alert" key={index}>{message}</p>)}</aside>
        <section className="command-editor" aria-label={inspecting ? '巡检内容' : '命令内容'}>
          <div className="command-editor-toolbar"><SelectControl aria-label="保存的任务" value={task.id} disabled={submitting || loading} onChange={event => { const value = tasks.find(item => item.id === event.target.value); requestChoose(value || emptyTask(inspecting), section); }}><option value="">{inspecting ? '新建巡检' : '临时执行'}</option>{tasks.filter(value => isInspection(value) === inspecting).map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</SelectControl>{task.id && <><span className="muted">{dirty ? '有未保存修改' : '已保存任务'}</span><Button size="sm" color="danger" variant="light" isDisabled={submitting} onPress={() => setDeletingTask(true)}>删除任务</Button></>}{inspecting ? <SelectControl aria-label="使用只读巡检示例" value="" disabled={submitting} onChange={event => { const example = examples.find(item => item.id === event.target.value); if (example) requestChoose({ ...emptyTask(true), name: example.step.name, steps: [{ ...example.step, check: { ...example.step.check! } }] }, 'inspect'); }}><option value="">Linux 只读示例…</option>{examples.map(example => <option key={example.id} value={example.id}>{example.name}</option>)}</SelectControl> : !!snippets.length && <SelectControl aria-label="使用命令片段" value="" disabled={submitting} onChange={event => { const snippet = snippets.find(item => item.id === event.target.value); if (snippet) requestChoose({ ...emptyTask(), steps: [{ name: snippet.name, script: snippet.body, timeout_seconds: 60 }] }, 'execute'); }}><option value="">使用命令片段…</option>{snippets.map(snippet => <option key={snippet.id} value={snippet.id}>{snippet.name}</option>)}</SelectControl>}</div>
          {task.steps.map((step, index) => <fieldset className="command-step" key={index} disabled={submitting}>{(task.steps.length > 1 || inspecting) && <div className="command-step-heading"><label className="form-field">{inspecting ? '检查项名称' : `步骤 ${index + 1}`}<input aria-label={`${inspecting ? '检查项' : '步骤'} ${index + 1} 名称`} maxLength={128} value={step.name} onChange={event => updateStep(index, { name: event.target.value })} /></label><div className="button-row">{task.steps.length > 1 && <><button className="session-tool" disabled={index === 0} onClick={() => setTask(previous => { const steps = [...previous.steps]; [steps[index - 1], steps[index]] = [steps[index], steps[index - 1]]; return { ...previous, steps }; })}>上移</button><button className="session-tool" onClick={() => setTask(previous => ({ ...previous, steps: previous.steps.filter((_, i) => i !== index) }))}>移除</button></>}</div></div>}{step.check?.kind !== 'file' && <label className="form-field">{inspecting ? '采集命令' : '命令'}<textarea className="command-source command-script" aria-label={`${inspecting ? '检查项' : '步骤'} ${index + 1} 命令`} rows={task.steps.length === 1 ? 7 : 4} placeholder={inspecting ? '填写获取检查结果的命令' : '输入要在所选主机执行的命令'} value={step.script} maxLength={32768} spellCheck={false} onChange={event => updateStep(index, { script: event.target.value })} /></label>}{inspecting && <CommandCheckEditor check={step.check} onChange={check => updateStep(index, { check, ...(check?.kind === 'file' ? { script: '' } : {}) })} />}<details className="command-step-options"><summary>步骤设置 · 超时 {step.timeout_seconds} 秒</summary><label className="form-field">超时（秒）<input type="number" min={1} max={600} value={step.timeout_seconds} onChange={event => updateStep(index, { timeout_seconds: Number(event.target.value) })} /></label></details></fieldset>)}
          <Button className="command-add-step" size="sm" variant="light" isDisabled={submitting || task.steps.length >= 16} onPress={() => setTask(previous => ({ ...previous, steps: [...previous.steps, { name: `${inspecting ? '检查项' : '步骤'} ${previous.steps.length + 1}`, script: '', timeout_seconds: 60, ...(inspecting ? { check: { kind: 'exit', expected: '0' } } : {}) }] }))}>＋ 添加{inspecting ? '检查项' : '步骤'}</Button>
          {!!names.length && <section className="command-parameters" aria-label="执行参数"><h3>执行参数</h3>{names.map(name => <label className="form-field" key={name}>{name}<input maxLength={4096} value={parameters[name] || ''} disabled={submitting} onChange={event => setParameters(previous => ({ ...previous, [name]: event.target.value }))} /></label>)}<details open><summary>执行预览</summary>{expanded.map((step, index) => <pre className="command-output" key={index}>{step.check?.kind === 'file' ? step.check.file_path : step.script}</pre>)}</details></section>}
          {needsBaseline && <label className="form-field">基线主机<SelectControl value={baselineTarget} disabled={submitting} onChange={event => setBaselineTarget(event.target.value)}><option value="">选择已连接的 SSH 主机</option>{targets.filter(target => !target.disconnected).map(target => <option key={target.id} value={target.id}>{target.name} · {target.address}</option>)}</SelectControl></label>}
          <details className="command-execution-options"><summary>执行设置</summary><div className="command-strategy-fields"><label className="form-field">并发主机数<input type="number" min={1} max={3} value={task.concurrency ?? 3} disabled={submitting} onChange={event => setTask(previous => ({ ...previous, concurrency: Number(event.target.value) }))} /></label><label className="form-field">每批主机数<input type="number" min={1} max={64} value={task.batch_size || ''} placeholder="全部目标" disabled={submitting} onChange={event => setTask(previous => ({ ...previous, batch_size: Number(event.target.value) }))} /></label></div><label className="checkbox-label"><input type="checkbox" checked={!!task.first_host_approval} disabled={submitting} onChange={event => setTask(previous => ({ ...previous, first_host_approval: event.target.checked }))} />首台完成后确认，再执行其余主机</label><label className="checkbox-label"><input type="checkbox" checked={!!task.stop_all_on_failure} disabled={submitting} onChange={event => setTask(previous => ({ ...previous, stop_all_on_failure: event.target.checked }))} />任一主机失败，停止调度后续主机</label><label className="checkbox-label"><input type="checkbox" checked={task.stop_on_failure} disabled={submitting} onChange={event => setTask(previous => ({ ...previous, stop_on_failure: event.target.checked }))} />失败后停止该主机的后续步骤</label>{task.steps.length > 1 && <p className="muted">每步使用独立 Shell，目录和变量不跨步骤继承。</p>}</details>
        </section>
      </div>
      <footer className="command-editor-footer"><span className="muted" role="status">{runReason || `已选择 ${selected.size} 台主机 · ${task.steps.length} 个${inspecting ? '检查项' : '步骤'}`}</span><div className="button-row"><Button size="sm" variant="bordered" isDisabled={submitting || loading || invalid || !!task.id && !dirty} onPress={() => { setTaskName(task.name); setSavingTask(true); }}>{task.id ? '保存修改…' : '保存为任务…'}</Button><Button size="sm" color="primary" isLoading={submitting} isDisabled={!!runReason || submitting} onPress={() => void run()}>{inspecting ? `在 ${selected.size} 台主机巡检` : `在 ${selected.size} 台主机执行`}</Button></div></footer>
    </>}
    <Modal isOpen={!!discard && open} onClose={() => setDiscard(undefined)} className="app-dialog"><ModalContent><ModalHeader>当前内容尚未保存</ModalHeader><ModalBody><p>替换后将丢弃当前编辑内容。</p></ModalBody><ModalFooter><Button variant="light" onPress={() => setDiscard(undefined)}>返回编辑</Button><Button color="danger" onPress={() => { const value = discard; setDiscard(undefined); if (value) choose(value.task, value.section, value.selection); }}>放弃修改并继续</Button></ModalFooter></ModalContent></Modal>
    <Modal isOpen={savingTask && open} onClose={() => !submitting && setSavingTask(false)} className="app-dialog command-save-dialog" isDismissable={!submitting}><ModalContent><ModalHeader>{task.id ? '保存任务修改' : '保存为任务'}</ModalHeader><ModalBody><label className="form-field">任务名称<input autoFocus maxLength={128} value={taskName} disabled={submitting} onChange={event => setTaskName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); void saveTask(); } }} /></label><ErrorNotice message={error} /></ModalBody><ModalFooter><Button variant="light" isDisabled={submitting} onPress={() => setSavingTask(false)}>取消</Button><Button color="primary" isLoading={submitting} isDisabled={!taskName.trim() || invalid} onPress={() => void saveTask()}>保存</Button></ModalFooter></ModalContent></Modal>
    <Modal isOpen={deletingTask && open} onClose={() => !submitting && setDeletingTask(false)} className="app-dialog"><ModalContent><ModalHeader>删除任务“{task.name}”？</ModalHeader><ModalBody><ErrorNotice message={error} /></ModalBody><ModalFooter><Button variant="light" isDisabled={submitting} onPress={() => setDeletingTask(false)}>取消</Button><Button color="danger" isLoading={submitting} onPress={async () => { setSubmitting(true); setError(''); try { await DeleteCommandTask(task.id); setTasks(previous => previous.filter(item => item.id !== task.id)); choose(emptyTask(inspecting), section); setDeletingTask(false); } catch (e) { setError(errorMessage(e)); } finally { setSubmitting(false); } }}>删除</Button></ModalFooter></ModalContent></Modal>
    <Modal isOpen={savingHistory && open} onClose={() => !submitting && setSavingHistory(false)} className="app-dialog"><ModalContent><ModalHeader>保存执行记录</ModalHeader><ModalBody><p>展开后的命令、目标地址和输出将加密保存在本机，不进入常规备份。</p><ErrorNotice message={error} /></ModalBody><ModalFooter><Button variant="light" isDisabled={submitting} onPress={() => setSavingHistory(false)}>取消</Button><Button color="primary" isLoading={submitting} onPress={async () => { setSubmitting(true); setError(''); try { onRun(await SaveCommandRun(runID)); setSavingHistory(false); } catch (e) { setError(errorMessage(e)); } finally { setSubmitting(false); } }}>加密保存</Button></ModalFooter></ModalContent></Modal>
    <Modal isOpen={deletingHistory && open} onClose={() => !submitting && setDeletingHistory(false)} className="app-dialog"><ModalContent><ModalHeader>移除执行记录？</ModalHeader><ModalBody><p>{summary?.saved ? '将删除本机加密记录和本次运行中的结果。' : '将丢弃本次运行中的结果。'}</p><ErrorNotice message={error} /></ModalBody><ModalFooter><Button variant="light" isDisabled={submitting} onPress={() => setDeletingHistory(false)}>取消</Button><Button color="danger" isLoading={submitting} onPress={async () => { setSubmitting(true); setError(''); try { await DeleteCommandRun(runID); setRunID(''); setDeletingHistory(false); } catch (e) { setError(errorMessage(e)); } finally { setSubmitting(false); } }}>移除</Button></ModalFooter></ModalContent></Modal>
  </div>;
}
