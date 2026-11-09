import Modal from '../../components/Modal';
import { statusLabel } from '../../i18n/status';
import { eventError, errorMessage } from '../../lib/errors.ts';
import { t as translate, currentLocale } from '../../i18n/index.ts';
import { message as uiMessage } from '../../i18n/messages.ts';
import { useMessageState } from '../../i18n/useMessageState.ts';
import { useTranslation } from 'react-i18next';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Button, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react';
import { Events } from '@wailsio/runtime';
import SelectControl from '../../components/SelectControl';
import ErrorNotice from '../../components/ErrorNotice';
import { DeleteCommandTask, ListCommandTasks, SaveCommandTask, StartCommandRun, GetCommandRun, ContinueCommandRun, CancelCommandRun, SaveCommandRun, DeleteCommandRun } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { CommandStep, CommandTask, CommandRunItem, CommandRunRecord, CommandRunSummary, Snippet } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import type { Group } from '../../../bindings/github.com/Sanjeever/termquay/internal/store/models';

import { expandSnippet, snippetParameters } from '../../lib/snippets';
import CommandTargets, { type CommandTarget } from './CommandTargets';
import CommandCheckEditor from './CommandCheckEditor';
import CommandRunResults from './CommandRunResults';

const CommandRunComparison = lazy(() => import('./CommandRunComparison'));
type Section = 'execute' | 'inspect' | 'history';
type TaskDraft = CommandTask & { steps: CommandStep[] };
export type CommandTasksRequest = { id: number; section: Section; targets?: string[]; task?: string };
const emptyTask = (inspect = false): TaskDraft => ({ id: '', name: '', steps: [{ name: inspect ? translate('terminal:check1') : translate('terminal:step1'), script: '', timeout_seconds: 60, ...(inspect ? { check: { kind: 'exit', expected: '0' } } : {}) }], stop_on_failure: true });
const isInspection = (task: CommandTask) => !!task.steps?.some(step => step.check);
const checkLabels: Record<string, string> = { get exit() { return translate('terminal:exitCode2'); }, get text() { return translate('terminal:outputContains'); }, get regex() { return translate('terminal:outputMatchesRegex'); }, get json() { return translate('terminal:jSONField'); }, get file() { return translate('terminal:fileMatchesBaseline'); } };
const operatorLabels: Record<string, string> = { get eq() { return translate('terminal:equalTo'); }, get ne() { return translate('terminal:notEqualTo'); }, get gt() { return translate('terminal:greaterThan'); }, get gte() { return translate('terminal:greaterThanOrEqualTo'); }, get lt() { return translate('terminal:lessThan'); }, get lte() { return translate('terminal:lessThanOrEqualTo'); } };
const examples: { id: string; name: string; step: CommandStep }[] = [
  { id: 'uptime', get name() { return translate('terminal:collectHostUptime'); }, step: { get name() { return translate('terminal:hostUptime'); }, script: 'uptime', timeout_seconds: 60, check: { kind: 'exit', expected: '0' } } },
  { id: 'disk', get name() { return translate('terminal:rootFilesystemUsageBelow80'); }, step: { get name() { return translate('terminal:rootFilesystemUsage'); }, script: `df -P / | awk 'NR == 2 { gsub(/%/, "", $5); print "{\\"used_percent\\":" $5 "}" }'`, timeout_seconds: 60, check: { kind: 'json', source: 'stdout', pointer: '/used_percent', operator: 'lt', expected: '80' } } },
  { id: 'service', get name() { return translate('terminal:systemdServiceIsRunning'); }, step: { get name() { return translate('terminal:serviceState'); }, script: 'systemctl is-active -- {{service}}', timeout_seconds: 60, check: { kind: 'text', source: 'stdout', expected: 'active' } } },
];

export default function CommandTasksWorkspace({ open, request, targets, groups, snippets, snippetError, runs, historyError, onConnectTargets, onRun, onRefresh, onNewConnection }: {
  open: boolean; request?: CommandTasksRequest; targets: CommandTarget[]; groups?: Group[]; snippets: Snippet[]; snippetError: string; runs: CommandRunSummary[]; historyError: string;
  onConnectTargets(targets: CommandTarget[]): Promise<{ connected: { before: string; target: CommandTarget }[]; failures: string[] }>;
  onRun(value: CommandRunSummary): void; onRefresh(): void; onNewConnection(): void;
}) {
  useTranslation();
  const [section, setSection] = useState<Section>('execute');
  const [tasks, setTasks] = useState<CommandTask[]>([]);
  const [task, setTask] = useState<TaskDraft>(() => emptyTask());
  const [baseline, setBaseline] = useState(() => JSON.stringify(emptyTask()));
  const [selected, setSelected] = useState(new Set<string>());
  const [parameters, setParameters] = useState<Record<string, string>>({});
  const [baselineTarget, setBaselineTarget] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useMessageState('');
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
  const waiting = summary?.state_code === 'awaiting_confirmation';
  const names = [...new Set(task.steps.flatMap(step => snippetParameters(step.check?.kind === 'file' ? step.check.file_path || '' : step.script)))];
  const expanded = task.steps.map(step => {
    const script = expandSnippet(step.script, parameters), file = expandSnippet(step.check?.file_path || '', parameters);
    return { ...step, script: script.text, error: script.error || file.error, check: step.check ? { ...step.check, file_path: file.text } : undefined };
  });
  const needsBaseline = task.steps.some(step => step.check?.kind === 'file');
  const stepError = task.steps.map((step, index) => {
    const prefix = task.steps.length > 1 ? `${inspecting ? translate('terminal:check') : translate('terminal:step')} ${index + 1}：` : '';
    if (!step.name.trim()) return translate('terminal:enterAName', { value1: prefix });
    if (step.check?.kind === 'file' ? !step.check.file_path?.startsWith('/') : !step.script.trim()) return `${prefix}${step.check?.kind === 'file' ? translate('terminal:enterAnAbsoluteRemoteFilePath') : translate('terminal:enterACommand')}`;
    if (step.check && step.check.kind !== 'file' && !step.check.expected) return translate('terminal:enterTheExpectedValueForThePassCondition', { value1: prefix });
    if (!Number.isInteger(step.timeout_seconds) || step.timeout_seconds < 1 || step.timeout_seconds > 600) return translate('terminal:timeoutMustBeFrom1To600Seconds', { value1: prefix });
    return '';
  }).find(Boolean) || '';
  const strategyError = !Number.isInteger(task.concurrency ?? 3) || (task.concurrency ?? 3) < 1 || (task.concurrency ?? 3) > 3 ? translate('terminal:hostConcurrencyMustBeFrom1To3') : !Number.isInteger(task.batch_size ?? 0) || (task.batch_size ?? 0) < 0 || (task.batch_size ?? 0) > 64 ? translate('terminal:batchSizeMustBeFrom1To64') : '';
  const expansionError = expanded.find(step => step.error || new TextEncoder().encode(step.script).length > 32768);
  const chosen = targets.filter(target => selected.has(target.id));
  const disconnected = chosen.filter(target => target.disconnected);
  const unavailable = chosen.length !== selected.size;
  const invalid = !!stepError || !!strategyError;
  const runReason = loading ? translate('terminal:readingTasks') : !selected.size ? translate('terminal:selectDestinationHosts') : selected.size > 64 ? translate('terminal:selectUpTo64HostsPerRun') : unavailable ? translate('terminal:someSelectedHostsAreNoLongerValidClear') : disconnected.length ? translate('terminal:connectTheSelectedDisconnectedHostsFirst', { value1: disconnected.length }) : stepError || strategyError || expansionError?.error || (expansionError ? translate('terminal:expandedCommandExceeds32KiB') : '') || (needsBaseline && !targets.some(target => target.id === baselineTarget && !target.disconnected) ? translate('terminal:selectAConnectedBaselineHost') : '');

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!open) return;
    let ended = false;
    setLoading(true);
    const pending = ListCommandTasks();
    pending.then(values => { if (!ended) setTasks(values || []); }).catch(e => { if (!ended) setError(e); }).finally(() => { if (!ended) setLoading(false); });
    return () => { ended = true; pending.cancel(); };
  }, [open]);
  useEffect(() => {
    if (!open || loading || !request || handled.current === request.id) return;
    handled.current = request.id;
    if (request.section === 'history') {
      setSection('history'); setError('');
      setRunID((runs.find(item => item.state_code === 'awaiting_confirmation') || runs.find(item => !item.finished_at) || runs[0])?.id || '');
    } else if (request.task) {
      const value = tasks.find(item => item.id === request.task);
      if (value) requestChoose(value, isInspection(value) ? 'inspect' : 'execute', request.targets); else setError(uiMessage('terminal:taskReferenceNoLongerValidEditThePlaybook'));
    } else if (isInspection(task) !== (request.section === 'inspect')) requestChoose(emptyTask(request.section === 'inspect'), request.section, request.targets);
    else { setSection(request.section); if (request.targets) setSelected(new Set(request.targets)); }
  }, [open, loading, request]);
  useEffect(() => {
    if (section === 'history' && !runs.some(item => item.id === runID)) setRunID((runs.find(item => item.state_code === 'awaiting_confirmation') || runs.find(item => !item.finished_at) || runs[0])?.id || '');
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
    }).catch(e => { if (!ended) setError(e); }).finally(() => { if (!ended) setLoadingRecord(false); });
    return () => { ended = true; off(); pending.cancel(); };
  }, [open, section, runID, finishedAt]);

  function choose(value: CommandTask, next: Section, selection?: string[]) {
    if (!value.steps?.length) { setError(uiMessage('terminal:taskHasNoSteps')); return; }
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
    if (values.length > 64) { setError(uiMessage('terminal:connectUpTo64HostsAtATime')); return; }
    setSubmitting(true); setError(''); setConnectionFailures([]);
    try {
      const value = await onConnectTargets(values);
      if (mounted.current) { setSelected(previous => { const next = new Set(previous); for (const item of value.connected) { next.delete(item.before); next.add(item.target.id); } return next; }); setConnectionFailures(value.failures); }
    } catch (e) { if (mounted.current) setError(e); }
    finally { if (mounted.current) setSubmitting(false); }
  }
  async function saveTask() {
    if (submitting || invalid || !taskName.trim()) return;
    setSubmitting(true); setError('');
    try { const value = await SaveCommandTask({ ...task, name: taskName.trim() }); if (mounted.current && value.steps?.length) { setTasks(previous => [...previous.filter(item => item.id !== value.id), value]); setTask({ ...value, steps: value.steps }); setBaseline(JSON.stringify(value)); setSavingTask(false); } }
    catch (e) { if (mounted.current) setError(e); }
    finally { if (mounted.current) setSubmitting(false); }
  }
  async function run() {
    if (starting.current || submitting || runReason) return;
    starting.current = true; setSubmitting(true); setError('');
    try {
      const value = await StartCommandRun({ ...task, name: task.name || translate('terminal:temporaryRun'), steps: expanded.map(step => ({ name: step.name, script: step.script, timeout_seconds: step.timeout_seconds, check: step.check })) }, chosen.map(({ id, name, address, connection }) => ({ id, name, address, connection_id: connection?.id })), baselineTarget);
      onRun(value);
      if (mounted.current) { setRunID(value.id); setSection('history'); }
    } catch (e) { if (mounted.current) setError(e); }
    finally { starting.current = false; if (mounted.current) setSubmitting(false); }
  }
  async function controlRun(continueRun = false) {
    if (submitting) return;
    setSubmitting(true); setError('');
    try { if (continueRun) await ContinueCommandRun(runID); else await CancelCommandRun(runID); }
    catch (e) { setError(e); }
    finally { setSubmitting(false); }
  }
  function prepareAgain(failedOnly = false) {
    if (!record) return;
    const selection: string[] = [], missing: string[] = [];
    if (failedOnly) {
      const failed = new Map(results.filter(item => ['failed', 'nonzero_exit', 'check_failed', 'indeterminate', 'cancel_requested'].includes(item.state_code)).map(item => [item.target.id, item.target]));
      for (const old of failed.values()) {
        const candidates = targets.filter(target => target.address === old.address && (!old.connection_id || target.connection?.id === old.connection_id));
        if (candidates.length === 1) selection.push(candidates[0].id); else missing.push(old.name);
      }
      if (missing.length) { setError(uiMessage('terminal:cannotUniquelyMatchTheOriginalDestinationReviewConnection', { value1: missing.join('、') })); return; }
      if (!selection.length) { setError(uiMessage('terminal:noFailedHostsAvailableToRerun')); return; }
    }
    requestChoose({ ...record.task, id: '' }, isInspection(record.task) ? 'inspect' : 'execute', selection);
  }

  return <div className="command-tasks-workspace" aria-label={translate('terminal:multiHostOperations')}>
    <header className="command-workspace-header"><h1>{translate('terminal:multiHostOperations')}</h1><nav className="command-workspace-sections" aria-label={translate('terminal:multiHostOperationsView')}>{([['execute', translate('terminal:executeCommands')], ['inspect', translate('terminal:inspect')], ['history', translate('terminal:runHistory')]] as const).map(([value, label]) => <button key={value} aria-current={section === value ? 'page' : undefined} disabled={submitting} onClick={() => switchSection(value)}>{label}{value === 'history' && runs.some(item => !item.finished_at) && <span>{runs.filter(item => !item.finished_at).length}</span>}</button>)}</nav></header>
    <ErrorNotice message={error || (section === 'execute' ? snippetError : '')} onDismiss={error ? () => setError('') : undefined} />
    {section === 'history' ? <div className="command-history-layout">
      <aside className="command-history-list" aria-label={translate('terminal:runHistory')}><ErrorNotice message={historyError}><button className="session-tool" onClick={onRefresh}>{translate('terminal:retryReading')}</button></ErrorNotice>{runs.map(item => <button key={item.id} disabled={submitting} className={`command-history-item ${item.id === runID ? 'selected' : ''}`} aria-pressed={item.id === runID} onClick={() => { setRunID(item.id); setError(''); }}><strong>{item.name}</strong><span>{statusLabel(item.state_code, item.state)} · {item.completed}/{item.total}</span><small>{new Date(item.started_at).toLocaleString(currentLocale())}{item.saved ? translate('terminal:saved') : ''}</small></button>)}{!runs.length && !historyError && <div className="command-history-empty"><p className="muted">{translate('terminal:noRunHistory')}</p><Button size="sm" variant="bordered" onPress={() => switchSection('execute')}>{translate('terminal:executeCommands')}</Button></div>}</aside>
      <section className="command-run-view" aria-label={translate('terminal:currentRun')}>
        {summary && <><div className="command-run-heading"><div><h2>{summary.name}</h2><span className="muted">{statusLabel(summary.state_code, summary.state)} {translate('terminal:completed')}{summary.completed}/{summary.total} {translate('terminal:items')}</span></div><div className="button-row">{activeRun ? <Button size="sm" color="danger" variant="light" isLoading={submitting} onPress={() => void controlRun()}>{translate('terminal:requestCancellation')}</Button> : <><Button size="sm" variant="bordered" isDisabled={!record || submitting} onPress={() => prepareAgain()}>{translate('terminal:runAgain')}</Button><Button size="sm" variant="light" isDisabled={summary.saved || submitting || loadingRecord} onPress={() => setSavingHistory(true)}>{summary.saved ? translate('terminal:savedEncrypted') : translate('terminal:saveRecord')}</Button><Button size="sm" color="danger" variant="light" isDisabled={submitting} onPress={() => setDeletingHistory(true)}>{translate('terminal:remove')}</Button></>}</div></div><progress className="command-run-progress" value={summary.completed} max={summary.total || 1} aria-label={translate('terminal:executionProgress')} /><ErrorNotice message={errorMessage(eventError(summary)) || ''} />{waiting && <div className="command-run-approval" role="status"><strong>{translate('terminal:firstHostFinishedReviewItsResults')}</strong><div className="button-row"><Button size="sm" color="primary" isLoading={submitting} onPress={() => void controlRun(true)}>{translate('terminal:continueRemainingHosts')}</Button><Button size="sm" variant="light" isDisabled={submitting} onPress={() => void controlRun()}>{translate('terminal:stopFurtherExecution')}</Button></div></div>}</>}
        {loadingRecord && <p className="muted" role="status">{translate('terminal:readingExecutionResults')}</p>}
        {record && <>
          <details className="command-run-definition"><summary>{translate('terminal:currentRun2')}{new Set(results.map(item => item.target.id)).size} {translate('terminal:hosts2')}{record.task.steps?.length || 0} {translate('terminal:steps')}</summary>{record.task.steps?.map((step, index) => <div key={index}><strong>{step.name}</strong><pre className="command-output">{step.check?.kind === 'file' ? step.check.file_path : step.script}</pre>{step.check && <p className="muted">{translate('terminal:passCondition2')}{checkLabels[step.check.kind]}{step.check.pointer && ` ${step.check.pointer}`} {operatorLabels[step.check.operator || '']} {step.check.expected}</p>}</div>)}</details>
          <CommandRunResults key={record.summary.id} results={results} steps={record.task.steps || []} inspecting={isInspection(record.task)} finished={!activeRun} />
          {!activeRun && <div className="command-history-tools"><Button size="sm" variant="light" isDisabled={submitting} onPress={() => prepareAgain(true)}>{translate('terminal:prepareRerunOnFailedHostsAllSteps')}</Button><Button size="sm" variant="light" aria-expanded={comparingRuns} onPress={() => setComparingRuns(!comparingRuns)}>{translate('terminal:compareWithAnotherRun2')}</Button></div>}
          {comparingRuns && <Suspense fallback={<p role="status">{translate('terminal:loadingRunComparison')}</p>}><CommandRunComparison key={record.summary.id} current={{ ...record, results }} runs={runs} /></Suspense>}
        </>}
      </section>
    </div> : <>
      <div className="command-editor-layout">
        <aside className="command-targets-pane" aria-label={translate('terminal:destinationHosts')}><div className="command-pane-heading"><h2>{translate('terminal:destinationHosts')}</h2><span className="muted">{translate('terminal:selected')}{selected.size} {translate('terminal:hosts')}</span></div><CommandTargets targets={targets} groups={groups} selected={selected} onChange={setSelected} onConnect={target => void connectTargets([target])} busy={submitting} />{!targets.length && <Button size="sm" variant="bordered" onPress={onNewConnection}>{translate('terminal:newSSHConnection')}</Button>}{!!disconnected.length && <Button size="sm" variant="bordered" isLoading={submitting} onPress={() => void connectTargets()}>{translate('terminal:connectSelected')}{disconnected.length} {translate('terminal:disconnectedHosts')}</Button>}{connectionFailures.map((message, index) => <p className="error" role="alert" key={index}>{message}</p>)}</aside>
        <section className="command-editor" aria-label={inspecting ? translate('terminal:inspectionContents') : translate('terminal:commandContents')}>
          <div className="command-editor-toolbar"><SelectControl aria-label={translate('terminal:savedTasks')} value={task.id} disabled={submitting || loading} onChange={event => { const value = tasks.find(item => item.id === event.target.value); requestChoose(value || emptyTask(inspecting), section); }}><option value="">{inspecting ? translate('terminal:newInspection') : translate('terminal:temporaryRun')}</option>{tasks.filter(value => isInspection(value) === inspecting).map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</SelectControl>{task.id && <><span className="muted">{dirty ? translate('terminal:unsavedChanges') : translate('terminal:savedTask')}</span><Button size="sm" color="danger" variant="light" isDisabled={submitting} onPress={() => setDeletingTask(true)}>{translate('terminal:deleteTask')}</Button></>}{inspecting ? <SelectControl aria-label={translate('terminal:useReadOnlyInspectionExamples')} value="" disabled={submitting} onChange={event => { const example = examples.find(item => item.id === event.target.value); if (example) requestChoose({ ...emptyTask(true), name: example.step.name, steps: [{ ...example.step, check: { ...example.step.check! } }] }, 'inspect'); }}><option value="">{translate('terminal:linuxReadOnlyExamples')}</option>{examples.map(example => <option key={example.id} value={example.id}>{example.name}</option>)}</SelectControl> : !!snippets.length && <SelectControl aria-label={translate('terminal:useCommandSnippet')} value="" disabled={submitting} onChange={event => { const snippet = snippets.find(item => item.id === event.target.value); if (snippet) requestChoose({ ...emptyTask(), steps: [{ name: snippet.name, script: snippet.body, timeout_seconds: 60 }] }, 'execute'); }}><option value="">{translate('terminal:useCommandSnippet2')}</option>{snippets.map(snippet => <option key={snippet.id} value={snippet.id}>{snippet.name}</option>)}</SelectControl>}</div>
          {task.steps.map((step, index) => <fieldset className="command-step" key={index} disabled={submitting}>{(task.steps.length > 1 || inspecting) && <div className="command-step-heading"><label className="form-field">{inspecting ? translate('terminal:checkName') : translate('terminal:step2', { value1: index + 1 })}<input aria-label={translate('terminal:name2', { value1: inspecting ? translate('terminal:check') : translate('terminal:step'), value2: index + 1 })} maxLength={128} value={step.name} onChange={event => updateStep(index, { name: event.target.value })} /></label><div className="button-row">{task.steps.length > 1 && <><button className="session-tool" disabled={index === 0} onClick={() => setTask(previous => { const steps = [...previous.steps]; [steps[index - 1], steps[index]] = [steps[index], steps[index - 1]]; return { ...previous, steps }; })}>{translate('terminal:moveUp')}</button><button className="session-tool" onClick={() => setTask(previous => ({ ...previous, steps: previous.steps.filter((_, i) => i !== index) }))}>{translate('terminal:remove')}</button></>}</div></div>}{step.check?.kind !== 'file' && <label className="form-field">{inspecting ? translate('terminal:collectionCommand') : translate('terminal:command')}<textarea className="command-source command-script" aria-label={translate('terminal:command2', { value1: inspecting ? translate('terminal:check') : translate('terminal:step'), value2: index + 1 })} rows={task.steps.length === 1 ? 7 : 4} placeholder={inspecting ? translate('terminal:enterACommandThatCollectsTheCheckResult') : translate('terminal:enterCommandsToExecuteOnSelectedHosts')} value={step.script} maxLength={32768} spellCheck={false} onChange={event => updateStep(index, { script: event.target.value })} /></label>}{inspecting && <CommandCheckEditor check={step.check} onChange={check => updateStep(index, { check, ...(check?.kind === 'file' ? { script: '' } : {}) })} />}<details className="command-step-options"><summary>{translate('terminal:stepSettingsTimeout')}{step.timeout_seconds} {translate('terminal:seconds')}</summary><label className="form-field">{translate('terminal:timeoutSeconds')}<input type="number" min={1} max={600} value={step.timeout_seconds} onChange={event => updateStep(index, { timeout_seconds: Number(event.target.value) })} /></label></details></fieldset>)}
          <Button className="command-add-step" size="sm" variant="light" isDisabled={submitting || task.steps.length >= 16} onPress={() => setTask(previous => ({ ...previous, steps: [...previous.steps, { name: `${inspecting ? translate('terminal:check') : translate('terminal:step')} ${previous.steps.length + 1}`, script: '', timeout_seconds: 60, ...(inspecting ? { check: { kind: 'exit', expected: '0' } } : {}) }] }))}>{translate('terminal:add')}{inspecting ? translate('terminal:check') : translate('terminal:step')}</Button>
          {!!names.length && <section className="command-parameters" aria-label={translate('terminal:executionParameters')}><h3>{translate('terminal:executionParameters')}</h3>{names.map(name => <label className="form-field" key={name}>{name}<input maxLength={4096} value={parameters[name] || ''} disabled={submitting} onChange={event => setParameters(previous => ({ ...previous, [name]: event.target.value }))} /></label>)}<details open><summary>{translate('terminal:executionPreview')}</summary>{expanded.map((step, index) => <pre className="command-output" key={index}>{step.check?.kind === 'file' ? step.check.file_path : step.script}</pre>)}</details></section>}
          {needsBaseline && <label className="form-field">{translate('terminal:baselineHost')}<SelectControl value={baselineTarget} disabled={submitting} onChange={event => setBaselineTarget(event.target.value)}><option value="">{translate('terminal:selectAConnectedSSHHost')}</option>{targets.filter(target => !target.disconnected).map(target => <option key={target.id} value={target.id}>{target.name} · {target.address}</option>)}</SelectControl></label>}
          <details className="command-execution-options"><summary>{translate('terminal:executionSettings')}</summary><div className="command-strategy-fields"><label className="form-field">{translate('terminal:hostConcurrency')}<input type="number" min={1} max={3} value={task.concurrency ?? 3} disabled={submitting} onChange={event => setTask(previous => ({ ...previous, concurrency: Number(event.target.value) }))} /></label><label className="form-field">{translate('terminal:hostsPerBatch')}<input type="number" min={1} max={64} value={task.batch_size || ''} placeholder={translate('terminal:allDestinations')} disabled={submitting} onChange={event => setTask(previous => ({ ...previous, batch_size: Number(event.target.value) }))} /></label></div><label className="checkbox-label"><input type="checkbox" checked={!!task.first_host_approval} disabled={submitting} onChange={event => setTask(previous => ({ ...previous, first_host_approval: event.target.checked }))} />{translate('terminal:confirmAfterTheFirstHostFinishesBeforeRunning')}</label><label className="checkbox-label"><input type="checkbox" checked={!!task.stop_all_on_failure} disabled={submitting} onChange={event => setTask(previous => ({ ...previous, stop_all_on_failure: event.target.checked }))} />{translate('terminal:stopSchedulingFurtherHostsIfAnyHostFails')}</label><label className="checkbox-label"><input type="checkbox" checked={task.stop_on_failure} disabled={submitting} onChange={event => setTask(previous => ({ ...previous, stop_on_failure: event.target.checked }))} />{translate('terminal:stopSubsequentStepsOnAHostAfterFailure')}</label>{task.steps.length > 1 && <p className="muted">{translate('terminal:eachStepUsesASeparateShellDirectoriesAnd')}</p>}</details>
        </section>
      </div>
      <footer className="command-editor-footer"><span className="muted" role="status">{runReason || translate('terminal:selectedHosts', { value1: selected.size, value2: task.steps.length, value3: inspecting ? translate('terminal:check') : translate('terminal:step') })}</span><div className="button-row"><Button size="sm" variant="bordered" isDisabled={submitting || loading || invalid || !!task.id && !dirty} onPress={() => { setTaskName(task.name); setSavingTask(true); }}>{task.id ? translate('terminal:saveChanges') : translate('terminal:saveAsTask')}</Button><Button size="sm" color="primary" isLoading={submitting} isDisabled={!!runReason || submitting} onPress={() => void run()}>{inspecting ? translate('terminal:inspectHosts', { value1: selected.size }) : translate('terminal:executeOnHosts', { value1: selected.size })}</Button></div></footer>
    </>}
    <Modal isOpen={!!discard && open} onClose={() => setDiscard(undefined)} className="app-dialog"><ModalContent><ModalHeader>{translate('terminal:currentContentsHaveNotBeenSaved')}</ModalHeader><ModalBody><p>{translate('terminal:replacingDiscardsCurrentEdits')}</p></ModalBody><ModalFooter><Button variant="light" onPress={() => setDiscard(undefined)}>{translate('terminal:backToEditing')}</Button><Button color="danger" onPress={() => { const value = discard; setDiscard(undefined); if (value) choose(value.task, value.section, value.selection); }}>{translate('terminal:discardChangesAndContinue')}</Button></ModalFooter></ModalContent></Modal>
    <Modal isOpen={savingTask && open} onClose={() => !submitting && setSavingTask(false)} className="app-dialog command-save-dialog" isDismissable={!submitting}><ModalContent><ModalHeader>{task.id ? translate('terminal:saveTaskChanges') : translate('terminal:saveAsTask2')}</ModalHeader><ModalBody><label className="form-field">{translate('terminal:taskName')}<input autoFocus maxLength={128} value={taskName} disabled={submitting} onChange={event => setTaskName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); void saveTask(); } }} /></label><ErrorNotice message={error} /></ModalBody><ModalFooter><Button variant="light" isDisabled={submitting} onPress={() => setSavingTask(false)}>{translate('terminal:cancel')}</Button><Button color="primary" isLoading={submitting} isDisabled={!taskName.trim() || invalid} onPress={() => void saveTask()}>{translate('terminal:save')}</Button></ModalFooter></ModalContent></Modal>
    <Modal isOpen={deletingTask && open} onClose={() => !submitting && setDeletingTask(false)} className="app-dialog"><ModalContent><ModalHeader>{translate('terminal:deleteTask2')}{task.name}”？</ModalHeader><ModalBody><ErrorNotice message={error} /></ModalBody><ModalFooter><Button variant="light" isDisabled={submitting} onPress={() => setDeletingTask(false)}>{translate('terminal:cancel')}</Button><Button color="danger" isLoading={submitting} onPress={async () => { setSubmitting(true); setError(''); try { await DeleteCommandTask(task.id); setTasks(previous => previous.filter(item => item.id !== task.id)); choose(emptyTask(inspecting), section); setDeletingTask(false); } catch (e) { setError(e); } finally { setSubmitting(false); } }}>{translate('terminal:delete')}</Button></ModalFooter></ModalContent></Modal>
    <Modal isOpen={savingHistory && open} onClose={() => !submitting && setSavingHistory(false)} className="app-dialog"><ModalContent><ModalHeader>{translate('terminal:saveExecutionRecord')}</ModalHeader><ModalBody><p>{translate('terminal:expandedCommandsDestinationAddressesAndOutputAreEncrypted')}</p><ErrorNotice message={error} /></ModalBody><ModalFooter><Button variant="light" isDisabled={submitting} onPress={() => setSavingHistory(false)}>{translate('terminal:cancel')}</Button><Button color="primary" isLoading={submitting} onPress={async () => { setSubmitting(true); setError(''); try { onRun(await SaveCommandRun(runID)); setSavingHistory(false); } catch (e) { setError(e); } finally { setSubmitting(false); } }}>{translate('terminal:saveEncrypted')}</Button></ModalFooter></ModalContent></Modal>
    <Modal isOpen={deletingHistory && open} onClose={() => !submitting && setDeletingHistory(false)} className="app-dialog"><ModalContent><ModalHeader>{translate('terminal:removeExecutionRecord')}</ModalHeader><ModalBody><p>{summary?.saved ? translate('terminal:thisDeletesTheLocalEncryptedRecordAndCurrent') : translate('terminal:thisDiscardsCurrentRunResults')}</p><ErrorNotice message={error} /></ModalBody><ModalFooter><Button variant="light" isDisabled={submitting} onPress={() => setDeletingHistory(false)}>{translate('terminal:cancel')}</Button><Button color="danger" isLoading={submitting} onPress={async () => { setSubmitting(true); setError(''); try { await DeleteCommandRun(runID); setRunID(''); setDeletingHistory(false); } catch (e) { setError(e); } finally { setSubmitting(false); } }}>{translate('terminal:remove')}</Button></ModalFooter></ModalContent></Modal>
  </div>;
}
