import { useEffect, useRef, useState } from 'react';
import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react';
import { BrowseTransferDirectory, PreviewTransferCopy, ExecuteDirectorySync, CancelDirectorySyncPreview } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { Transfer, TransferDirectory, DirectorySyncPreview } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import SelectControl from '../../components/SelectControl';
import { errorMessage } from '../../lib/errors';
import { bytes } from './transferFormat';

type Location = { workspace: string; directory: string; selected: string[] };
type Target = { id: string; name: string };
function Pane({ side, targets, disabled, onChange }: { side: Location; targets: Target[]; disabled: boolean; onChange(value: Location): void }) {
  const [list, setList] = useState<TransferDirectory>();
  const [path, setPath] = useState(side.directory);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let ended = false; setList(undefined); setError(''); const request = BrowseTransferDirectory(side.workspace, side.directory);
    request.then(value => { if (!ended) { setList(value); setPath(value.path); if (!side.directory) onChange({ ...side, directory: value.path, selected: [] }); } }).catch(e => { if (!ended) setError(errorMessage(e)); });
    return () => { ended = true; request.cancel(); };
  }, [side.workspace, side.directory, revision]);
  return <section><SelectControl aria-label="文件位置" value={side.workspace} disabled={disabled} onChange={event => onChange({ workspace: event.target.value, directory: '', selected: [] })}><option value="">本地</option>{targets.map(target => <option key={target.id} value={target.id}>{target.name}</option>)}</SelectControl>
    <form className="button-row" onSubmit={event => { event.preventDefault(); onChange({ ...side, directory: path, selected: [] }); setRevision(value => value + 1); }}><input aria-label="目录路径" value={path} disabled={disabled} onChange={event => setPath(event.target.value)} /><Button size="sm" variant="light" type="submit" isDisabled={disabled}>打开 / 刷新</Button><Button size="sm" variant="light" isDisabled={disabled || !list || list.parent === list.path} onPress={() => onChange({ ...side, directory: list!.parent, selected: [] })}>上级</Button></form>
    {error && <p className="error" role="alert">{error}</p>}{list?.truncated && <p role="status">目录超过 512 项，列表已截断，可输入完整子目录路径</p>}
    <div className="transfer-browser-list"><table className="inspection-table"><thead><tr><th>选择</th><th>名称</th><th>大小</th></tr></thead><tbody>{list?.entries?.map(entry => <tr key={entry.path}><td><input type="checkbox" aria-label={`选择 ${entry.name}`} disabled={disabled || entry.symlink || !entry.directory && !entry.mode.startsWith('-')} checked={side.selected.includes(entry.name)} onChange={event => onChange({ ...side, selected: event.target.checked ? [...side.selected, entry.name] : side.selected.filter(name => name !== entry.name) })} /></td><td>{entry.directory && !entry.symlink ? <button className="session-tool" disabled={disabled} onClick={() => onChange({ ...side, directory: entry.path, selected: [] })}>{entry.name}/</button> : <span>{entry.name}{entry.symlink && ' ↗'}</span>}</td><td>{entry.directory ? '' : bytes(entry.size)}</td></tr>)}</tbody></table></div>
  </section>;
}

export default function TransferBrowser({ targets, initial, onTransfer, onCompare, onClose }: { targets: Target[]; initial?: string; onTransfer(value: Transfer): void; onCompare(): void; onClose(): void }) {
  const [sides, setSides] = useState<[Location, Location]>([{ workspace: '', directory: '', selected: [] }, { workspace: initial || targets[0]?.id || '', directory: '', selected: [] }]);
  const [preview, setPreview] = useState<DirectorySyncPreview>();
  const [selected, setSelected] = useState(new Set<string>());
  const [exclude, setExclude] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(0);
  const pending = useRef<{ cancel(): void }>();
  const latest = useRef(preview); latest.current = preview;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; pending.current?.cancel(); if (latest.current) void CancelDirectorySyncPreview(latest.current.id); }; }, []);
  function invalidate() { if (preview) CancelDirectorySyncPreview(preview.id).catch(e => setError(errorMessage(e))); setPreview(undefined); setSelected(new Set()); }
  async function scan(reverse: boolean) {
    setBusy(true); setError(''); invalidate(); setPage(0);
    const [source, target] = reverse ? [sides[1], sides[0]] : sides;
    const request = PreviewTransferCopy(source.workspace, source.directory, target.workspace, target.directory, source.selected, exclude.split('\n').map(value => value.trim()).filter(Boolean)); pending.current = request;
    try { const value = await request; if (mounted.current) { setPreview(value); setSelected(new Set()); } }
    catch (e) { if (mounted.current) setError(errorMessage(e)); }
    finally { if (mounted.current) setBusy(false); }
  }
  const changes = preview?.entries?.filter(entry => ['new', 'update'].includes(entry.state)) || [];
  return <Modal isOpen onClose={onClose} size="5xl" className="app-dialog" scrollBehavior="inside" isDismissable={!busy}><ModalContent><ModalHeader>文件管理与复制</ModalHeader><ModalBody>
    <div className="file-compare-sides">{sides.map((side, index) => <Pane key={index} side={side} targets={targets} disabled={busy} onChange={value => { invalidate(); setSides(previous => previous.map((item, i) => i === index ? value : item) as [Location, Location]); }} />)}</div>
    <details><summary>排除规则</summary><textarea aria-label="复制排除规则，每行一条" rows={3} value={exclude} disabled={busy} onChange={event => { setExclude(event.target.value); invalidate(); }} /></details>
    <div className="button-row">{[false, true].map(reverse => <Button key={String(reverse)} size="sm" variant="light" isDisabled={busy || !sides.every(side => !!side.directory) || !sides.some(side => !!side.workspace)} onPress={() => void scan(reverse)}>{reverse ? '预览右 → 左' : '预览左 → 右'}{sides[reverse ? 1 : 0].selected.length ? `（${sides[reverse ? 1 : 0].selected.length} 项）` : '（整个目录）'}</Button>)}{busy && <Button size="sm" variant="light" onPress={() => pending.current?.cancel()}>取消当前操作</Button>}</div>
    {error && <p className="error" role="alert">{error}</p>}
    {preview && <><p className="file-path">{preview.direction === 'download' ? `${preview.remote} → ${preview.local}` : `${preview.local} → ${preview.remote}`}</p><div className="button-row"><Button size="sm" variant="light" isDisabled={busy} onPress={() => setSelected(new Set(changes.filter(entry => !entry.directory).map(entry => entry.path)))}>选择全部文件差异</Button><Button size="sm" variant="light" isDisabled={busy} onPress={() => setSelected(new Set())}>清除选择</Button><span>{selected.size} 项</span></div><table className="inspection-table"><thead><tr><th>选择</th><th>路径</th><th>差异</th><th>大小</th></tr></thead><tbody>{preview.entries?.slice(page * 100, (page + 1) * 100).map(entry => <tr key={entry.path}><td><input type="checkbox" aria-label={`复制 ${entry.path}`} checked={selected.has(entry.path)} disabled={busy || !['new', 'update'].includes(entry.state)} onChange={event => setSelected(previous => { const next = new Set(previous); if (event.target.checked) next.add(entry.path); else next.delete(entry.path); return next; })} /></td><td>{entry.path}{entry.directory && '/'}</td><td>{{ new: '新增', update: '覆盖更新', same: '相同', conflict: '冲突 / 不支持' }[entry.state]}</td><td>{entry.directory ? '' : bytes(entry.size)}</td></tr>)}</tbody></table>{(preview.entries?.length || 0) > 100 && <div className="button-row"><Button size="sm" isDisabled={!page} onPress={() => setPage(value => value - 1)}>上一页</Button><span>{page + 1}</span><Button size="sm" isDisabled={(page + 1) * 100 >= (preview.entries?.length || 0)} onPress={() => setPage(value => value + 1)}>下一页</Button></div>}</>}
  </ModalBody><ModalFooter><Button variant="light" isDisabled={busy} onPress={onCompare}>文本文件对比</Button><Button variant="light" onPress={onClose}>关闭</Button><Button color="primary" isDisabled={busy || !preview || !selected.size} onPress={async () => { if (!preview) return; setBusy(true); const request = ExecuteDirectorySync(preview.id, [...selected]); pending.current = request; try { const value = await request; if (mounted.current) { onTransfer(value); setPreview(undefined); setSelected(new Set()); } } catch (e) { if (mounted.current) setError(errorMessage(e)); } finally { if (mounted.current) setBusy(false); } }}>执行所选复制</Button></ModalFooter></ModalContent></Modal>;
}
