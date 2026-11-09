import Modal from '../../components/Modal';
import { t as translate, currentLocale } from '../../i18n/index.ts';
import { useMessageState } from '../../i18n/useMessageState.ts';
import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import { Button, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@heroui/react';
import { ListAIConversations } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { AIConversation } from '../../../bindings/github.com/Sanjeever/termquay/internal/store/models';
import Icon from '../../components/Icon';


export default function AIHistory({ workspace, current, busy, operationError, onOpen, onDelete }: { workspace: string; current?: string; busy: boolean; operationError: string; onOpen(id: string): Promise<boolean>; onDelete(id: string): Promise<boolean> }) {
  useTranslation();
  const [items, setItems] = useState<AIConversation[]>([]);
  const [offset, setOffset] = useState(0);
  const [epoch, setEpoch] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useMessageState('');
  const [deleting, setDeleting] = useState<AIConversation>();
  useEffect(() => {
    let active = true; setLoading(true); setError('');
    ListAIConversations(workspace, offset, 20).then(value => { if (active) setItems(value || []); }).catch(e => { if (active) setError(e); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [workspace, offset, epoch]);
  return <div className="ai-history">
    {items.map(item => <div className={`ai-history-row${current === item.id ? ' selected' : ''}`} key={item.id}><button disabled={busy || loading} onClick={() => void onOpen(item.id)}><span>{item.title}</span><small className="muted">{new Date(item.updated_at).toLocaleString(currentLocale())}<br />{item.target}</small></button><button className="icon-button" disabled={busy || loading} aria-label={translate('ai:deleteConversation', { value1: item.title })} onClick={() => setDeleting(item)}><Icon name="close" width="14" /></button></div>)}
    {loading && <p role="status" className="muted">{translate('ai:readingHistory')}</p>}
    {!loading && !items.length && <p className="muted">{translate('ai:noHistory')}</p>}
    <div className="ai-history-pages"><button className="session-tool" disabled={loading || offset === 0} onClick={() => setOffset(Math.max(0, offset - 20))}>{translate('ai:previousPage')}</button><button className="session-tool" disabled={loading || items.length < 20} onClick={() => setOffset(offset + 20)}>{translate('ai:nextPage')}</button></div>
    {error && <p role="alert" className="error">{error}</p>}
    <Modal isOpen={!!deleting} onClose={() => { if (!busy) setDeleting(undefined); }} isDismissable={!busy} className="app-dialog"><ModalContent><ModalHeader>{translate('ai:deleteAIConversation')}</ModalHeader><ModalBody><p>{translate('ai:delete')}{deleting?.title}{translate('ai:andAllItsMessagesAnyRunningTurnWill')}</p>{operationError && <p className="error" role="alert">{operationError}</p>}</ModalBody><ModalFooter><Button variant="light" isDisabled={busy} onPress={() => setDeleting(undefined)}>{translate('ai:cancel')}</Button><Button color="danger" isLoading={busy} onPress={async () => { if (deleting && await onDelete(deleting.id)) { setDeleting(undefined); setEpoch(value => value + 1); } }}>{translate('ai:delete2')}</Button></ModalFooter></ModalContent></Modal>
  </div>;
}
