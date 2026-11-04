import { errorMessage } from "../../lib/errors";
import { useEffect, useRef, useState } from 'react';
import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react';
import { ReadRemoteLog } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { RemoteLogSlice } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';

export default function RemoteLogDialog({ workspace, path, visible, onClose }: { workspace: string; path: string; visible: boolean; onClose(): void }) {
  const [slice, setSlice] = useState<RemoteLogSlice>();
  const [follow, setFollow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('');
  const current = useRef(slice); current.current = slice;
  const mounted = useRef(true);
  const pending = useRef<ReturnType<typeof ReadRemoteLog>>();
  const content = useRef<HTMLPreElement>(null);
  async function load(kind: 'refresh' | 'older' | 'append') {
    if (pending.current) return;
    setBusy(true); setError('');
    const before = current.current;
    const request = ReadRemoteLog(workspace, path, kind === 'refresh' ? -1 : kind === 'older' ? before?.start || 0 : before?.end || 0, kind === 'older'); pending.current = request;
    try {
      const value = await request; if (!mounted.current || pending.current !== request) return;
      if (kind === 'append' && before && !value.reset && value.start === before.end) {
        const text = before.content + value.content;
        if (text.length > 512 * 1024) { setSlice(value); } else setSlice({ ...value, start: before.start, content: text });
      } else setSlice(value);
      if (kind !== 'older') requestAnimationFrame(() => content.current?.scrollTo({ top: content.current.scrollHeight }));
    } catch (e) { if (mounted.current && pending.current === request) { setError(errorMessage(e)); setFollow(false); } }
    finally { if (pending.current === request) { pending.current = undefined; if (mounted.current) setBusy(false); } }
  }
  useEffect(() => { mounted.current = true; void load('refresh'); return () => { mounted.current = false; pending.current?.cancel(); pending.current = undefined; }; }, [workspace, path]);
  useEffect(() => { if (!follow || !visible) return; const timer = setInterval(() => void load('append'), 2000); return () => clearInterval(timer); }, [follow, visible, workspace, path]);
  return <Modal isOpen onClose={onClose} size="5xl" className="app-dialog remote-log-dialog" scrollBehavior="inside"><ModalContent><ModalHeader>{path.split('/').pop()}</ModalHeader><ModalBody>
    <div className="button-row"><Button size="sm" variant="light" isDisabled={busy || !slice?.start} onPress={() => { setFollow(false); void load('older'); }}>更早内容</Button><Button size="sm" variant="light" isLoading={busy} onPress={() => void load('refresh')}>读取末尾</Button><label className="checkbox-label"><input type="checkbox" checked={follow} onChange={event => setFollow(event.target.checked)}/>跟随追加</label><input aria-label="筛选已读取日志行" placeholder="筛选已读取内容" value={filter} onChange={event => setFilter(event.target.value)} maxLength={128}/></div>
    <p className="file-path">{path}</p>{error && <p role="alert" className="error">{error}</p>}
    <pre className="remote-log-content" ref={content}>{filter ? slice?.content.split('\n').filter(line => line.toLowerCase().includes(filter.toLowerCase())).join('\n') : slice?.content}</pre>
    <div className="session-status">字节 {slice?.start || 0}–{slice?.end || 0} / {slice?.size || 0}</div>
  </ModalBody><ModalFooter><Button variant="light" onPress={onClose}>关闭</Button></ModalFooter></ModalContent></Modal>;
}
