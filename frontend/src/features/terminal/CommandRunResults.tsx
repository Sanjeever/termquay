import { lazy, Suspense, useMemo, useState } from 'react';
import { Button } from '@heroui/react';
import { ExportCommandResults } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { CommandRunItem, CommandStep } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import SelectControl from '../../components/SelectControl';
import { errorMessage } from '../../lib/errors';

const ReadonlyDiffView = lazy(() => import('../files/ReadonlyDiffView'));
const keyOf = (item: CommandRunItem) => `${item.target.id}:${item.index}`;
const failed = (item: CommandRunItem) => !!(item.error || item.result?.error || (item.check ? item.check.state === 'fail' || item.check.state === 'unknown' : item.result && item.result.exit_code !== 0));

export default function CommandRunResults({ results, steps, inspecting, finished }: { results: CommandRunItem[]; steps: CommandStep[]; inspecting: boolean; finished: boolean }) {
  const [view, setView] = useState(inspecting ? 'matrix' : 'target');
  const [selected, setSelected] = useState('');
  const [exports, setExports] = useState(new Set<string>());
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [comparing, setComparing] = useState(false);
  const [comparison, setComparison] = useState<[string, string]>(['', '']);
  const [channel, setChannel] = useState<'stdout' | 'stderr'>('stdout');
  const targets = useMemo(() => [...new Map(results.map(item => [item.target.id, item.target])).values()], [results]);
  const byKey = useMemo(() => new Map(results.map(item => [keyOf(item), item])), [results]);
  const groups = useMemo(() => {
    const values = new Map<string, CommandRunItem[]>();
    if (view === 'matrix') return values;
    for (const item of results) {
      const key = view === 'exit' ? item.result ? `退出码 ${item.result.exit_code}` : item.state : view === 'output' ? JSON.stringify([item.result?.exit_code, item.result?.stdout, item.result?.stderr, item.error, item.result?.error, item.result?.truncated]) : item.target.id;
      const items = values.get(key);
      if (items) items.push(item); else values.set(key, [item]);
    }
    return values;
  }, [results, view]);
  const current = byKey.get(selected);
  const comparable = results.filter(item => item.result);
  const left = byKey.get(comparison[0]), right = byKey.get(comparison[1]);
  function toggleExport(item: CommandRunItem, checked: boolean) {
    setExports(previous => { const next = new Set(previous); if (checked) next.add(keyOf(item)); else next.delete(keyOf(item)); return next; });
  }
  async function exportResults() {
    setExporting(true); setError('');
    try { await ExportCommandResults(results.filter(item => exports.has(keyOf(item))).map(item => ({ target: item.target.name, address: item.target.address, step: item.step, state: item.state, result: item.result, check: item.check, baseline: item.baseline, error: item.error || '' }))); }
    catch (e) { setError(errorMessage(e)); }
    finally { setExporting(false); }
  }
  return <section className="command-run-results" aria-label="执行结果">
    <div className="command-results-toolbar"><SelectControl aria-label="结果分组" value={view} onChange={event => setView(event.target.value)}>{inspecting && <option value="matrix">巡检总览</option>}<option value="target">按主机</option><option value="exit">按退出码</option><option value="output">按相同输出</option></SelectControl><div className="status-spacer" />{comparable.length > 1 && <Button size="sm" variant="light" aria-pressed={comparing} onPress={() => setComparing(!comparing)}>对比输出</Button>}<Button size="sm" variant="light" isDisabled={!finished} aria-expanded={exportOpen} onPress={() => setExportOpen(!exportOpen)}>导出结果…</Button></div>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="command-results-layout">
      <div className="command-results-table">
        {view === 'matrix' ? <table><thead><tr><th>主机</th>{steps.map((step, index) => <th key={index}>{step.name}</th>)}</tr></thead><tbody>{targets.map(target => <tr key={target.id}><th scope="row">{target.name}</th>{steps.map((_, index) => { const item = byKey.get(`${target.id}:${index}`); return <td key={index}>{item && <button className={`inspection-cell ${failed(item) ? 'error' : ''}`} aria-pressed={selected === keyOf(item)} onClick={() => setSelected(keyOf(item))}>{item.state}</button>}</td>; })}</tr>)}</tbody></table> : [...groups.entries()].map(([key, items], index) => <section className="command-result-group" key={key}><h3>{view === 'target' ? items[0].target.name : view === 'output' ? `输出组 ${index + 1}` : key}<span className="muted">{items.length} 项</span></h3><table><thead><tr>{view !== 'target' && <th>主机</th>}<th>步骤</th><th>状态</th><th>耗时</th></tr></thead><tbody>{items.map(item => <tr key={keyOf(item)} className={selected === keyOf(item) ? 'selected' : ''}>{view !== 'target' && <td>{item.target.name}</td>}<td><button className="command-result-select" onClick={() => setSelected(keyOf(item))}>{item.step}</button></td><td><button className={`command-result-select ${failed(item) ? 'error' : ''}`} onClick={() => setSelected(keyOf(item))}>{item.state}{item.result && !inspecting && ` · ${item.result.exit_code < 0 ? '退出状态未知' : item.result.exit_code}`}</button></td><td>{item.result ? `${(item.result.duration_ms / 1000).toFixed(2)}s` : '—'}</td></tr>)}</tbody></table></section>)}
      </div>
      <aside className="command-result-detail" aria-label="结果详情">
        {current ? <><div className="command-result-heading"><strong>{current.target.name} · {current.step}</strong><span className={failed(current) ? 'error' : 'muted'}>{current.state}</span></div>{current.check && <div className="inspection-verdict"><p>{current.check.message}</p>{current.check.actual !== undefined && <div><span className="muted">实际值</span><pre>{current.check.actual}</pre></div>}{current.check.expected !== undefined && <div><span className="muted">预期值</span><pre>{current.check.expected}</pre></div>}</div>}{current.baseline && <p className="muted">基线 {current.baseline}</p>}{(current.error || current.result?.error) && <p className="error" role="alert">{current.error || current.result?.error}</p>}{current.result ? <><h4>标准输出</h4><pre className="command-output">{current.result.stdout || '（无输出）'}</pre>{current.result.stderr && <><h4>错误输出</h4><pre className="command-output">{current.result.stderr}</pre></>}{current.result.truncated && <p className="error">输出已截断</p>}</> : !current.check && <p className="muted">尚无输出</p>}</> : <p className="command-result-placeholder muted">选择一项结果查看详情</p>}
      </aside>
    </div>
    {exportOpen && <div className="command-export"><div className="button-row"><label className="checkbox-label"><input type="checkbox" checked={!!results.length && exports.size === results.length} onChange={event => setExports(event.target.checked ? new Set(results.map(keyOf)) : new Set())} />全部结果</label><Button size="sm" variant="bordered" isDisabled={!exports.size || exporting} isLoading={exporting} onPress={() => void exportResults()}>导出所选 {exports.size} 项</Button></div><div className="command-export-items">{results.map(item => <label className="checkbox-label" key={keyOf(item)}><input type="checkbox" checked={exports.has(keyOf(item))} onChange={event => toggleExport(item, event.target.checked)} />{item.target.name} · {item.step} · {item.state}</label>)}</div></div>}
    {comparing && <div className="command-output-comparison"><div className="file-compare-sides">{comparison.map((value, index) => <label className="form-field" key={index}>{index ? '右侧结果' : '左侧结果'}<SelectControl value={value} onChange={event => setComparison(previous => previous.map((key, i) => index === i ? event.target.value : key) as [string, string])}><option value="">选择结果</option>{comparable.map(item => <option key={keyOf(item)} value={keyOf(item)}>{item.target.name} · {item.step}</option>)}</SelectControl></label>)}</div><SelectControl aria-label="对比输出通道" value={channel} onChange={event => setChannel(event.target.value as 'stdout' | 'stderr')}><option value="stdout">标准输出</option><option value="stderr">错误输出</option></SelectControl>{left && right && <Suspense fallback={<p role="status">正在载入输出对比…</p>}><ReadonlyDiffView left={left.result?.[channel]} right={right.result?.[channel]} leftLabel="左侧执行结果" rightLabel="右侧执行结果" /></Suspense>}</div>}
  </section>;
}
