import Modal from '../../components/Modal';
import { eventError, errorMessage } from '../../lib/errors.ts';
import { t as translate } from '../../i18n/index.ts';
import { message as uiMessage } from '../../i18n/messages.ts';
import { useMessageState } from '../../i18n/useMessageState.ts';
import { useTranslation } from 'react-i18next';
import { useEffect, useRef, useState } from 'react';
import { Button, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react';
import { SearchRemoteFiles } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { SearchMatch, SearchResult } from '../../../bindings/github.com/Sanjeever/termquay/internal/files/models';
import SelectControl from '../../components/SelectControl';
import ErrorNotice from '../../components/ErrorNotice';


export default function FileSearchDialog({ workspace, directory, onOpen, onClose }: { workspace: string; directory: string; onOpen(match: SearchMatch): Promise<void>; onClose(): void }) {
  useTranslation();
  const [root, setRoot] = useState(directory);
  const [query, setQuery] = useState('');
  const [content, setContent] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [regex, setRegex] = useState(false);
  const [exclude, setExclude] = useState('');
  const [result, setResult] = useState<SearchResult>();
  const [error, setError] = useMessageState('');
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
    if (request) setError(uiMessage('files:searchCanceled'));
  }
  async function search() {
    if (pending.current) return;
    setBusy(true); setError(''); setResult(undefined);
    const request = SearchRemoteFiles(workspace, { root, query, content, case_sensitive: caseSensitive, regex, exclude: exclude.split('\n').map(value => value.trim()).filter(Boolean) });
    pending.current = request;
    try {
      const value = await request;
      if (mounted.current && pending.current === request) setResult(value);
    } catch (e) { if (mounted.current && pending.current === request) setError(e); }
    finally { if (pending.current === request) { pending.current = undefined; if (mounted.current) setBusy(false); } }
  }
  async function open(match: SearchMatch) {
    if (opening) return;
    setOpening(true); setError('');
    try { await onOpen(match); if (mounted.current) onClose(); }
    catch (e) { if (mounted.current) setError(e); }
    finally { if (mounted.current) setOpening(false); }
  }
  const matches = result?.matches || [];
  const issues = result?.issues || [];
  return <Modal isOpen onClose={onClose} size="4xl" className="app-dialog file-search-dialog" scrollBehavior="inside"><ModalContent><ModalHeader>{translate('files:searchRemoteFiles')}</ModalHeader>
    <form onSubmit={event => { event.preventDefault(); void search(); }}><ModalBody>
      <label className="form-field">{translate('files:directory2')}<input value={root} disabled={busy} maxLength={4096} onChange={event => setRoot(event.target.value)} required /></label>
      <div className="file-search-query"><SelectControl aria-label={translate('files:searchMethod')} value={content ? 'content' : 'name'} disabled={busy} onChange={event => setContent(event.target.value === 'content')}><option value="name">{translate('files:fileName')}</option><option value="content">{translate('files:fileContents')}</option></SelectControl><input aria-label={translate('files:searchText')} autoFocus value={query} disabled={busy} maxLength={512} onChange={event => setQuery(event.target.value)} required /><Button type="submit" color="primary" isDisabled={busy || !query || !root || opening}>{translate('files:search')}</Button>{busy && <Button variant="light" onPress={cancel}>{translate('files:cancel')}</Button>}</div>
      <div className="button-row"><label className="checkbox-label"><input type="checkbox" checked={caseSensitive} disabled={busy} onChange={event => setCaseSensitive(event.target.checked)} />{translate('files:matchCase')}</label><label className="checkbox-label"><input type="checkbox" checked={regex} disabled={busy} onChange={event => setRegex(event.target.checked)} />{translate('files:regularExpression')}</label></div>
      <details><summary>{translate('files:exclusionRules')}</summary><textarea aria-label={translate('files:exclusionRulesOneRelativePathOrFilenameWildcard')} value={exclude} disabled={busy} rows={3} onChange={event => setExclude(event.target.value)} maxLength={8192} /></details>
      <ErrorNotice message={error} onDismiss={() => setError('')} />
      {busy && <p className="muted" role="status">{translate('files:searching')}</p>}
      {result && <>
        <div className="session-status" role="status">{matches.length} {translate('files:resultsScanned')}{result.scanned} {translate('files:items')}{result.skipped_large > 0 && translate('files:skippedLargeFiles', { value1: result.skipped_large })}{result.skipped_binary > 0 && translate('files:skippedBinaryOrNonUTF8Files', { value1: result.skipped_binary })}{result.failed > 0 && translate('files:itemsCouldNotBeSearched', { value1: result.failed })}</div>
        {result.stop_reason && <p role="status" className="error">{errorMessage(result.stop_message || result.stop_reason)}</p>}
        {!!issues.length && <details><summary>{translate('files:incompleteItems')}{result.failed > issues.length ? translate('files:firstItemsShown', { value1: issues.length }) : ''}</summary>{issues.map((issue, index) => <p key={index} className="error file-path">{issue.path} · {errorMessage(eventError(issue))}</p>)}</details>}
        <div className="file-search-results" aria-label={translate('files:remoteFileSearchResults')}>{matches.map((match, index) => <button type="button" key={`${match.path}:${match.line}:${index}`} disabled={opening} onClick={() => void open(match)}><span className="file-path">{match.path}{match.directory ? '/' : match.line ? `:${match.line}` : ''}</span>{match.text && <code>{match.text}</code>}</button>)}</div>
      </>}
    </ModalBody><ModalFooter><Button variant="light" onPress={onClose}>{translate('files:close')}</Button></ModalFooter></form>
  </ModalContent></Modal>;
}
