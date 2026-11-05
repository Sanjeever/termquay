import { useEffect, useRef, useState } from 'react';
import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react';
import { CaptureDiagnosticSnapshot, ListDiagnosticSnapshots, ReadDiagnosticSnapshot, SaveDiagnosticSnapshot, DeleteDiagnosticSnapshot, ExportDiagnosticSnapshot } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { DiagnosticCaptureOptions, DiagnosticSection, DiagnosticSnapshot, DiagnosticSnapshotInfo } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import SelectControl from '../../components/SelectControl';
import { errorMessage } from '../../lib/errors';
import ReadonlyDiffView from '../files/ReadonlyDiffView';

const initialOptions: DiagnosticCaptureOptions = { system: true, file_systems: true, processes: false, ports: true, containers: false, docker_socket: '/var/run/docker.sock', services: [], service_logs: false, logs: [] };
const lines = (value: string) => value.split('\n').map(line => line.trim()).filter(Boolean);
type Snapshot = Omit<DiagnosticSnapshot, 'sections'> & { sections: DiagnosticSection[] };
export default function DiagnosticSnapshotsDialog({ targets, initial, onClose }: { targets: { id: string; name: string }[]; initial?: string; onClose(): void }) {
  const [workspace, setWorkspace] = useState(initial || targets[0]?.id || '');
  const [options, setOptions] = useState(initialOptions);
  const [services, setServices] = useState('');
  const [logs, setLogs] = useState('');
  const [items, setItems] = useState<DiagnosticSnapshotInfo[]>([]);
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [baseline, setBaseline] = useState<Snapshot>();
  const [baselineID, setBaselineID] = useState('');
  const [section, setSection] = useState('');
  const [expanded, setExpanded] = useState(-1);
  const [selected, setSelected] = useState(new Set<number>());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [deleting, setDeleting] = useState(false);
  const pending = useRef<{ cancel(): void }>();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; void refresh().catch(e => { if (mounted.current) setError(errorMessage(e)); }); return () => { mounted.current = false; pending.current?.cancel(); }; }, []);
  async function refresh() { const value = await ListDiagnosticSnapshots(); if (mounted.current) setItems(value || []); }
  async function operation<T>(request: Promise<T> & { cancel(): void }, apply: (value: T) => void) {
    setBusy(true); setError(''); pending.current = request;
    try { const value = await request; if (mounted.current) apply(value); }
    catch (e) { if (mounted.current) setError(errorMessage(e)); }
    finally { if (pending.current === request) pending.current = undefined; if (mounted.current) setBusy(false); }
  }
  function show(value: DiagnosticSnapshot, isSaved: boolean) { setSnapshot({ ...value, sections: value.sections || [] }); setSelected(new Set((value.sections || []).map((_, index) => index))); setExpanded(-1); setSection(''); setSaved(isSaved ? JSON.stringify([value.info.id, value.info.name]) : ''); if (value.info.id === baselineID) { setBaseline(undefined); setBaselineID(''); } }
  function capture() {
    void operation(CaptureDiagnosticSnapshot(workspace, { ...options, services: lines(services), logs: lines(logs) }), value => { if (snapshot) { setBaseline(snapshot); setBaselineID(snapshot.info.id); } show({ ...value, info: { ...value.info, name: `${targets.find(target => target.id === workspace)?.name || '主机'} · ${new Date(value.info.time).toLocaleString()}`.slice(0, 60) } }, false); });
  }
  useEffect(() => {
    if (!baselineID || baselineID === baseline?.info.id) return;
    let ended = false; const request = ReadDiagnosticSnapshot(baselineID);
    request.then(value => { if (!ended) { setBaseline({ ...value, sections: value.sections || [] }); setSection(''); } }).catch(e => { if (!ended) { setError(errorMessage(e)); setBaseline(undefined); } });
    return () => { ended = true; request.cancel(); };
  }, [baselineID]);
  const key = (item: DiagnosticSection) => `${item.kind}:${item.name}`;
  const before = new Map((baseline?.sections || []).map(item => [key(item), item]));
  const after = new Map((snapshot?.sections || []).map(item => [key(item), item]));
  const keys = [...new Set([...before.keys(), ...after.keys()])];
  const oldSection = before.get(section), newSection = after.get(section);
  const snapshotSignature = snapshot ? JSON.stringify([snapshot.info.id, snapshot.info.name]) : '';
  const same = (name: string) => { const left = before.get(name), right = after.get(name); return !!left && !!right && left.content === right.content && left.error === right.error && left.truncated === right.truncated; };
  return <Modal isOpen size="5xl" className="app-dialog" scrollBehavior="inside" isDismissable={!busy} onClose={() => { pending.current?.cancel(); onClose(); }}><ModalContent><ModalHeader>排障快照</ModalHeader><ModalBody>
    <div className="file-compare-sides"><label className="form-field">采集主机<SelectControl value={workspace} disabled={busy} onChange={event => setWorkspace(event.target.value)}><option value="">选择已连接 SSH 工作区</option>{targets.map(target => <option key={target.id} value={target.id}>{target.name}</option>)}</SelectControl></label><label className="form-field">已保存快照<SelectControl value={saved && snapshot ? snapshot.info.id : ''} disabled={busy} onChange={event => { if (event.target.value) void operation(ReadDiagnosticSnapshot(event.target.value), value => show(value, true)); }}><option value="">选择本机快照</option>{[...items].reverse().map(item => <option key={item.id} value={item.id}>{item.name} · {new Date(item.time).toLocaleString()}</option>)}</SelectControl></label></div>
    <details open={!snapshot}><summary>采集内容</summary><div className="button-row">{([['system', '系统与资源'], ['file_systems', '文件系统'], ['processes', '进程参数'], ['ports', '监听端口'], ['containers', 'Docker 容器']] as const).map(([name, label]) => <label key={name} className="checkbox-label"><input type="checkbox" checked={options[name]} disabled={busy} onChange={event => setOptions({ ...options, [name]: event.target.checked })} />{label}</label>)}</div>
      {options.containers && <label className="form-field">Docker socket<input value={options.docker_socket} disabled={busy} maxLength={4096} onChange={event => setOptions({ ...options, docker_socket: event.target.value })} /></label>}
      <div className="file-compare-sides"><label className="form-field">服务名称（每行一个，最多 8 个）<textarea rows={3} value={services} maxLength={2048} disabled={busy} onChange={event => setServices(event.target.value)} /></label><label className="form-field">日志绝对路径（每行一个，最多 8 个）<textarea rows={3} value={logs} maxLength={32768} disabled={busy} onChange={event => setLogs(event.target.value)} /></label></div>
      <label className="checkbox-label"><input type="checkbox" checked={options.service_logs} disabled={busy} onChange={event => setOptions({ ...options, service_logs: event.target.checked })} />包含所选服务的近期日志</label>
      <Button size="sm" isLoading={busy} isDisabled={busy || !targets.some(target => target.id === workspace)} onPress={capture}>采集快照</Button>
    </details>
    {error && <p className="error" role="alert">{error}</p>}
    {snapshot && <>
      <label className="form-field">快照名称<input value={snapshot.info.name} maxLength={128} disabled={busy} onChange={event => setSnapshot({ ...snapshot, info: { ...snapshot.info, name: event.target.value } })} /></label>
      <p className="file-path">{snapshot.info.target} · {new Date(snapshot.info.time).toLocaleString()}</p>
      <p className="muted">逐项核对后选择导出内容。日志与进程参数可能包含秘密。</p>
      {snapshot.sections.map((item, index) => <section className="inspection-detail" key={`${key(item)}:${index}`}><div className="button-row"><label className="checkbox-label"><input type="checkbox" checked={selected.has(index)} disabled={busy} onChange={event => setSelected(previous => { const next = new Set(previous); if (event.target.checked) next.add(index); else next.delete(index); return next; })} />{item.name}</label><span className={item.error || item.truncated ? 'error' : 'muted'}>{item.error ? '采集失败或不完整' : item.truncated ? '局部 / 截断' : '已采集'} · {new Date(item.time).toLocaleTimeString()}</span><button className="session-tool" aria-expanded={expanded === index} onClick={() => setExpanded(expanded === index ? -1 : index)}>查看内容</button></div>{expanded === index && <>{item.error && <p className="error">{item.error}</p>}<pre className="diagnostic-content">{item.content}</pre></>}</section>)}
      <div className="button-row"><Button size="sm" variant="light" isDisabled={busy || !snapshot.info.name.trim() || saved === snapshotSignature} onPress={() => void operation(SaveDiagnosticSnapshot(snapshot), () => { setSaved(snapshotSignature); void refresh().catch(e => setError(errorMessage(e))); })}>{saved === snapshotSignature ? '已加密保存' : '加密保存快照'}</Button><Button size="sm" variant="light" isDisabled={busy || !selected.size} onPress={() => void operation(ExportDiagnosticSnapshot(snapshot, [...selected]), () => {})}>导出所选项目</Button>{items.some(item => item.id === snapshot.info.id) && <Button size="sm" variant="light" color="danger" isDisabled={busy} onPress={() => setDeleting(true)}>移除已保存快照</Button>}</div>
      <label className="form-field">与另一份快照比较<SelectControl value={baselineID} disabled={busy} onChange={event => { setBaselineID(event.target.value); if (!event.target.value) setBaseline(undefined); }}><option value="">选择比较快照</option>{baseline && !items.some(item => item.id === baseline.info.id) && <option value={baseline.info.id}>{baseline.info.name} · 本次运行</option>}{items.filter(item => item.id !== snapshot.info.id).map(item => <option key={item.id} value={item.id}>{item.name} · {item.target}</option>)}</SelectControl></label>
      {baseline && <><p className="file-path">此前 {baseline.info.target} · {new Date(baseline.info.time).toLocaleString()}</p>{baseline.info.identity !== snapshot.info.identity && <p className="muted">两份快照来源身份不同。</p>}<SelectControl aria-label="选择快照对比项目" value={section} onChange={event => setSection(event.target.value)}><option value="">选择项目 · {keys.filter(name => !same(name)).length} 项变化</option>{keys.map(name => <option key={name} value={name}>{(after.get(name) || before.get(name))!.name} · {same(name) ? '相同' : '变化或缺少'}</option>)}</SelectControl>{section && <ReadonlyDiffView left={oldSection ? [oldSection.error, oldSection.truncated ? '局部 / 截断' : '', oldSection.content].filter(Boolean).join('\n') : undefined} right={newSection ? [newSection.error, newSection.truncated ? '局部 / 截断' : '', newSection.content].filter(Boolean).join('\n') : undefined} leftLabel="此前快照" rightLabel="当前快照" />}</>}
    </>}
    {deleting && snapshot && <section className="inspection-detail"><p>移除本机加密快照“{snapshot.info.name}”？</p><div className="button-row"><Button size="sm" variant="light" onPress={() => setDeleting(false)}>取消</Button><Button size="sm" color="danger" isDisabled={busy} onPress={() => void operation(DeleteDiagnosticSnapshot(snapshot.info.id), () => { setItems(previous => previous.filter(item => item.id !== snapshot.info.id)); setSaved(''); setDeleting(false); })}>移除</Button></div></section>}
  </ModalBody><ModalFooter><Button variant="light" onPress={() => { pending.current?.cancel(); onClose(); }}>{busy ? '取消并关闭' : '关闭'}</Button></ModalFooter></ModalContent></Modal>;
}
