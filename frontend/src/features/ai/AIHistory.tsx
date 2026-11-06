import { useEffect, useState } from 'react';
import { Button, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@heroui/react';
import { ListAIConversations } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { AIConversation } from '../../../bindings/github.com/Sanjeever/termquay/internal/store/models';
import Icon from '../../components/Icon';
import { errorMessage } from '../../lib/errors';

export default function AIHistory({ workspace, current, busy, onOpen, onDelete }: { workspace: string; current?: string; busy: boolean; onOpen(id: string): Promise<boolean>; onDelete(id: string): Promise<boolean> }) {
  const [items, setItems] = useState<AIConversation[]>([]);
  const [offset, setOffset] = useState(0);
  const [epoch, setEpoch] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState<AIConversation>();
  useEffect(() => {
    let active = true; setLoading(true); setError('');
    ListAIConversations(workspace, offset, 20).then(value => { if (active) setItems(value || []); }).catch(e => { if (active) setError(errorMessage(e)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [workspace, offset, epoch]);
  return <div className="ai-history">
    {items.map(item => <div className={`ai-history-row${current === item.id ? ' selected' : ''}`} key={item.id}><button disabled={busy || loading} onClick={() => void onOpen(item.id)}><span>{item.title}</span><small className="muted">{new Date(item.updated_at).toLocaleString()}<br />{item.target}</small></button><button className="icon-button" disabled={busy || loading} aria-label={`删除对话 ${item.title}`} onClick={() => setDeleting(item)}><Icon name="close" width="14" /></button></div>)}
    {loading && <p role="status" className="muted">正在读取历史…</p>}
    {!loading && !items.length && <p className="muted">暂无历史</p>}
    <div className="ai-history-pages"><button className="session-tool" disabled={loading || offset === 0} onClick={() => setOffset(Math.max(0, offset - 20))}>上一页</button><button className="session-tool" disabled={loading || items.length < 20} onClick={() => setOffset(offset + 20)}>下一页</button></div>
    {error && <p role="alert" className="error">{error}</p>}
    <Modal isOpen={!!deleting} onClose={() => { if (!busy) setDeleting(undefined); }} isDismissable={!busy} className="app-dialog"><ModalContent><ModalHeader>删除 AI 对话</ModalHeader><ModalBody><p>删除“{deleting?.title}”及全部消息？进行中的轮次会先停止。</p></ModalBody><ModalFooter><Button variant="light" isDisabled={busy} onPress={() => setDeleting(undefined)}>取消</Button><Button color="danger" isLoading={busy} onPress={async () => { if (deleting && await onDelete(deleting.id)) { setDeleting(undefined); setEpoch(value => value + 1); } }}>删除</Button></ModalFooter></ModalContent></Modal>
  </div>;
}
