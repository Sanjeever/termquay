import { useEffect, useState } from 'react';
import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react';
import { GetConnectionPlaybook, SaveConnectionPlaybook, ListCommandTasks, ListSnippets, ListServiceEntries } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { ConnectionPlaybook, ConnectionResource } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import SelectControl from '../../components/SelectControl';
import { errorMessage } from '../../lib/errors';

const kinds: Record<string, string> = { file: '配置文件', directory: '目录', log: '日志', service: 'systemd 服务', container: 'Docker 容器', snippet: '命令片段', task: '多主机任务', tunnel: '远端服务' };
export default function ConnectionPlaybookDialog({ connection, onOpen, onClose }: { connection: { id: string; name: string; protocol: string }; onOpen(resource: ConnectionResource): Promise<void>; onClose(): void }) {
  const [book, setBook] = useState<ConnectionPlaybook>();
  const [saved, setSaved] = useState('');
  const [editing, setEditing] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [references, setReferences] = useState<Record<string, { id: string; name: string }[]>>({});
  useEffect(() => {
    let ended = false;
    const request = GetConnectionPlaybook(connection.id);
    request.then(value => { if (!ended) { setBook(value); setSaved(JSON.stringify(value)); setEditing(!value.notes && !value.resources?.length); } }).catch(e => { if (!ended) setError(errorMessage(e)); });
    return () => { ended = true; request.cancel(); };
  }, [connection.id]);
  useEffect(() => {
    if (!editing || connection.protocol !== 'ssh') return;
    let ended = false;
    const requests = [ListSnippets(), ListCommandTasks(), ListServiceEntries()] as const;
    Promise.all(requests).then(([snippets, tasks, tunnels]) => { if (!ended) setReferences({ snippet: snippets || [], task: tasks || [], tunnel: (tunnels || []).filter(item => item.connection_id === connection.id).map(item => ({ id: item.name, name: item.name })) }); }).catch(e => { if (!ended) setError(errorMessage(e)); });
    return () => { ended = true; requests.forEach(request => request.cancel()); };
  }, [editing, connection.id, connection.protocol]);
  const dirty = !!book && JSON.stringify(book) !== saved;
  function close() { if (busy) return; if (dirty) setDiscard(true); else onClose(); }
  function update(index: number, resource: ConnectionResource) { setBook(previous => previous && ({ ...previous, resources: previous.resources.map((item, i) => i === index ? resource : item) })); }
  async function save() {
    if (!book) return; setBusy(true); setError('');
    try { await SaveConnectionPlaybook(connection.id, book); setSaved(JSON.stringify(book)); setEditing(false); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  async function open(resource: ConnectionResource) {
    setBusy(true); setError('');
    try { await onOpen(resource); onClose(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  return <Modal isOpen size="3xl" scrollBehavior="inside" className="app-dialog" onClose={close} isDismissable={!busy}><ModalContent><ModalHeader>{connection.name} · 操作手册</ModalHeader><ModalBody>
    {error && <p className="error" role="alert">{error}</p>}
    {!book && !error && <p role="status">正在读取…</p>}
    {book && <>
      {editing ? <label className="form-field">备注<textarea rows={6} value={book.notes} maxLength={16384} disabled={busy} onChange={event => setBook({ ...book, notes: event.target.value })} /></label> : book.notes && <pre className="playbook-notes">{book.notes}</pre>}
      {book.resources.map((resource, index) => editing ? <div className="playbook-resource" key={index}>
        <input aria-label={`资源 ${index + 1} 名称`} placeholder="名称" maxLength={128} value={resource.name} disabled={busy} onChange={event => update(index, { ...resource, name: event.target.value })} />
        <SelectControl aria-label={`资源 ${index + 1} 类型`} value={resource.kind} disabled={busy} onChange={event => update(index, { ...resource, kind: event.target.value, target: '' })}>{Object.entries(kinds).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</SelectControl>
        {references[resource.kind] ? <SelectControl aria-label={`资源 ${index + 1} 目标`} value={resource.target} disabled={busy} onChange={event => update(index, { ...resource, target: event.target.value, name: resource.name || references[resource.kind].find(item => item.id === event.target.value)?.name || '' })}><option value="">选择目标</option>{resource.target && !references[resource.kind].some(item => item.id === resource.target) && <option value={resource.target}>原引用已失效</option>}{references[resource.kind].map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</SelectControl> : <input aria-label={`资源 ${index + 1} 目标`} placeholder={['file', 'directory', 'log'].includes(resource.kind) ? '绝对路径' : '服务名或容器名'} value={resource.target} maxLength={4096} disabled={busy} onChange={event => update(index, { ...resource, target: event.target.value })} />}
        <Button size="sm" variant="light" isDisabled={busy} onPress={() => setBook({ ...book, resources: book.resources.filter((_, i) => i !== index) })}>移除</Button>
      </div> : <button className="playbook-link" key={index} disabled={busy || connection.protocol !== 'ssh'} onClick={() => void open(resource)}><strong>{resource.name}</strong><span className="muted">{kinds[resource.kind]} · {['snippet', 'task'].includes(resource.kind) ? '' : resource.target}</span></button>)}
      {editing && connection.protocol === 'ssh' && <Button size="sm" variant="light" className="self-start" isDisabled={busy || book.resources.length >= 32} onPress={() => setBook({ ...book, resources: [...book.resources, { kind: 'file', name: '', target: '' }] })}>添加快捷资源</Button>}
      {discard && <section className="inspection-detail"><p>放弃未保存的操作手册修改？</p><div className="button-row"><Button size="sm" variant="light" onPress={() => setDiscard(false)}>继续编辑</Button><Button size="sm" color="danger" onPress={onClose}>放弃修改</Button></div></section>}
    </>}
  </ModalBody><ModalFooter>{editing ? <Button color="primary" isLoading={busy} isDisabled={!book || !dirty} onPress={() => void save()}>保存</Button> : <Button variant="light" isDisabled={!book || busy} onPress={() => setEditing(true)}>编辑</Button>}<Button variant="light" isDisabled={busy} onPress={close}>关闭</Button></ModalFooter></ModalContent></Modal>;
}
