import { useEffect, useRef, useState } from 'react';
import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react';
import { DeleteWorkspaceSet, ListWorkspaceSets, SaveWorkspaceSet } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { WorkspaceLayout, WorkspaceSet } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import type { Connection } from '../../../bindings/github.com/Sanjeever/termquay/internal/store/models';
import ErrorNotice from '../../components/ErrorNotice';
import { errorMessage } from '../../lib/errors';

export default function WorkspaceSetsDialog({ layout, localCount, connections, onOpen, onClose }: { layout: WorkspaceLayout; localCount: number; connections: Connection[]; onOpen(layout: WorkspaceLayout): Promise<void>; onClose(): void }) {
  const [items, setItems] = useState<WorkspaceSet[]>([]);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<{ id: string; name: string }>();
  const [confirmation, setConfirmation] = useState<{ id: string; kind: 'update' | 'delete' }>();
  const mounted = useRef(true);
  const entries = layout.entries || [];
  useEffect(() => {
    mounted.current = true;
    let ended = false;
    setLoading(true); setReady(false); setError('');
    const request = ListWorkspaceSets();
    request.then(values => { if (!ended) { setItems(values || []); setReady(true); } }).catch(e => { if (!ended) setError(errorMessage(e)); }).finally(() => { if (!ended) setLoading(false); });
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
    } catch (e) { if (mounted.current) setError(errorMessage(e)); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function remove(id: string) {
    if (busy) return;
    setBusy(true); setError('');
    try { await DeleteWorkspaceSet(id); if (mounted.current) { setItems(previous => previous.filter(item => item.id !== id)); setConfirmation(undefined); } }
    catch (e) { if (mounted.current) setError(errorMessage(e)); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function open(item: WorkspaceSet) {
    if (busy) return;
    setBusy(true); setError('');
    try { await onOpen(item.layout); if (mounted.current) onClose(); }
    catch (e) { if (mounted.current) setError(errorMessage(e)); }
    finally { if (mounted.current) setBusy(false); }
  }
  return <Modal isOpen onClose={() => { if (!busy) onClose(); }} isDismissable={!busy} isKeyboardDismissDisabled={busy} size="3xl" scrollBehavior="inside" className="app-dialog workspace-sets-dialog"><ModalContent><ModalHeader>命名工作集</ModalHeader><ModalBody>
    <form className="workspace-set-save" onSubmit={event => { event.preventDefault(); void save('', name, layout); }}><input aria-label="新工作集名称" placeholder="工作集名称" value={name} onChange={event => setName(event.target.value)} maxLength={128} disabled={busy || !ready} /><Button type="submit" color="primary" size="sm" isDisabled={busy || !ready || !entries.length || !name.trim()}>保存当前布局</Button></form>
    <div className="session-status">当前布局包含 {entries.length} 个远程工作区{localCount > 0 && ` · ${localCount} 个本地终端不会加入工作集`}</div>
    <ErrorNotice message={error} onDismiss={() => setError('')}>{!ready && !loading && <button className="session-tool" onClick={() => setRevision(value => value + 1)}>重新读取</button>}</ErrorNotice>
    {loading && <p className="muted" role="status">正在读取工作集…</p>}
    {ready && !items.length && <p className="sidebar-empty">暂无工作集</p>}
    <div className="workspace-set-list">{items.map(item => <section className="workspace-set-item" key={item.id}>
      <div className="workspace-set-heading">{editing?.id === item.id ? <form className="workspace-set-rename" onSubmit={event => { event.preventDefault(); void save(item.id, editing.name, item.layout); }}><input aria-label="工作集名称" autoFocus value={editing.name} maxLength={128} disabled={busy} onChange={event => setEditing({ id: item.id, name: event.target.value })} onKeyDown={event => { if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); setEditing(undefined); } }} /><Button size="sm" type="submit" isDisabled={busy || !editing.name.trim()}>保存</Button><Button size="sm" variant="light" isDisabled={busy} onPress={() => setEditing(undefined)}>取消</Button></form> : <><strong>{item.name}</strong><Button size="sm" color="primary" variant="flat" isDisabled={busy || !ready} onPress={() => void open(item)}>打开</Button><Button size="sm" variant="light" isDisabled={busy || !ready} onPress={() => { setConfirmation(undefined); setEditing({ id: item.id, name: item.name }); }}>重命名</Button><Button size="sm" variant="light" isDisabled={busy || !ready || !entries.length} onPress={() => { setEditing(undefined); setConfirmation({ id: item.id, kind: 'update' }); }}>更新布局</Button><Button size="sm" variant="light" color="danger" isDisabled={busy || !ready} onPress={() => { setEditing(undefined); setConfirmation({ id: item.id, kind: 'delete' }); }}>删除</Button></>}</div>
      <details className="workspace-set-entries"><summary>{item.layout.entries?.length || 0} 个工作区 · {new Date(item.updated_at).toLocaleString()}</summary><ul>{(item.layout.entries || []).map(entry => <li key={entry.id}><strong>{entry.name}</strong><span className="muted">{entry.target.protocol.toUpperCase()} · {entry.target.username}@{entry.target.host}:{entry.target.port}{entry.ssh && ` · ${(entry.ssh.tabs || []).filter(tab => tab.kind === 'file').length} 个文件`}{entry.connection_id ? connections.some(connection => connection.id === entry.connection_id) ? '' : ' · 保存配置已删除' : ' · 连接时需填写认证'}</span></li>)}</ul></details>
      {confirmation?.id === item.id && <div className="workspace-set-confirm"><span>{confirmation.kind === 'delete' ? `删除工作集“${item.name}”？` : `用当前 ${entries.length} 个远程工作区更新“${item.name}”？`}</span><Button size="sm" variant="light" isDisabled={busy} onPress={() => setConfirmation(undefined)}>取消</Button><Button size="sm" color={confirmation.kind === 'delete' ? 'danger' : 'primary'} isDisabled={busy} onPress={() => { if (confirmation.kind === 'delete') void remove(item.id); else void save(item.id, item.name, layout); }}>确认{confirmation.kind === 'delete' ? '删除' : '更新'}</Button></div>}
    </section>)}</div>
    {!!items.length && <p className="muted">打开后追加工作区，保持断开，由各工作区选择连接。</p>}
  </ModalBody><ModalFooter><Button variant="light" isDisabled={busy} onPress={onClose}>关闭</Button></ModalFooter></ModalContent></Modal>;
}
