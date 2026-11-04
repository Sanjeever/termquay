import { useState } from 'react';
import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react';
import { DeleteTunnelPreset, ListServiceEntries, SaveTunnelPreset } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { TunnelPreset } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import type { Connection } from '../../../bindings/github.com/Sanjeever/termquay/internal/store/models';
import ErrorNotice from '../../components/ErrorNotice';
import SelectControl from '../../components/SelectControl';
import { errorMessage } from '../../lib/errors';

const emptyService = (connection: string): TunnelPreset => ({ name: '', connection_id: connection, auto_start: false, service_type: 'http', url_path: '/', spec: { kind: 'local', bind_host: '127.0.0.1', bind_port: 0, target_host: '127.0.0.1', target_port: 8080, allow_public: false } });

export default function ServicesDialog({ entries, connections, initial, error: loadError, onChanged, onOpen, onClose }: {
  entries: TunnelPreset[]; connections: Connection[]; initial?: string; error: string;
  onChanged(entries: TunnelPreset[]): void; onOpen(entry: TunnelPreset): Promise<void>; onClose(): void;
}) {
  const hosts = connections.filter(c => c.protocol === 'ssh');
  const [draft, setDraft] = useState(() => emptyService(initial || hosts[0]?.id || ''));
  const [editing, setEditing] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [discard, setDiscard] = useState(false);
  const [removing, setRemoving] = useState<TunnelPreset>();
  const [baseline, setBaseline] = useState(() => JSON.stringify(draft));
  const dirty = JSON.stringify(draft) !== baseline;
  function choose(entry?: TunnelPreset) {
    const next = entry || emptyService(draft.connection_id);
    setDraft(next); setEditing(entry ? `${entry.connection_id}\0${entry.name}` : ''); setBaseline(JSON.stringify(next)); setError('');
  }
  async function save() {
    setBusy(true); setError('');
    try { await SaveTunnelPreset(draft); onChanged(await ListServiceEntries() || []); setEditing(`${draft.connection_id}\0${draft.name.trim()}`); setDraft({ ...draft, name: draft.name.trim() }); setBaseline(JSON.stringify({ ...draft, name: draft.name.trim() })); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }
  return <Modal isOpen onClose={() => { if (!busy) { if (dirty) setDiscard(true); else onClose(); } }} isDismissable={!busy} isKeyboardDismissDisabled={busy} size="3xl" className="app-dialog" scrollBehavior="inside"><ModalContent><ModalHeader>远端服务</ModalHeader><ModalBody>
    <ErrorNotice message={error || loadError} onDismiss={() => setError('')} />
    <div className="service-list">{entries.map(entry => <div className="tunnel-row" key={`${entry.connection_id}\0${entry.name}`}><span>{entry.name}<small>{hosts.find(c => c.id === entry.connection_id)?.name} · {entry.spec.target_host}:{entry.spec.target_port}{entry.url_path}</small></span><Button size="sm" variant="light" isDisabled={busy || dirty} onPress={() => choose(entry)}>编辑</Button><Button size="sm" variant="light" isDisabled={busy || dirty} onPress={() => setRemoving(entry)}>删除</Button><Button size="sm" isDisabled={busy || dirty} onPress={async () => { setBusy(true); setError(''); try { await onOpen(entry); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); } }}>{entry.service_type === 'address' ? '连接并复制地址' : '打开'}</Button></div>)}</div>
    <form id="service-editor" className="service-editor" onSubmit={event => { event.preventDefault(); void save(); }}>
      <label className="form-field">SSH 主机<SelectControl value={draft.connection_id} disabled={busy || !!editing} onChange={e => setDraft({ ...draft, connection_id: e.target.value })}>{hosts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</SelectControl></label>
      <label className="form-field">名称<input required maxLength={128} disabled={busy || !!editing} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
      <label className="form-field">目标主机<input required disabled={busy} value={draft.spec.target_host} onChange={e => setDraft({ ...draft, spec: { ...draft.spec, target_host: e.target.value } })} /></label>
      <label className="form-field">目标端口<input type="number" required min={1} max={65535} disabled={busy} value={draft.spec.target_port} onChange={e => setDraft({ ...draft, spec: { ...draft.spec, target_port: Number(e.target.value) } })} /></label>
      <label className="form-field">打开方式<SelectControl disabled={busy} value={draft.service_type} onChange={e => setDraft({ ...draft, service_type: e.target.value, url_path: e.target.value === 'address' ? '' : draft.url_path || '/' })}><option value="http">HTTP 浏览器</option><option value="https">HTTPS 浏览器</option><option value="address">复制隧道地址</option></SelectControl></label>
      <label className="form-field">本地端口（0 自动）<input type="number" required min={0} max={65535} disabled={busy} value={draft.spec.bind_port} onChange={e => setDraft({ ...draft, spec: { ...draft.spec, bind_port: Number(e.target.value) } })} /></label>
      {draft.service_type !== 'address' && <label className="form-field service-url">URL 路径<input maxLength={2048} disabled={busy} value={draft.url_path || ''} onChange={e => setDraft({ ...draft, url_path: e.target.value })} /></label>}
    </form>
    {removing && <div className="inline-confirm"><p>删除服务“{removing.name}”？运行中的隧道保留。</p><Button size="sm" variant="light" isDisabled={busy} onPress={() => setRemoving(undefined)}>取消</Button><Button size="sm" color="danger" isDisabled={busy} onPress={async () => { setBusy(true); try { await DeleteTunnelPreset(removing.connection_id, removing.name); onChanged(await ListServiceEntries() || []); if (editing === `${removing.connection_id}\0${removing.name}`) choose(); setRemoving(undefined); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); } }}>删除</Button></div>}
    {discard && <div className="inline-confirm"><p>放弃未保存的服务修改？</p><Button size="sm" variant="light" onPress={() => setDiscard(false)}>继续编辑</Button><Button size="sm" color="danger" onPress={onClose}>放弃并关闭</Button></div>}
  </ModalBody><ModalFooter><Button variant="light" isDisabled={busy || dirty} onPress={() => choose()}>新建</Button><Button form="service-editor" type="submit" color="primary" isDisabled={busy || !draft.connection_id || !draft.name.trim()}>{editing ? '保存修改' : '添加服务'}</Button></ModalFooter></ModalContent></Modal>;
}
