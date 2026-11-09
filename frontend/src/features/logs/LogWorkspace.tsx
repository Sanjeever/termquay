import { t as translate } from '../../i18n/index.ts';
import { message as uiMessage } from '../../i18n/messages.ts';
import { useMessageState } from '../../i18n/useMessageState.ts';
import { useTranslation } from 'react-i18next';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@heroui/react';
import { Events } from '@wailsio/runtime';
import { ListContainers, ListLogViewPresets } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { Container } from '../../../bindings/github.com/Sanjeever/termquay/internal/docker/models';
import type { LogViewPreset } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import ErrorNotice from '../../components/ErrorNotice';
import SelectControl from '../../components/SelectControl';

import { defaultLogViewOptions } from '../files/logView';
import LogSourcePane, { type LogSource } from './LogSourcePane';
import '../../styles/log-workspace.css';

type Target = { id: string; name: string; address: string };
const sourceLimit = 4;

export default function LogWorkspace({ open, targets, initial, request }: { open: boolean; targets: Target[]; initial?: string; request?: LogSource }) {
  useTranslation();
  const [sources, setSources] = useState<LogSource[]>([]);
  const lastRequest = useRef<string>();
  const [adding, setAdding] = useState(true);
  const [workspace, setWorkspace] = useState(initial || targets[0]?.id || '');
  const [kind, setKind] = useState<LogSource['kind']>('file');
  const [target, setTarget] = useState('');
  const [socket, setSocket] = useState('/var/run/docker.sock');
  const [containers, setContainers] = useState<Container[]>([]);
  const [containerRefresh, setContainerRefresh] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useMessageState('');
  const [options, setOptions] = useState({ ...defaultLogViewOptions });
  const [presets, setPresets] = useState<LogViewPreset[]>([]);
  const [presetError, setPresetError] = useMessageState('');
  const [follow, setFollow] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [visible, setVisible] = useState(document.visibilityState === 'visible');
  const [minimised, setMinimised] = useState(false);
  const active = open && visible && !minimised;
  const live = targets.some(item => item.id === workspace);
  useEffect(() => {
    if (!request || lastRequest.current === request.id) return;
    lastRequest.current = request.id;
    if (sources.some(item => item.workspace === request.workspace && item.kind === request.kind && item.target === request.target && item.socket === request.socket)) { setAdding(false); return; }
    if (sources.length >= sourceLimit) { setError(uiMessage('docker:logSourceLimit')); setAdding(true); return; }
    setSources(previous => [...previous, request]); setAdding(false); setError('');
  }, [request]);
  useEffect(() => { const update = () => setVisible(document.visibilityState === 'visible'); document.addEventListener('visibilitychange', update); return () => document.removeEventListener('visibilitychange', update); }, []);
  useEffect(() => { const off = [Events.On(Events.Types.Common.WindowMinimise, () => setMinimised(true)), Events.On(Events.Types.Common.WindowUnMinimise, () => setMinimised(false)), Events.On(Events.Types.Common.WindowRestore, () => setMinimised(false))]; return () => off.forEach(dispose => dispose()); }, []);
  useEffect(() => {
    if (!active) return;
    let ended = false;
    const request = ListLogViewPresets();
    request.then(values => { if (!ended) { setPresets(values || []); setPresetError(''); } }).catch(e => { if (!ended) setPresetError(e); });
    return () => { ended = true; request.cancel(); };
  }, [active]);
  useEffect(() => { setTarget(''); setContainers([]); setError(''); }, [workspace, kind, socket]);
  useEffect(() => {
    if (!active || !adding || !live || kind !== 'container') { setLoading(false); return; }
    let ended = false;
    setLoading(true); setError(''); setContainers([]);
    const request = ListContainers(workspace, socket);
    request.then(values => { if (!ended) setContainers(values || []); }).catch(e => { if (!ended) setError(e); }).finally(() => { if (!ended) setLoading(false); });
    return () => { ended = true; request.cancel(); };
  }, [active, adding, live, workspace, kind, socket, containerRefresh]);
  function addSource() {
    const selected = targets.find(item => item.id === workspace);
    if (!selected || sources.length >= sourceLimit) return;
    const value = target.trim();
    if (!value || value.includes('\0') || (kind === 'file' && !value.startsWith('/')) || (kind === 'service' && !value.endsWith('.service'))) { setError(kind === 'file' ? uiMessage('logs:enterAnAbsoluteLogFilePath') : uiMessage('logs:enterTheFullServiceUnitNameService')); return; }
    if (sources.some(item => item.workspace === workspace && item.kind === kind && item.target === value && (kind !== 'container' || item.socket === socket))) { setError(uiMessage('logs:thisLogSourceIsAlreadyAdded')); return; }
    const container = kind === 'container' ? containers.find(item => item.id === value) : undefined;
    if (kind === 'container' && !container) { setError(uiMessage('logs:selectAContainerFromTheCurrentList')); return; }
    setSources(previous => [...previous, { id: crypto.randomUUID(), workspace, host: `${selected.name} · ${selected.address}`, kind, target: value, name: container?.name || (kind === 'file' ? value.split('/').pop()! : value), socket }]);
    setTarget(''); setError(''); setAdding(false);
  }
  return <div className="log-workspace">
    <div className="log-workspace-toolbar"><Button size="sm" variant="light" isDisabled={sources.length >= sourceLimit} aria-expanded={adding} onPress={() => setAdding(value => !value)}>{translate('logs:addSource')}</Button><Button size="sm" variant="light" isDisabled={!sources.length} onPress={() => setRefresh(value => value + 1)}>{translate('logs:readAgain')}</Button><label className="checkbox-label"><input type="checkbox" checked={follow} onChange={event => setFollow(event.target.checked)} />{translate('logs:follow')}</label><span className="session-status">{sources.length} / {sourceLimit} {translate('logs:sources')}</span></div>
    {adding && <form className="log-source-form" onSubmit={event => { event.preventDefault(); addSource(); }}>
      <label className="form-field">{translate('logs:sSHWorkspace')}<SelectControl value={workspace} onChange={event => setWorkspace(event.target.value)}><option value="">{translate('logs:selectWorkspace')}</option>{targets.map(item => <option key={item.id} value={item.id}>{item.name} · {item.address}</option>)}</SelectControl></label>
      <label className="form-field">{translate('logs:source')}<SelectControl value={kind} onChange={event => setKind(event.target.value as LogSource['kind'])}><option value="file">{translate('logs:logFile')}</option><option value="service">{translate('logs:systemdService')}</option><option value="container">{translate('logs:dockerContainer')}</option></SelectControl></label>
      {kind === 'container' && <label className="form-field">Docker socket<input value={socket} maxLength={4096} onChange={event => setSocket(event.target.value)} /></label>}
      <label className="form-field log-source-target">{kind === 'file' ? translate('logs:filePath') : kind === 'service' ? translate('logs:serviceUnit') : translate('logs:container')}{kind === 'container' ? <SelectControl value={target} disabled={loading} onChange={event => setTarget(event.target.value)}><option value="">{loading ? translate('logs:reading') : translate('logs:selectContainer')}</option>{containers.map(item => <option key={item.id} value={item.id}>{item.name} · {item.state}</option>)}</SelectControl> : <input value={target} maxLength={kind === 'file' ? 4096 : 256} onChange={event => setTarget(event.target.value)} required />}</label>
      {kind === 'container' && <Button size="sm" variant="light" isDisabled={!live || loading} onPress={() => setContainerRefresh(value => value + 1)}>{translate('logs:refreshContainers')}</Button>}
      <Button size="sm" color="primary" type="submit" isDisabled={!live || !target.trim() || loading || sources.length >= sourceLimit}>{translate('logs:add')}</Button>
      <ErrorNotice message={error} />{!targets.length && <p className="session-status">{translate('logs:openAnSSHConnectionFirst')}</p>}
    </form>}
    <div className="remote-log-filters log-workspace-filters">{(['filter', 'exclude', 'highlight'] as const).map(field => <input key={field} aria-label={{ filter: translate('logs:filterLogsAlreadyReadFromAllSources'), exclude: translate('logs:excludeLogLinesFromAllSources'), highlight: translate('logs:highlightKeywordsAcrossAllSources') }[field]} placeholder={{ filter: translate('logs:filterReadContent'), exclude: translate('logs:exclude'), highlight: translate('logs:highlight') }[field]} value={options[field]} maxLength={128} onChange={event => setOptions(previous => ({ ...previous, [field]: event.target.value }))} />)}</div>
    <div className="log-workspace-toolbar"><label className="checkbox-label"><input type="checkbox" checked={options.regex} onChange={event => setOptions(previous => ({ ...previous, regex: event.target.checked }))} />{translate('logs:regex')}</label><label className="checkbox-label"><input type="checkbox" checked={options.case_sensitive} onChange={event => setOptions(previous => ({ ...previous, case_sensitive: event.target.checked }))} />{translate('logs:matchCase')}</label><label className="checkbox-label"><input type="checkbox" checked={options.format_json} onChange={event => setOptions(previous => ({ ...previous, format_json: event.target.checked }))} />{translate('logs:formatJSON')}</label><label className="checkbox-label">{translate('logs:context')}<SelectControl aria-label={translate('logs:matchingContextLinesForAllSources')} value={options.context_lines} onChange={event => setOptions(previous => ({ ...previous, context_lines: Number(event.target.value) }))}>{[0, 1, 3, 5, 10].map(value => <option key={value} value={value}>{value} {translate('logs:lines')}</option>)}</SelectControl></label>{!!presets.length && <SelectControl aria-label={translate('logs:reuseLogRules')} value="" onChange={event => { const item = presets.find(value => value.id === event.target.value); if (item) setOptions({ filter: item.filter, exclude: item.exclude, highlight: item.highlight, regex: item.regex, case_sensitive: item.case_sensitive, context_lines: item.context_lines, format_json: item.format_json }); }}><option value="">{translate('logs:reuseRules')}</option>{presets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</SelectControl>}</div>
    <ErrorNotice message={presetError} />
    <div className="log-workspace-panes">{sources.map(source => <LogSourcePane key={source.id} source={source} active={active} live={targets.some(item => item.id === source.workspace)} follow={follow} refresh={refresh} options={options} onRemove={() => { setSources(previous => previous.filter(item => item.id !== source.id)); if (sources.length === 1) setAdding(true); }} />)}</div>
  </div>;
}
