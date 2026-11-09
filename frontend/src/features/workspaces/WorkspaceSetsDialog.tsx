import Modal from '../../components/Modal';
import { t as translate, currentLocale } from '../../i18n/index.ts';
import { useMessageState } from '../../i18n/useMessageState.ts';
import { useTranslation } from 'react-i18next';
import { useEffect, useRef, useState } from 'react';
import { Button, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react';
import { DeleteWorkspaceSet, ListWorkspaceSets, SaveWorkspaceSet } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { WorkspaceLayout, WorkspaceSet } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import type { Connection } from '../../../bindings/github.com/Sanjeever/termquay/internal/store/models';
import ErrorNotice from '../../components/ErrorNotice';


export default function WorkspaceSetsDialog({ layout, localCount, connections, onOpen, onClose }: { layout: WorkspaceLayout; localCount: number; connections: Connection[]; onOpen(layout: WorkspaceLayout): Promise<void>; onClose(): void }) {
  useTranslation();
  const [items, setItems] = useState<WorkspaceSet[]>([]);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useMessageState('');
  const [editing, setEditing] = useState<{ id: string; name: string }>();
  const [confirmation, setConfirmation] = useState<{ id: string; kind: 'update' | 'delete' }>();
  const mounted = useRef(true);
  const entries = layout.entries || [];
  useEffect(() => {
    mounted.current = true;
    let ended = false;
    setLoading(true); setReady(false); setError('');
    const request = ListWorkspaceSets();
    request.then(values => { if (!ended) { setItems(values || []); setReady(true); } }).catch(e => { if (!ended) setError(e); }).finally(() => { if (!ended) setLoading(false); });
    return () => { ended = true; mounted.current = false; request.cancel(); };
  }, [revision]);

  async function save(id: string, title: string, source: WorkspaceLayout) {
    if (busy || !ready) return;
    setBusy(true); setError('');
    try {
      const value = await SaveWorkspaceSet(id, title, source);
      if (!mounted.current) return;
      setItems(previous => previous.some(item => item.id === value.id) ? previous.map(item => item.id === value.id ? value : item) : [...previous, value]);
      setEditing(undefined); setConfirmation(undefined);
      if (!id) setName('');
    } catch (e) { if (mounted.current) setError(e); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function remove(id: string) {
    if (busy) return;
    setBusy(true); setError('');
    try { await DeleteWorkspaceSet(id); if (mounted.current) { setItems(previous => previous.filter(item => item.id !== id)); setConfirmation(undefined); } }
    catch (e) { if (mounted.current) setError(e); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function open(item: WorkspaceSet) {
    if (busy) return;
    setBusy(true); setError('');
    try { await onOpen(item.layout); if (mounted.current) onClose(); }
    catch (e) { if (mounted.current) setError(e); }
    finally { if (mounted.current) setBusy(false); }
  }
  return <Modal isOpen onClose={() => { if (!busy) onClose(); }} isDismissable={!busy} isKeyboardDismissDisabled={busy} size="3xl" scrollBehavior="inside" className="app-dialog workspace-sets-dialog"><ModalContent><ModalHeader>{translate('workspaces:namedWorkingSets')}</ModalHeader><ModalBody>
    <form className="workspace-set-save" onSubmit={event => { event.preventDefault(); void save('', name, layout); }}><input aria-label={translate('workspaces:newWorkingSetName')} placeholder={translate('workspaces:workingSetName')} value={name} onChange={event => setName(event.target.value)} maxLength={128} disabled={busy || !ready} /><Button type="submit" color="primary" size="sm" isDisabled={busy || !ready || !entries.length || !name.trim()}>{translate('workspaces:saveCurrentLayout')}</Button></form>
    <div className="session-status">{translate('workspaces:currentLayoutContains')}{entries.length} {translate('workspaces:remoteWorkspaces')}{localCount > 0 && translate('workspaces:localTerminalsWillNotBeIncluded', { value1: localCount })}</div>
    <ErrorNotice message={error} onDismiss={() => setError('')}>{!ready && !loading && <button className="session-tool" onClick={() => setRevision(value => value + 1)}>{translate('workspaces:reload')}</button>}</ErrorNotice>
    {loading && <p className="muted" role="status">{translate('workspaces:readingWorkingSets')}</p>}
    {ready && !items.length && <p className="sidebar-empty">{translate('workspaces:noWorkingSets')}</p>}
    <div className="workspace-set-list">{items.map(item => <section className="workspace-set-item" key={item.id}>
      <div className="workspace-set-heading">{editing?.id === item.id ? <form className="workspace-set-rename" onSubmit={event => { event.preventDefault(); void save(item.id, editing.name, item.layout); }}><input aria-label={translate('workspaces:workingSetName')} autoFocus value={editing.name} maxLength={128} disabled={busy} onChange={event => setEditing({ id: item.id, name: event.target.value })} onKeyDown={event => { if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); setEditing(undefined); } }} /><Button size="sm" type="submit" isDisabled={busy || !editing.name.trim()}>{translate('workspaces:save')}</Button><Button size="sm" variant="light" isDisabled={busy} onPress={() => setEditing(undefined)}>{translate('workspaces:cancel')}</Button></form> : <><strong>{item.name}</strong><Button size="sm" color="primary" variant="flat" isDisabled={busy || !ready} onPress={() => void open(item)}>{translate('workspaces:open')}</Button><Button size="sm" variant="light" isDisabled={busy || !ready} onPress={() => { setConfirmation(undefined); setEditing({ id: item.id, name: item.name }); }}>{translate('workspaces:rename')}</Button><Button size="sm" variant="light" isDisabled={busy || !ready || !entries.length} onPress={() => { setEditing(undefined); setConfirmation({ id: item.id, kind: 'update' }); }}>{translate('workspaces:updateLayout')}</Button><Button size="sm" variant="light" color="danger" isDisabled={busy || !ready} onPress={() => { setEditing(undefined); setConfirmation({ id: item.id, kind: 'delete' }); }}>{translate('workspaces:delete')}</Button></>}</div>
      <details className="workspace-set-entries"><summary>{item.layout.entries?.length || 0} {translate('workspaces:workspaces')}{new Date(item.updated_at).toLocaleString(currentLocale())}</summary><ul>{(item.layout.entries || []).map(entry => <li key={entry.id}><strong>{entry.name}</strong><span className="muted">{entry.target.protocol.toUpperCase()} · {entry.target.username}@{entry.target.host}:{entry.target.port}{entry.ssh && translate('workspaces:files', { value1: (entry.ssh.tabs || []).filter(tab => tab.kind === 'file').length })}{entry.connection_id ? connections.some(connection => connection.id === entry.connection_id) ? '' : translate('workspaces:savedConfigurationDeleted') : translate('workspaces:authenticationRequiredWhenConnecting')}</span></li>)}</ul></details>
      {confirmation?.id === item.id && <div className="workspace-set-confirm"><span>{confirmation.kind === 'delete' ? translate('workspaces:deleteWorkingSet', { value1: item.name }) : translate('workspaces:updateWithTheCurrentRemoteWorkspaces', { value1: entries.length, value2: item.name })}</span><Button size="sm" variant="light" isDisabled={busy} onPress={() => setConfirmation(undefined)}>{translate('workspaces:cancel')}</Button><Button size="sm" color={confirmation.kind === 'delete' ? 'danger' : 'primary'} isDisabled={busy} onPress={() => { if (confirmation.kind === 'delete') void remove(item.id); else void save(item.id, item.name, layout); }}>{translate('workspaces:confirm')}{confirmation.kind === 'delete' ? translate('workspaces:delete') : translate('workspaces:update')}</Button></div>}
    </section>)}</div>
    {!!items.length && <p className="muted">{translate('workspaces:openingAppendsDisconnectedWorkspacesConnectFromEachWorkspace')}</p>}
  </ModalBody><ModalFooter><Button variant="light" isDisabled={busy} onPress={onClose}>{translate('workspaces:close')}</Button></ModalFooter></ModalContent></Modal>;
}
