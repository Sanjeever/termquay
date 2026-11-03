import { useEffect, useRef, useState } from 'react';
import { Button, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react';
import { ListTmuxSessions } from '../../../bindings/github.com/Sanjeever/termquay/appservice';
import type { TmuxSession } from '../../../bindings/github.com/Sanjeever/termquay/models';
import { shellQuote } from './shellIntegration';

export default function TmuxDialog({ workspace, onInsert, onClose }: { workspace: string; onInsert(command: string): boolean; onClose(): void }) {
  const [items, setItems] = useState<TmuxSession[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef<ReturnType<typeof ListTmuxSessions>>();
  const mounted = useRef(true);
  async function load() { setBusy(true); setError(''); const operation = ListTmuxSessions(workspace); pending.current = operation; try { const values = await operation; if (mounted.current) setItems(values || []); } catch (e) { if (mounted.current) setError(String(e)); } finally { if (mounted.current) setBusy(false); } }
  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; pending.current?.cancel(); }; }, [workspace]);
  function insert(command: string) { if (onInsert(command)) onClose(); else setError('当前终端不可输入'); }
  return <Modal isOpen onClose={onClose} className="app-dialog"><ModalContent><ModalHeader>tmux 会话</ModalHeader><ModalBody>
    <div className="button-row"><Button size="sm" variant="light" isLoading={busy} onPress={() => void load()}>刷新会话</Button><Button size="sm" variant="light" onPress={() => insert('tmux detach-client')}>分离当前会话</Button></div>
    {error && <p role="alert" className="error">{error}</p>}
    <ul className="snapshot-list">{items.map(item => <li key={item.id}><span>{item.name}<small className="muted"> {item.attached ? '已附着' : '未附着'}</small></span><Button size="sm" variant="light" onPress={() => insert(`tmux attach-session -t ${shellQuote(item.id)}`)}>附着</Button></li>)}</ul>
    <form id="tmux-new" onSubmit={event => { event.preventDefault(); if (name.trim()) insert(`tmux new-session -s ${shellQuote(name.trim())}`); }}><Input label="新会话名称" labelPlacement="outside" value={name} onValueChange={setName} maxLength={128} autoComplete="off" /></form>
  </ModalBody><ModalFooter><Button variant="light" onPress={onClose}>关闭</Button><Button color="primary" type="submit" form="tmux-new" isDisabled={!name.trim() || /[.:\x00-\x1f]/.test(name)}>新建会话</Button></ModalFooter></ModalContent></Modal>;
}
