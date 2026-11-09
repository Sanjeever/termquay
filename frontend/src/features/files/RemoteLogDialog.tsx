import Modal from '../../components/Modal';
import { t as translate } from '../../i18n/index.ts';
import { message as uiMessage } from '../../i18n/messages.ts';
import { useMessageState } from '../../i18n/useMessageState.ts';
import { useTranslation } from 'react-i18next';
import { eventError } from '../../lib/errors.ts';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react';
import { ReadRemoteLog, ListLogViewPresets, SaveLogViewPreset, DeleteLogViewPreset } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { RemoteLogSlice, LogViewPreset } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import ErrorNotice from '../../components/ErrorNotice';
import SelectControl from '../../components/SelectControl';
import { bytes } from './transferFormat';
import { defaultLogViewOptions, retainLogTail, type LogViewOptions, type LogViewResult } from './logView';

export default function RemoteLogDialog({ workspace, path, visible, onClose }: { workspace: string; path: string; visible: boolean; onClose(): void }) {
  useTranslation();
  const [slice, setSlice] = useState<RemoteLogSlice>();
  const [follow, setFollow] = useState(false);
  const [error, setError] = useMessageState('');
  const [busy, setBusy] = useState(false);
  const [options, setOptions] = useState<LogViewOptions>(defaultLogViewOptions);
  const [view, setView] = useState<LogViewResult>();
  const [filterError, setFilterError] = useMessageState('');
  const [filtering, setFiltering] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const scrolling = useRef(autoScroll); scrolling.current = autoScroll;
  const [unread, setUnread] = useState(0);
  const [unreadBytes, setUnreadBytes] = useState(0);
  const [trimmed, setTrimmed] = useState(false);
  const [presets, setPresets] = useState<LogViewPreset[]>([]);
  const [presetID, setPresetID] = useState('');
  const [presetName, setPresetName] = useState('');
  const [presetError, setPresetError] = useMessageState('');
  const [savingPreset, setSavingPreset] = useState(false);
  const [deletingPreset, setDeletingPreset] = useState(false);
  const worker = useRef<Worker>();
  const active = useRef(visible); active.current = visible;
  const current = useRef(slice); current.current = slice;
  const mounted = useRef(true);
  const pending = useRef<ReturnType<typeof ReadRemoteLog>>();
  const content = useRef<HTMLDivElement>(null);
  async function load(kind: 'refresh' | 'older' | 'append') {
    if (pending.current) return;
    setBusy(true); setError('');
    const before = current.current;
    const request = ReadRemoteLog(workspace, path, kind === 'refresh' ? -1 : kind === 'older' ? before?.start || 0 : before?.end || 0, kind === 'older'); pending.current = request;
    try {
      const value = await request; if (!mounted.current || pending.current !== request) return;
      if (kind === 'append' && before && !value.reset && value.start === before.end) {
        const retained = retainLogTail(before.content + value.content);
        setSlice({ ...value, start: before.start + retained.removedBytes, content: retained.content });
        if (retained.removedBytes) setTrimmed(true);
        if (!scrolling.current && value.content) { setUnread(previous => previous + (value.content.match(/\n/g)?.length || 0)); setUnreadBytes(previous => previous + value.end - value.start); }
      } else {
        const retained = retainLogTail(value.content);
        setSlice({ ...value, start: value.start + retained.removedBytes, content: retained.content });
        setTrimmed(retained.removedBytes > 0); setUnread(0); setUnreadBytes(0);
        if (kind === 'older') setAutoScroll(false);
      }
    } catch (e) { if (mounted.current && active.current && pending.current === request) { setError(e); setFollow(false); } }
    finally { if (pending.current === request) { pending.current = undefined; if (mounted.current) setBusy(false); } }
  }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; pending.current?.cancel(); pending.current = undefined; worker.current?.terminate(); }; }, [workspace, path]);
  useEffect(() => { if (!visible) pending.current?.cancel(); else if (!current.current) void load('refresh'); }, [visible, workspace, path]);
  useEffect(() => { if (!follow || !visible) return; const timer = setInterval(() => void load('append'), 2000); return () => clearInterval(timer); }, [follow, visible, workspace, path]);
  useEffect(() => {
    const request = ListLogViewPresets(); let disposed = false;
    request.then(values => { if (!disposed) setPresets(values || []); }).catch(e => { if (!disposed) setPresetError(e); });
    return () => { disposed = true; request.cancel(); };
  }, []);
  useEffect(() => {
    if (!visible) { worker.current?.terminate(); worker.current = undefined; return; }
    let disposed = false, inFlight = false;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    setFiltering(true); setFilterError('');
    const delay = setTimeout(() => {
      const fail = (message: unknown) => { if (disposed) return; inFlight = false; clearTimeout(deadline); worker.current?.terminate(); worker.current = undefined; setView(undefined); setFilterError(message); setFiltering(false); };
      try {
        if (!worker.current) worker.current = new Worker(new URL('./logView.worker.ts', import.meta.url), { type: 'module' });
        worker.current.onmessage = (event: MessageEvent<LogViewResult>) => { if (disposed) return; inFlight = false; clearTimeout(deadline); setView(event.data.error ? undefined : event.data); setFilterError(eventError(event.data) ? uiMessage('files:invalidFilterExpression', { value1: eventError(event.data) }) : ''); setFiltering(false); };
        worker.current.onerror = event => { event.preventDefault(); fail(uiMessage('files:couldNotProcessLogs', { value1: event.message })); };
        inFlight = true;
        worker.current.postMessage({ content: slice?.content || '', options });
        deadline = setTimeout(() => fail(uiMessage('files:logProcessingTimedOutSimplifyTheExpressionOr')), 1000);
      } catch (e) { fail(e); }
    }, 150);
    return () => { disposed = true; clearTimeout(delay); clearTimeout(deadline); if (inFlight) { worker.current?.terminate(); worker.current = undefined; } };
  }, [slice?.content, options, visible]);
  useLayoutEffect(() => { if (autoScroll && visible && content.current) content.current.scrollTop = content.current.scrollHeight; }, [view, autoScroll, visible]);
  function resumeScroll() { setAutoScroll(true); setUnread(0); setUnreadBytes(0); }
  async function savePreset() {
    setSavingPreset(true); setPresetError('');
    try { const item = await SaveLogViewPreset({ id: presetID, name: presetName, ...options }); if (mounted.current) { setPresets(previous => [...previous.filter(value => value.id !== item.id), item]); setPresetID(item.id); setPresetName(item.name); } }
    catch (e) { if (mounted.current) setPresetError(e); }
    finally { if (mounted.current) setSavingPreset(false); }
  }
  async function deletePreset() {
    if (!deletingPreset) { setDeletingPreset(true); return; }
    setSavingPreset(true); setPresetError('');
    try { await DeleteLogViewPreset(presetID); if (mounted.current) { setPresets(previous => previous.filter(item => item.id !== presetID)); setPresetID(''); setPresetName(''); setDeletingPreset(false); } }
    catch (e) { if (mounted.current) setPresetError(e); }
    finally { if (mounted.current) setSavingPreset(false); }
  }
  const rows = useMemo(() => view?.rows.map((row, index) => {
    let position = 0;
    const parts = row.highlights.flatMap((highlight, match) => { const previous = row.text.slice(position, highlight.start); position = highlight.end; return [previous, <mark key={match}>{row.text.slice(highlight.start, highlight.end)}</mark>]; });
    return <div key={index}>{row.gap && <div className="remote-log-gap">···</div>}{parts}{row.text.slice(position) || (row.text ? '' : '\n')}</div>;
  }), [view]);
  return <Modal isOpen onClose={onClose} size="5xl" className="app-dialog remote-log-dialog" scrollBehavior="inside"><ModalContent><ModalHeader>{path.split('/').pop()}</ModalHeader><ModalBody>
    <div className="button-row"><Button size="sm" variant="light" isDisabled={busy || !slice?.start} onPress={() => { setFollow(false); void load('older'); }}>{translate('files:earlierContent')}</Button><Button size="sm" variant="light" isLoading={busy} onPress={() => { resumeScroll(); void load('refresh'); }}>{translate('files:readTail')}</Button><label className="checkbox-label"><input type="checkbox" checked={follow} onChange={event => setFollow(event.target.checked)}/>{translate('files:followAppendedContent')}</label><Button size="sm" variant="light" aria-pressed={!autoScroll} onPress={() => autoScroll ? setAutoScroll(false) : resumeScroll()}>{autoScroll ? translate('files:pauseScrolling') : unreadBytes ? translate('files:viewNewLines', { value1: unread + (slice?.content.endsWith('\n') ? 0 : 1) }) : translate('files:scrollToLatest')}</Button></div>
    <div className="remote-log-filters"><input aria-label={translate('files:filterLogLinesAlreadyRead')} placeholder={translate('files:filterReadContent')} value={options.filter} onChange={event => setOptions(previous => ({ ...previous, filter: event.target.value }))} maxLength={128}/><input aria-label={translate('files:excludeLogLines')} placeholder={translate('files:exclude')} value={options.exclude} onChange={event => setOptions(previous => ({ ...previous, exclude: event.target.value }))} maxLength={128}/><input aria-label={translate('files:highlightLogKeywords')} placeholder={translate('files:highlight')} value={options.highlight} onChange={event => setOptions(previous => ({ ...previous, highlight: event.target.value }))} maxLength={128}/></div>
    <div className="button-row"><label className="checkbox-label"><input type="checkbox" checked={options.regex} onChange={event => setOptions(previous => ({ ...previous, regex: event.target.checked }))}/>{translate('files:regexp')}</label><label className="checkbox-label"><input type="checkbox" checked={options.case_sensitive} onChange={event => setOptions(previous => ({ ...previous, case_sensitive: event.target.checked }))}/>{translate('files:matchCase')}</label><label className="checkbox-label"><input type="checkbox" checked={options.format_json} onChange={event => setOptions(previous => ({ ...previous, format_json: event.target.checked }))}/>{translate('files:formatJSON')}</label><label className="checkbox-label">{translate('files:context')}<SelectControl aria-label={translate('files:matchingContextLines')} value={options.context_lines} onChange={event => setOptions(previous => ({ ...previous, context_lines: Number(event.target.value) }))}>{[0, 1, 3, 5, 10].map(value => <option key={value} value={value}>{value} {translate('files:lines')}</option>)}</SelectControl></label></div>
    <details><summary>{translate('files:saveAndReuseRules')}</summary><div className="button-row"><SelectControl aria-label={translate('files:savedLogRules')} disabled={savingPreset} value={presetID} onChange={event => { const item = presets.find(value => value.id === event.target.value); setPresetID(item?.id || ''); setPresetName(item?.name || ''); setDeletingPreset(false); if (item) setOptions({ filter: item.filter, exclude: item.exclude, highlight: item.highlight, regex: item.regex, case_sensitive: item.case_sensitive, context_lines: item.context_lines, format_json: item.format_json }); }}><option value="">{translate('files:newRule')}</option>{presets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</SelectControl><input aria-label={translate('files:logRuleName')} placeholder={translate('files:ruleName')} maxLength={128} disabled={savingPreset} value={presetName} onChange={event => { setPresetName(event.target.value); setDeletingPreset(false); }}/><Button size="sm" variant="light" isLoading={savingPreset} isDisabled={!presetName.trim() || !!filterError || filtering} onPress={() => void savePreset()}>{presetID ? translate('files:updateRule') : translate('files:saveRule')}</Button>{presetID && <Button size="sm" variant="light" color="danger" isDisabled={savingPreset} onPress={() => void deletePreset()}>{deletingPreset ? translate('files:confirmDeletingRule') : translate('files:deleteRule')}</Button>}</div><ErrorNotice message={presetError} onDismiss={() => setPresetError('')}/></details>
    <p className="file-path">{path}</p><ErrorNotice message={error} onDismiss={()=>setError('')}/>
    <ErrorNotice message={filterError}/>
    <div className="remote-log-content" ref={content} role="region" aria-label={translate('files:logContentAlreadyRead')} aria-busy={filtering} tabIndex={0} onScroll={event => { const node = event.currentTarget; if (node.scrollHeight - node.scrollTop - node.clientHeight > 12) setAutoScroll(false); else if (!filtering) resumeScroll(); }}>{rows}</div>
    <div className="session-status">{translate('files:bytes3')}{slice?.start || 0}–{slice?.end || 0} / {slice?.size || 0}{filtering ? translate('files:filtering') : view && translate('files:readLinesMatched', { value1: view.scanned, value2: view.matched })}{unreadBytes > 0 && translate('files:unread', { value1: bytes(unreadBytes) })}{trimmed && translate('files:earlierContentEvictedFromCache')}{view?.truncated && translate('files:displayLimitReached')}{view?.highlightLimited && translate('files:highlightLimitReached')}{!!view?.unformatted && translate('files:jSONLinesCouldNotBeFormattedAndRetain', { value1: view.unformatted })}</div>
  </ModalBody><ModalFooter><Button variant="light" onPress={onClose}>{translate('files:close')}</Button></ModalFooter></ModalContent></Modal>;
}
