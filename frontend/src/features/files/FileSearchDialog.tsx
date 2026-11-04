import { useEffect, useRef, useState } from 'react';
import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react';
import { SearchRemoteFiles } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { SearchMatch, SearchResult } from '../../../bindings/github.com/Sanjeever/termquay/internal/files/models';
import SelectControl from '../../components/SelectControl';
import ErrorNotice from '../../components/ErrorNotice';
import { errorMessage } from '../../lib/errors';

export default function FileSearchDialog({ workspace, directory, onOpen, onClose }: { workspace: string; directory: string; onOpen(match: SearchMatch): Promise<void>; onClose(): void }) {
  const [root, setRoot] = useState(directory);
  const [query, setQuery] = useState('');
  const [content, setContent] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [regex, setRegex] = useState(false);
  const [exclude, setExclude] = useState('');
  const [result, setResult] = useState<SearchResult>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState(false);
  const pending = useRef<ReturnType<typeof SearchRemoteFiles>>();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; pending.current?.cancel(); pending.current = undefined; }; }, [workspace]);

  function cancel() {
    const request = pending.current;
    pending.current = undefined;
    request?.cancel();
    setBusy(false);
    if (request) setError('搜索已取消');
  }
  async function search() {
    if (pending.current) return;
    setBusy(true); setError(''); setResult(undefined);
    const request = SearchRemoteFiles(workspace, { root, query, content, case_sensitive: caseSensitive, regex, exclude: exclude.split('\n').map(value => value.trim()).filter(Boolean) });
    pending.current = request;
    try {
      const value = await request;
      if (mounted.current && pending.current === request) setResult(value);
    } catch (e) { if (mounted.current && pending.current === request) setError(errorMessage(e)); }
    finally { if (pending.current === request) { pending.current = undefined; if (mounted.current) setBusy(false); } }
  }
  async function open(match: SearchMatch) {
    if (opening) return;
    setOpening(true); setError('');
    try { await onOpen(match); if (mounted.current) onClose(); }
    catch (e) { if (mounted.current) setError(errorMessage(e)); }
    finally { if (mounted.current) setOpening(false); }
  }
  return <Modal isOpen onClose={onClose} size="4xl" className="app-dialog file-search-dialog" scrollBehavior="inside"><ModalContent><ModalHeader>搜索远端文件</ModalHeader>
    <form onSubmit={event => { event.preventDefault(); void search(); }}><ModalBody>
      <label className="form-field">目录<input value={root} disabled={busy} maxLength={4096} onChange={event => setRoot(event.target.value)} required /></label>
      <div className="file-search-query"><SelectControl aria-label="搜索方式" value={content ? 'content' : 'name'} disabled={busy} onChange={event => setContent(event.target.value === 'content')}><option value="name">文件名</option><option value="content">文件内容</option></SelectControl><input aria-label="搜索内容" autoFocus value={query} disabled={busy} maxLength={512} onChange={event => setQuery(event.target.value)} required /><Button type="submit" color="primary" isDisabled={busy || !query || !root || opening}>搜索</Button>{busy && <Button variant="light" onPress={cancel}>取消</Button>}</div>
      <div className="button-row"><label className="checkbox-label"><input type="checkbox" checked={caseSensitive} disabled={busy} onChange={event => setCaseSensitive(event.target.checked)} />区分大小写</label><label className="checkbox-label"><input type="checkbox" checked={regex} disabled={busy} onChange={event => setRegex(event.target.checked)} />正则表达式</label></div>
      <details><summary>排除规则</summary><textarea aria-label="排除规则，每行一条相对路径或文件名通配符" value={exclude} disabled={busy} rows={3} onChange={event => setExclude(event.target.value)} maxLength={8192} /></details>
      <ErrorNotice message={error} onDismiss={() => setError('')} />
      {busy && <p className="muted" role="status">正在搜索…</p>}
      {result && <>
        <div className="session-status" role="status">{result.matches.length} 项结果 · 已扫描 {result.scanned} 项{result.skipped_large > 0 && ` · 跳过大文件 ${result.skipped_large} 个`}{result.skipped_binary > 0 && ` · 跳过二进制或非 UTF-8 文件 ${result.skipped_binary} 个`}{result.failed > 0 && ` · ${result.failed} 项未能搜索`}</div>
        {result.stop_reason && <p role="status" className="error">{result.stop_reason}</p>}
        {!!result.issues.length && <details><summary>未完成项{result.failed > result.issues.length ? `（展示前 ${result.issues.length} 项）` : ''}</summary>{result.issues.map((issue, index) => <p key={index} className="error file-path">{issue.path} · {issue.error}</p>)}</details>}
        <div className="file-search-results" aria-label="远端文件搜索结果">{result.matches.map((match, index) => <button type="button" key={`${match.path}:${match.line}:${index}`} disabled={opening} onClick={() => void open(match)}><span className="file-path">{match.path}{match.directory ? '/' : match.line ? `:${match.line}` : ''}</span>{match.text && <code>{match.text}</code>}</button>)}</div>
      </>}
    </ModalBody><ModalFooter><Button variant="light" onPress={onClose}>关闭</Button></ModalFooter></form>
  </ModalContent></Modal>;
}
