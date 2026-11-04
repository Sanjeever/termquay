import { useEffect, useRef, useState } from 'react';
import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react';
import { GetFileHistory, SetFileHistory, ClearFileHistory, ReadFileVersion, RunFileAction } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { FileHistory } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import type { Document } from '../../../bindings/github.com/Sanjeever/termquay/internal/files/models';
import type { CommandResult } from '../../../bindings/github.com/Sanjeever/termquay/internal/ssh/models';
import ReadonlyDiffView from './ReadonlyDiffView';
import { errorMessage } from '../../lib/errors';
import SelectControl from '../../components/SelectControl';

export default function FileHistoryDialog({ workspace, target, document, dirty, onRestore, onClose }: { workspace: string; target: string; document: Document; dirty: boolean; onRestore(value: Document): void; onClose(): void }) {
  const [history, setHistory] = useState<FileHistory>();
  const [enabled, setEnabled] = useState(false);
  const [validate, setValidate] = useState('');
  const [reload, setReload] = useState('');
  const [selected, setSelected] = useState('');
  const [version, setVersion] = useState<Document>();
  const [result, setResult] = useState<CommandResult>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<'reload' | 'clear' | 'restore'>();
  const mounted = useRef(true);
  const requests = useRef(new Set<{ cancel(): void }>());
  useEffect(() => {
    mounted.current = true; const request = GetFileHistory(workspace, document.path);
    request.then(value => { if (mounted.current) { setHistory(value); setEnabled(value.enabled); setValidate(value.validate); setReload(value.reload); } }).catch(e => { if (mounted.current) setError(errorMessage(e)); });
    return () => { mounted.current = false; request.cancel(); requests.current.forEach(value => value.cancel()); };
  }, [workspace, document.path]);
  useEffect(() => {
    if (!selected) { setVersion(undefined); return; }
    let ended = false; setVersion(undefined); const request = ReadFileVersion(workspace, document.path, selected);
    request.then(value => { if (!ended) setVersion(value); }).catch(e => { if (!ended) setError(errorMessage(e)); });
    return () => { ended = true; request.cancel(); };
  }, [workspace, document.path, selected]);
  const changed = history && (history.enabled !== enabled || history.validate !== validate || history.reload !== reload);
  async function operation<T>(request: Promise<T> & { cancel(): void }, apply: (value: T) => void) {
    setBusy(true); setError(''); requests.current.add(request);
    try { const value = await request; if (mounted.current) apply(value); }
    catch (e) { if (mounted.current) setError(errorMessage(e)); }
    finally { requests.current.delete(request); if (mounted.current) setBusy(false); }
  }
  function execute(action: 'validate' | 'reload') { setResult(undefined); void operation(RunFileAction(workspace, document.path, action, action === 'reload' ? reload : validate), setResult); }
  function restore() { if (version) { onRestore(version); onClose(); } }
  return <Modal isOpen onClose={() => !busy && onClose()} isDismissable={!busy} size="5xl" className="app-dialog file-conflict-dialog" scrollBehavior="inside"><ModalContent><ModalHeader>配置历史与验证</ModalHeader><ModalBody>
    <p className="file-path">{target} · {document.path}</p>{error && <p className="error" role="alert">{error}</p>}
    <label className="checkbox-label"><input type="checkbox" checked={enabled} disabled={!history || busy} onChange={event => setEnabled(event.target.checked)} />保存修改前的加密历史</label>
    <div className="file-compare-sides"><label className="form-field">验证命令<textarea rows={3} value={validate} maxLength={8192} disabled={!history || busy} onChange={event => setValidate(event.target.value)} spellCheck={false} /></label><label className="form-field">reload 命令<textarea rows={3} value={reload} maxLength={8192} disabled={!history || busy} onChange={event => setReload(event.target.value)} spellCheck={false} /></label></div>
    <div className="button-row"><Button size="sm" isDisabled={!changed || busy} onPress={() => void operation(SetFileHistory(workspace, document.path, enabled, validate, reload), () => setHistory(previous => ({ enabled, validate, reload, versions: previous?.versions || [] })))}>保存设置</Button><Button size="sm" variant="light" isDisabled={busy || !history || !!changed || !validate.trim() || dirty} onPress={() => execute('validate')}>验证已保存文件</Button><Button size="sm" variant="light" isDisabled={busy || !history || !!changed || !reload.trim() || dirty} onPress={() => setConfirmation('reload')}>reload</Button></div>
    {result && <section><p className={result.error || result.exit_code !== 0 ? 'error' : 'session-status'}>{result.error || `退出码 ${result.exit_code} · ${(result.duration_ms / 1000).toFixed(2)}s`}{result.truncated && ' · 输出已截断'}</p><pre>{result.stdout}</pre><pre className="error">{result.stderr}</pre></section>}
    {!!history?.versions?.length && <><SelectControl aria-label="历史版本" value={selected} disabled={busy} onChange={event => setSelected(event.target.value)}><option value="">选择历史版本</option>{[...history.versions].reverse().map(item => <option key={item.id} value={item.id}>{new Date(item.time).toLocaleString()} · {item.size} 字节</option>)}</SelectControl>
      <ReadonlyDiffView left={version?.content} right={document.content} leftLabel="历史版本" rightLabel="当前草稿" />
      {version && <div className="button-row"><span className="muted">左侧历史版本 · 右侧当前草稿</span><Button size="sm" isDisabled={busy} onPress={() => dirty ? setConfirmation('restore') : restore()}>将此版本载入草稿</Button></div>}</>}
    {confirmation && <section className="inspection-detail"><p>{confirmation === 'reload' ? '确认在当前 SSH 目标执行 reload？' : confirmation === 'clear' ? '确认清除本文件全部本机历史与操作设置，并恢复默认开启历史？' : '确认用历史版本替换未保存草稿？'}</p>{confirmation === 'reload' && <pre>{reload}</pre>}<div className="button-row"><Button size="sm" variant="light" onPress={() => setConfirmation(undefined)}>取消</Button><Button size="sm" color="danger" isDisabled={busy} onPress={() => { const action = confirmation; setConfirmation(undefined); if (action === 'reload') execute('reload'); else if (action === 'restore') restore(); else void operation(ClearFileHistory(workspace, document.path), () => { setHistory({ enabled: true, validate: '', reload: '', versions: [] }); setEnabled(true); setValidate(''); setReload(''); setSelected(''); }); }}>确认</Button></div></section>}
  </ModalBody><ModalFooter><Button variant="light" isDisabled={busy || !history} onPress={() => setConfirmation('clear')}>清除历史与设置</Button><Button variant="light" isDisabled={busy} onPress={onClose}>关闭</Button></ModalFooter></ModalContent></Modal>;
}
