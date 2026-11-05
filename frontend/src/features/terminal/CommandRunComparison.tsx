import { useEffect, useState } from 'react';
import { GetCommandRun } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { CommandRunItem, CommandRunRecord, CommandRunSummary } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import SelectControl from '../../components/SelectControl';
import { errorMessage } from '../../lib/errors';
import ReadonlyDiffView from '../files/ReadonlyDiffView';

function key(item: CommandRunItem) { return JSON.stringify([item.target.address, item.target.identity || item.target.id, item.index]); }
function value(item?: CommandRunItem) { return item ? JSON.stringify([item.state, item.error, item.result?.exit_code, item.result?.error, item.result?.truncated, item.result?.stdout, item.result?.stderr, item.check, item.baseline]) : ''; }
export default function CommandRunComparison({ current, runs }: { current: CommandRunRecord; runs: CommandRunSummary[] }) {
  const [id, setID] = useState('');
  const [previous, setPrevious] = useState<CommandRunRecord>();
  const [error, setError] = useState('');
  const [selected, setSelected] = useState('');
  const [channel, setChannel] = useState<'stdout' | 'stderr'>('stdout');
  useEffect(() => {
    setPrevious(undefined); setError(''); setSelected('');
    if (!id) return;
    let ended = false; const request = GetCommandRun(id);
    request.then(record => { if (!ended) setPrevious(record); }).catch(e => { if (!ended) setError(errorMessage(e)); });
    return () => { ended = true; request.cancel(); };
  }, [id, current.summary.id]);
  const before = new Map((previous?.results || []).map(item => [key(item), item]));
  const after = new Map((current.results || []).map(item => [key(item), item]));
  const keys = [...new Set([...before.keys(), ...after.keys()])];
  const changes = keys.filter(key => value(before.get(key)) !== value(after.get(key)));
  const oldItem = before.get(selected), newItem = after.get(selected);
  return <section className="inspection-detail">
    <label className="form-field">与另一次执行比较<SelectControl value={id} onChange={event => setID(event.target.value)}><option value="">选择已结束记录</option>{runs.filter(run => run.id !== current.summary.id && run.finished_at).map(run => <option key={run.id} value={run.id}>{run.name} · {new Date(run.started_at).toLocaleString()}</option>)}</SelectControl></label>
    {error && <p className="error" role="alert">{error}</p>}
    {id && !previous && !error && <p role="status">正在读取比较记录…</p>}
    {previous && <>
      {JSON.stringify(previous.task.steps) !== JSON.stringify(current.task.steps) && <p className="error" role="status">两次执行的步骤定义不同，请结合命令与判定条件查看差异。</p>}
      <p role="status">{changes.length} / {keys.length} 项结果变化</p>
      <div className="inspection-table-scroll"><table className="inspection-table"><thead><tr><th>主机 / 步骤</th><th>此前</th><th>本次</th><th>变化</th></tr></thead><tbody>{changes.map(itemKey => { const old = before.get(itemKey), next = after.get(itemKey), item = next || old!; return <tr key={itemKey}><td><button className="inspection-pick" aria-pressed={selected === itemKey} onClick={() => setSelected(itemKey)}>{item.target.name} · {item.step}</button><small className="muted">{item.target.address}</small></td><td>{old ? `${old.state}${old.result ? ` · ${old.result.exit_code}` : ''}` : '无记录'}</td><td>{next ? `${next.state}${next.result ? ` · ${next.result.exit_code}` : ''}` : '无记录'}</td><td>{!old ? '新增或身份变化' : !next ? '缺少或身份变化' : old.check?.actual !== next.check?.actual ? '判定值变化' : '状态或输出变化'}</td></tr>; })}</tbody></table></div>
      {selected && <><div className="button-row"><SelectControl aria-label="跨次对比通道" value={channel} onChange={event => setChannel(event.target.value as 'stdout' | 'stderr')}><option value="stdout">stdout</option><option value="stderr">stderr</option></SelectControl><span>{oldItem?.check?.actual !== undefined && `此前 ${oldItem.check.actual}`} {newItem?.check?.actual !== undefined && `本次 ${newItem.check.actual}`}</span></div><ReadonlyDiffView left={oldItem?.result?.[channel] ?? (oldItem ? oldItem.error || oldItem.check?.message || '' : undefined)} right={newItem?.result?.[channel] ?? (newItem ? newItem.error || newItem.check?.message || '' : undefined)} leftLabel="此前执行" rightLabel="本次执行" /></>}
    </>}
  </section>;
}
