import { useEffect, useRef, useState } from 'react';
import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react';
import { GetFileHistory, ConfigureFileWorkflow, ClearFileHistory, ReadFileVersion, RunFileAction } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { FileHistory } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import type { Document } from '../../../bindings/github.com/Sanjeever/termquay/internal/files/models';
import type { CommandResult } from '../../../bindings/github.com/Sanjeever/termquay/internal/ssh/models';
import ReadonlyDiffView from './ReadonlyDiffView';
import { errorMessage } from '../../lib/errors';
import SelectControl from '../../components/SelectControl';

export default function FileHistoryDialog({ workspace, target, document, dirty, onSave, onRestore, onClose }: { workspace: string; target: string; document: Document; dirty: boolean; onSave(): Promise<boolean>; onRestore(value: Document): void; onClose(): void }) {
  const [history, setHistory] = useState<FileHistory>();
  const [enabled, setEnabled] = useState(false);
  const [validate, setValidate] = useState('');
  const [reload, setReload] = useState('');
  const [health, setHealth] = useState('');
  const [savedFile, setSavedFile] = useState(false);
  const [validated, setValidated] = useState(false);
  const [reloaded, setReloaded] = useState(false);
  const [healthy, setHealthy] = useState(false);
  const [actionName, setActionName] = useState('');
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
    request.then(value => { if (mounted.current) { setHistory(value); setEnabled(value.enabled); setValidate(value.validate); setReload(value.reload); setHealth(value.health_check || ''); } }).catch(e => { if (mounted.current) setError(errorMessage(e)); });
    return () => { mounted.current = false; request.cancel(); requests.current.forEach(value => value.cancel()); };
  }, [workspace, document.path]);
  useEffect(() => {
    if (!selected) { setVersion(undefined); return; }
    let ended = false; setVersion(undefined); const request = ReadFileVersion(workspace, document.path, selected);
    request.then(value => { if (!ended) setVersion(value); }).catch(e => { if (!ended) setError(errorMessage(e)); });
    return () => { ended = true; request.cancel(); };
  }, [workspace, document.path, selected]);
  useEffect(() => { setValidated(false); setReloaded(false); setHealthy(false); setSavedFile(false); }, [document.content, document.revision, document.encoding, document.line_ending, document.bom, validate, reload, health]);
  const changed = history && (history.enabled !== enabled || history.validate !== validate || history.reload !== reload || (history.health_check || '') !== health);
  async function operation<T>(request: Promise<T> & { cancel(): void }, apply: (value: T) => void) {
    setBusy(true); setError(''); requests.current.add(request);
    try { const value = await request; if (mounted.current) apply(value); }
    catch (e) { if (mounted.current) setError(errorMessage(e)); }
    finally { requests.current.delete(request); if (mounted.current) setBusy(false); }
  }
  async function execute(action: 'validate' | 'reload' | 'health', saving = false) {
    setBusy(true); setError(''); setResult(undefined); setActionName(action === 'validate' ? '验证' : action === 'reload' ? 'reload' : '健康检查');
    if (action === 'validate') { setValidated(false); setReloaded(false); setHealthy(false); }
    if (action === 'reload') { setReloaded(false); setHealthy(false); }
    try {
      if (saving && !await onSave()) throw new Error('文件尚未保存，请处理保存错误或取消的授权');
      if (!mounted.current) return;
      setSavedFile(true);
      if (saving) { const request = GetFileHistory(workspace, document.path); requests.current.add(request); try { const latest = await request; if (mounted.current) setHistory(latest); } finally { requests.current.delete(request); } }
      const script = action === 'reload' ? reload : action === 'health' ? health : validate;
      const request = RunFileAction(workspace, document.path, action, script); requests.current.add(request);
      let value: CommandResult;
      try { value = await request; } finally { requests.current.delete(request); }
      if (!mounted.current) return;
      setResult(value);
      const passed = !value.error && value.exit_code === 0 && !value.truncated;
      if (action === 'validate') setValidated(passed);
      if (action === 'health') setHealthy(passed);
      if (action === 'reload') {
        setReloaded(passed);
        if (passed && health.trim()) { await execute('health'); return; }
      }
      if (!passed) setError(`${action === 'validate' ? '验证' : action === 'health' ? '健康检查' : 'reload'}未通过；线上文件已保存，可修复草稿或从历史载入旧版本后显式保存`);
    } catch (e) { if (mounted.current) setError(errorMessage(e)); }
    finally { if (mounted.current) setBusy(false); }
  }
  function restore() { if (version) { onRestore(version); onClose(); } }
  return <Modal isOpen onClose={() => !busy && onClose()} isDismissable={!busy} size="5xl" className="app-dialog file-conflict-dialog" scrollBehavior="inside"><ModalContent><ModalHeader>配置变更与历史</ModalHeader><ModalBody>
    <p className="file-path">{target} · {document.path}</p>{error && <p className="error" role="alert">{error}</p>}
    <label className="checkbox-label"><input type="checkbox" checked={enabled} disabled={!history || busy} onChange={event => setEnabled(event.target.checked)} />保存修改前的加密历史</label>
    <div className="file-compare-sides"><label className="form-field">验证命令<textarea rows={3} value={validate} maxLength={8192} disabled={!history || busy} onChange={event => setValidate(event.target.value)} spellCheck={false} /></label><label className="form-field">reload 命令<textarea rows={3} value={reload} maxLength={8192} disabled={!history || busy} onChange={event => setReload(event.target.value)} spellCheck={false} /></label></div>
    <label className="form-field">健康检查命令（可选）<textarea rows={2} value={health} maxLength={8192} disabled={!history || busy} onChange={event => setHealth(event.target.value)} spellCheck={false} /></label>
    <div className="button-row" role="status"><span>{savedFile ? '线上文件已保存' : dirty ? '草稿未保存' : '文件已保存'}</span><span>→ {validated ? '验证通过' : '待验证'}</span><span>→ {reloaded ? 'reload 完成' : '待确认 reload'}</span>{health.trim() && <span>→ {healthy ? '健康检查通过' : '待健康检查'}</span>}</div>
    <div className="button-row"><Button size="sm" isDisabled={!changed || busy} onPress={() => void operation(ConfigureFileWorkflow(workspace, document.path, enabled, validate, reload, health), () => setHistory(previous => ({ enabled, validate, reload, health_check: health, versions: previous?.versions || [] })))}>保存设置</Button><Button size="sm" color="primary" isDisabled={busy || !history || !!changed || !validate.trim()} onPress={() => void execute('validate', true)}>保存并验证</Button><Button size="sm" variant="light" isDisabled={busy || !history || !!changed || !validate.trim() || dirty} onPress={() => void execute('validate')}>验证已保存文件</Button><Button size="sm" variant="light" isDisabled={busy || !history || !!changed || !reload.trim() || dirty || !validated} onPress={() => setConfirmation('reload')}>确认 reload</Button><Button size="sm" variant="light" isDisabled={busy || !history || !!changed || !health.trim() || dirty} onPress={() => void execute('health')}>健康检查</Button></div>
    {result && <section><p className={result.error || result.exit_code !== 0 || result.truncated ? 'error' : 'session-status'}>{actionName} · {result.error || `退出码 ${result.exit_code} · ${(result.duration_ms / 1000).toFixed(2)}s`}{result.truncated && ' · 输出已截断，无法确认通过'}</p><pre>{result.stdout}</pre><pre className="error">{result.stderr}</pre></section>}
    {!!history?.versions?.length && <><SelectControl aria-label="历史版本" value={selected} disabled={busy} onChange={event => setSelected(event.target.value)}><option value="">选择历史版本</option>{[...history.versions].reverse().map(item => <option key={item.id} value={item.id}>{new Date(item.time).toLocaleString()} · {item.size} 字节</option>)}</SelectControl>
      <ReadonlyDiffView left={version?.content} right={document.content} leftLabel="历史版本" rightLabel="当前草稿" />
      {version && <div className="button-row"><span className="muted">左侧历史版本 · 右侧当前草稿</span><Button size="sm" isDisabled={busy} onPress={() => dirty ? setConfirmation('restore') : restore()}>将此版本载入草稿</Button></div>}</>}
    {confirmation && <section className="inspection-detail"><p>{confirmation === 'reload' ? '确认在当前 SSH 目标执行 reload？' : confirmation === 'clear' ? '确认清除本文件全部本机历史与操作设置，并恢复默认开启历史？' : '确认用历史版本替换未保存草稿？'}</p>{confirmation === 'reload' && <pre>{reload}</pre>}<div className="button-row"><Button size="sm" variant="light" onPress={() => setConfirmation(undefined)}>取消</Button><Button size="sm" color="danger" isDisabled={busy} onPress={() => { const action = confirmation; setConfirmation(undefined); if (action === 'reload') void execute('reload'); else if (action === 'restore') restore(); else void operation(ClearFileHistory(workspace, document.path), () => { setHistory({ enabled: true, validate: '', reload: '', versions: [] }); setEnabled(true); setValidate(''); setReload(''); setHealth(''); setSelected(''); }); }}>确认</Button></div></section>}
  </ModalBody><ModalFooter><Button variant="light" isDisabled={busy || !history} onPress={() => setConfirmation('clear')}>清除历史与设置</Button><Button variant="light" isDisabled={busy} onPress={onClose}>关闭</Button></ModalFooter></ModalContent></Modal>;
}
