import Modal from '../../components/Modal';
import { t as translate } from '../../i18n/index.ts';
import { message as uiMessage } from '../../i18n/messages.ts';
import { useMessageState } from '../../i18n/useMessageState.ts';
import { useTranslation } from 'react-i18next';

import { useEffect, useRef, useState } from 'react';
import { Button, Input, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react';
import { ListTmuxSessions } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { TmuxSession } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import { shellQuote } from './shellIntegration';
import ErrorNotice from '../../components/ErrorNotice';

export default function TmuxDialog({ workspace, onInsert, onAttach, onClose }: { workspace: string; onInsert(command: string): boolean; onAttach?(name: string): Promise<boolean>; onClose(): void }) {
  useTranslation();
  const [items, setItems] = useState<TmuxSession[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useMessageState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef<ReturnType<typeof ListTmuxSessions>>();
  const mounted = useRef(true);
  async function load() { setBusy(true); setError(''); const operation = ListTmuxSessions(workspace); pending.current = operation; try { const values = await operation; if (mounted.current) setItems(values || []); } catch (e) { if (mounted.current) setError(e); } finally { if (mounted.current) setBusy(false); } }
  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; pending.current?.cancel(); }; }, [workspace]);
  function insert(command: string) { if (onInsert(command)) onClose(); else setError(uiMessage('terminal:currentTerminalIsNotInteractive')); }
  return <Modal isOpen onClose={onClose} className="app-dialog"><ModalContent><ModalHeader>{translate('terminal:tmuxSessions2')}</ModalHeader><ModalBody>
    <div className="button-row"><Button size="sm" variant="light" isLoading={busy} onPress={() => void load()}>{translate('terminal:refreshSessions')}</Button><Button size="sm" variant="light" onPress={() => insert('tmux detach-client')}>{translate('terminal:detachCurrentSession')}</Button></div>
    <ErrorNotice message={error} onDismiss={()=>setError('')}/>
    <ul className="snapshot-list">{items.map(item => <li key={item.id}><span>{item.name}<small className="muted"> {item.attached ? translate('terminal:attached') : translate('terminal:detached')}</small></span><Button size="sm" variant="light" isDisabled={busy} onPress={() => insert(`tmux attach-session -t ${shellQuote(item.id)}`)}>{translate('terminal:insertAttachCommand')}</Button>{onAttach && <Button size="sm" isDisabled={busy} onPress={async () => { setBusy(true); try { if (await onAttach(item.name)) onClose(); } catch (e) { setError(e); } finally { setBusy(false); } }}>{translate('terminal:bindAndAttachInNewTab')}</Button>}</li>)}</ul>
    <form id="tmux-new" onSubmit={event => { event.preventDefault(); if (name.trim()) insert(`tmux new-session -s ${shellQuote(name.trim())}`); }}><Input label={translate('terminal:newSessionName')} labelPlacement="outside" value={name} onValueChange={setName} maxLength={128} autoComplete="off" /></form>
  </ModalBody><ModalFooter><Button variant="light" onPress={onClose}>{translate('terminal:close')}</Button><Button color="primary" type="submit" form="tmux-new" isDisabled={!name.trim() || /[.:\x00-\x1f]/.test(name)}>{translate('terminal:newSession')}</Button></ModalFooter></ModalContent></Modal>;
}
