import { statusLabel } from '../../i18n/status';
import { eventError, errorMessage } from '../../lib/errors.ts';
import { t as translate, currentLocale } from '../../i18n/index.ts';
import { useMessageState } from '../../i18n/useMessageState.ts';
import { useTranslation } from 'react-i18next';
import { lazy, Suspense, useMemo, useState } from 'react';
import { Button } from '@heroui/react';
import { ExportCommandResults } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { CommandRunItem, CommandStep } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import SelectControl from '../../components/SelectControl';


const ReadonlyDiffView = lazy(() => import('../files/ReadonlyDiffView'));
const keyOf = (item: CommandRunItem) => `${item.target.id}:${item.index}`;
const failed = (item: CommandRunItem) => !!(item.error || item.result?.error || (item.check ? item.check.state === 'fail' || item.check.state === 'unknown' : item.result && item.result.exit_code !== 0));

export default function CommandRunResults({ results, steps, inspecting, finished }: { results: CommandRunItem[]; steps: CommandStep[]; inspecting: boolean; finished: boolean }) {
  useTranslation();
  const [view, setView] = useState(inspecting ? 'matrix' : 'target');
  const [selected, setSelected] = useState('');
  const [exports, setExports] = useState(new Set<string>());
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useMessageState('');
  const [comparing, setComparing] = useState(false);
  const [comparison, setComparison] = useState<[string, string]>(['', '']);
  const [channel, setChannel] = useState<'stdout' | 'stderr'>('stdout');
  const targets = useMemo(() => [...new Map(results.map(item => [item.target.id, item.target])).values()], [results]);
  const byKey = useMemo(() => new Map(results.map(item => [keyOf(item), item])), [results]);
  const groups = useMemo(() => {
    const values = new Map<string, CommandRunItem[]>();
    if (view === 'matrix') return values;
    for (const item of results) {
      const key = view === 'exit' ? item.result ? translate('terminal:exitCode', { value1: item.result.exit_code }) : statusLabel(item.state_code, item.state) : view === 'output' ? JSON.stringify([item.result?.exit_code, item.result?.stdout, item.result?.stderr, item.error, item.result?.error, item.result?.truncated]) : item.target.id;
      const items = values.get(key);
      if (items) items.push(item); else values.set(key, [item]);
    }
    return values;
  }, [results, view, currentLocale()]);
  const current = byKey.get(selected);
  const comparable = results.filter(item => item.result);
  const left = byKey.get(comparison[0]), right = byKey.get(comparison[1]);
  function toggleExport(item: CommandRunItem, checked: boolean) {
    setExports(previous => { const next = new Set(previous); if (checked) next.add(keyOf(item)); else next.delete(keyOf(item)); return next; });
  }
  async function exportResults() {
    setExporting(true); setError('');
    try { await ExportCommandResults(results.filter(item => exports.has(keyOf(item))).map(item => ({ target: item.target.name, address: item.target.address, step: item.step, state: item.state, result: item.result, check: item.check, baseline: item.baseline, error: item.error || '' }))); }
    catch (e) { setError(e); }
    finally { setExporting(false); }
  }
  return <section className="command-run-results" aria-label={translate('terminal:executionResults')}>
    <div className="command-results-toolbar"><SelectControl aria-label={translate('terminal:resultGrouping')} value={view} onChange={event => setView(event.target.value)}>{inspecting && <option value="matrix">{translate('terminal:inspectionOverview')}</option>}<option value="target">{translate('terminal:byHost')}</option><option value="exit">{translate('terminal:byExitCode')}</option><option value="output">{translate('terminal:byIdenticalOutput')}</option></SelectControl><div className="status-spacer" />{comparable.length > 1 && <Button size="sm" variant="light" aria-pressed={comparing} onPress={() => setComparing(!comparing)}>{translate('terminal:compareOutput')}</Button>}<Button size="sm" variant="light" isDisabled={!finished} aria-expanded={exportOpen} onPress={() => setExportOpen(!exportOpen)}>{translate('terminal:exportResults')}</Button></div>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="command-results-layout">
      <div className="command-results-table">
        {view === 'matrix' ? <table><thead><tr><th>{translate('terminal:host')}</th>{steps.map((step, index) => <th key={index}>{step.name}</th>)}</tr></thead><tbody>{targets.map(target => <tr key={target.id}><th scope="row">{target.name}</th>{steps.map((_, index) => { const item = byKey.get(`${target.id}:${index}`); return <td key={index}>{item && <button className={`inspection-cell ${failed(item) ? 'error' : ''}`} aria-pressed={selected === keyOf(item)} onClick={() => setSelected(keyOf(item))}>{statusLabel(item.state_code, item.state)}</button>}</td>; })}</tr>)}</tbody></table> : [...groups.entries()].map(([key, items], index) => <section className="command-result-group" key={key}><h3>{view === 'target' ? items[0].target.name : view === 'output' ? translate('terminal:outputGroup', { value1: index + 1 }) : key}<span className="muted">{items.length} {translate('terminal:items')}</span></h3><table><thead><tr>{view !== 'target' && <th>{translate('terminal:host')}</th>}<th>{translate('terminal:step')}</th><th>{translate('terminal:state')}</th><th>{translate('terminal:duration')}</th></tr></thead><tbody>{items.map(item => <tr key={keyOf(item)} className={selected === keyOf(item) ? 'selected' : ''}>{view !== 'target' && <td>{item.target.name}</td>}<td><button className="command-result-select" onClick={() => setSelected(keyOf(item))}>{item.step}</button></td><td><button className={`command-result-select ${failed(item) ? 'error' : ''}`} onClick={() => setSelected(keyOf(item))}>{statusLabel(item.state_code, item.state)}{item.result && !inspecting && ` · ${item.result.exit_code < 0 ? translate('terminal:unknownExitStatus') : item.result.exit_code}`}</button></td><td>{item.result ? `${(item.result.duration_ms / 1000).toFixed(2)}s` : '—'}</td></tr>)}</tbody></table></section>)}
      </div>
      <aside className="command-result-detail" aria-label={translate('terminal:resultDetails')}>
        {current ? <><div className="command-result-heading"><strong>{current.target.name} · {current.step}</strong><span className={failed(current) ? 'error' : 'muted'}>{statusLabel(current.state_code, current.state)}</span></div>{current.check && <div className="inspection-verdict"><p>{errorMessage(current.check.message_detail || current.check.message)}</p>{current.check.actual !== undefined && <div><span className="muted">{translate('terminal:actualValue')}</span><pre>{current.check.actual}</pre></div>}{current.check.expected !== undefined && <div><span className="muted">{translate('terminal:expectedValue')}</span><pre>{errorMessage({ message: current.check.expected, messageCode: current.check.expected_code })}</pre></div>}</div>}{current.baseline && <p className="muted">{translate('terminal:baseline')}{current.baseline}</p>}{(errorMessage(eventError(current)) || errorMessage(eventError(current.result))) && <p className="error" role="alert">{errorMessage(eventError(current)) || errorMessage(eventError(current.result))}</p>}{current.result ? <><h4>{translate('terminal:standardOutput')}</h4><pre className="command-output">{current.result.stdout || translate('terminal:noOutput')}</pre>{current.result.stderr && <><h4>{translate('terminal:standardError')}</h4><pre className="command-output">{current.result.stderr}</pre></>}{current.result.truncated && <p className="error">{translate('terminal:outputTruncated')}</p>}</> : !current.check && <p className="muted">{translate('terminal:noOutputYet')}</p>}</> : <p className="command-result-placeholder muted">{translate('terminal:selectAResultToViewDetails')}</p>}
      </aside>
    </div>
    {exportOpen && <div className="command-export"><div className="button-row"><label className="checkbox-label"><input type="checkbox" checked={!!results.length && exports.size === results.length} onChange={event => setExports(event.target.checked ? new Set(results.map(keyOf)) : new Set())} />{translate('terminal:allResults')}</label><Button size="sm" variant="bordered" isDisabled={!exports.size || exporting} isLoading={exporting} onPress={() => void exportResults()}>{translate('terminal:exportSelected')}{exports.size} {translate('terminal:items')}</Button></div><div className="command-export-items">{results.map(item => <label className="checkbox-label" key={keyOf(item)}><input type="checkbox" checked={exports.has(keyOf(item))} onChange={event => toggleExport(item, event.target.checked)} />{item.target.name} · {item.step} · {statusLabel(item.state_code, item.state)}</label>)}</div></div>}
    {comparing && <div className="command-output-comparison"><div className="file-compare-sides">{comparison.map((value, index) => <label className="form-field" key={index}>{index ? translate('terminal:rightResult') : translate('terminal:leftResult')}<SelectControl value={value} onChange={event => setComparison(previous => previous.map((key, i) => index === i ? event.target.value : key) as [string, string])}><option value="">{translate('terminal:selectResult')}</option>{comparable.map(item => <option key={keyOf(item)} value={keyOf(item)}>{item.target.name} · {item.step}</option>)}</SelectControl></label>)}</div><SelectControl aria-label={translate('terminal:outputComparisonChannel')} value={channel} onChange={event => setChannel(event.target.value as 'stdout' | 'stderr')}><option value="stdout">{translate('terminal:standardOutput')}</option><option value="stderr">{translate('terminal:standardError')}</option></SelectControl>{left && right && <Suspense fallback={<p role="status">{translate('terminal:loadingOutputComparison')}</p>}><ReadonlyDiffView left={left.result?.[channel]} right={right.result?.[channel]} leftLabel={translate('terminal:leftExecutionResult')} rightLabel={translate('terminal:rightExecutionResult')} /></Suspense>}</div>}
  </section>;
}
