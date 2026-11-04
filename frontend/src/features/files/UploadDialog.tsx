import { errorMessage } from "../../lib/errors";
import { useEffect, useRef, useState } from 'react';
import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react';
import { Events } from '@wailsio/runtime';
import { ChooseUploadFiles, ConfirmUpload, DiscardUpload, ReadDirectory } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { Transfer, UploadPreparation, UploadPreview } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import type { Directory } from '../../../bindings/github.com/Sanjeever/termquay/internal/files/models';
import SelectControl from '../../components/SelectControl';
import Icon from '../../components/Icon';
import { bytes } from './transferFormat';

export default function UploadDialog({ workspaces, onSubmitted }: { workspaces: string[]; onSubmitted(items: Transfer[]): void }) {
  const [preview, setPreview] = useState<UploadPreview>();
  const [directory, setDirectory] = useState('');
  const [listing, setListing] = useState<Directory>();
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(0);
  const choosing = useRef(false);
  const pending = useRef<ReturnType<typeof ReadDirectory>>();
  const latest = useRef(preview); latest.current = preview;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    function accept(value: UploadPreview) {
      if (!value.id) return;
      setPreview(value); setDirectory(value.directory); setOverwrite(false); setListing(undefined); setError(''); setSubmitted(0);
    }
    const off = Events.On('files:upload-prepared', event => {
      const value = event.data as UploadPreparation;
      if (value.error) setError(value.error); else accept(value.preview);
    });
    async function choose(event: Event) {
      if (choosing.current) return;
      choosing.current = true;
      const { id, directory } = (event as CustomEvent<{ id: string; directory: string }>).detail;
      try {
        const value = await ChooseUploadFiles(id, directory);
        if (mounted.current) accept(value); else if (value.id) await DiscardUpload(value.id);
      } catch (e) { if (mounted.current) setError(errorMessage(e)); }
      finally { choosing.current = false; }
    }
    window.addEventListener('termquay:choose-upload', choose);
    return () => {
      mounted.current = false; off(); window.removeEventListener('termquay:choose-upload', choose); pending.current?.cancel();
      if (latest.current) void DiscardUpload(latest.current.id);
    };
  }, []);
  async function close() {
    if (busy) return;
    try {
      if (preview) await DiscardUpload(preview.id);
      pending.current?.cancel(); pending.current = undefined;
      setPreview(undefined); setListing(undefined); setError(''); setBrowsing(false);
    } catch (e) { setError(errorMessage(e)); }
  }
  async function browse(path: string) {
    if (!preview || busy) return;
    pending.current?.cancel();
    const request = ReadDirectory(preview.workspace, path); pending.current = request;
    setBrowsing(true); setError('');
    try {
      const value = await request;
      if (pending.current === request) { setListing(value); setDirectory(value.path); }
    } catch (e) { if (pending.current === request) setError(errorMessage(e)); }
    finally { if (pending.current === request) { pending.current = undefined; setBrowsing(false); } }
  }
  const files = preview?.files || [];
  const supported = files.filter(file => file.supported);
  const connected = !preview || workspaces.includes(preview.workspace);
  return <Modal isOpen={!!preview || !!error} onClose={() => void close()} isDismissable={!busy} isKeyboardDismissDisabled={busy} hideCloseButton={busy} closeButton={<button type="button" aria-labelledby="upload-confirm-close"><span id="upload-confirm-close" className="sr-only">关闭上传确认</span><Icon name="close" width="14" /></button>} scrollBehavior="inside" className="app-dialog upload-dialog">
    <ModalContent><form onSubmit={async event => {
      event.preventDefault(); if (!preview || busy || !connected || !supported.length) return;
      setBusy(true); setError('');
      try {
        const result = await ConfirmUpload(preview.id, directory, overwrite);
        const items = result.batch.items || [];
        if (items.length) { onSubmitted(items); setSubmitted(count => count + items.length); }
        if (result.pending.id) { setPreview(result.pending); setDirectory(result.pending.directory); }
        else { setPreview(undefined); setListing(undefined); }
      } catch (e) { setError(errorMessage(e)); }
      finally { setBusy(false); }
    }}><ModalHeader>{preview ? `上传 ${files.length} 个文件` : '无法准备上传'}</ModalHeader><ModalBody>
      {preview && <>
        <dl className="upload-target"><dt>目标连接</dt><dd>{preview.target}</dd></dl>
        <label className="form-field">目标目录<div className="upload-directory"><input aria-label="上传目标目录" required pattern="/.*" value={directory} disabled={busy} onChange={event => { pending.current?.cancel(); pending.current = undefined; setBrowsing(false); setDirectory(event.target.value); setListing(undefined); }} /><Button size="sm" variant="bordered" isDisabled={busy || !connected} isLoading={browsing} onPress={() => void browse(directory)}>浏览</Button></div></label>
        {listing && <div className="upload-directories" aria-label="选择远端上传目录" aria-busy={browsing}>
          {listing.path !== '/' && <button type="button" disabled={busy || browsing} onClick={() => void browse(listing.path.slice(0, listing.path.lastIndexOf('/')) || '/')}><Icon name="up" width="14" />上级目录</button>}
          {(listing.entries || []).filter(entry => entry.directory).sort((a, b) => a.name.localeCompare(b.name)).map(entry => <button type="button" key={entry.path} disabled={busy || browsing} onClick={() => void browse(entry.path)}><Icon name="files" width="14" />{entry.name}</button>)}
          {!listing.entries?.some(entry => entry.directory) && <p className="muted">没有子目录</p>}
        </div>}
        <ul className="upload-files" aria-label="待上传文件">{files.map((file, index) => <li key={index}><div><span>{file.name}</span><span className="muted">{file.supported ? bytes(file.size) : '不支持'}</span></div>{file.error && <p className="error">{file.error}</p>}</li>)}</ul>
        <div className="upload-summary">{supported.length} 个可上传文件 · {bytes(supported.reduce((sum, file) => sum + file.size, 0))}</div>
        <label className="form-field">同名文件<SelectControl aria-label="上传同名文件处理" value={overwrite ? 'overwrite' : 'skip'} disabled={busy} onChange={event => setOverwrite(event.target.value === 'overwrite')}><option value="skip">跳过</option><option value="overwrite">覆盖同名普通文件</option></SelectControl></label>
        {overwrite && <p className="error">将替换目标目录中的同名普通文件。</p>}
        {!!submitted && <p role="status">{submitted} 个文件已加入队列，以下文件未入队。</p>}
        {!connected && <p role="alert" className="error">SSH 工作区已关闭，请重新连接后发起上传。</p>}
      </>}
      {error && <p role="alert" className="error">{error}</p>}
    </ModalBody><ModalFooter><Button variant="light" isDisabled={busy} onPress={() => void close()}>{submitted || !preview ? '关闭' : '取消'}</Button>{preview && <Button type="submit" color="primary" isLoading={busy} isDisabled={!connected || !supported.length || browsing}>{busy ? '正在加入队列' : submitted ? '重试未入队文件' : '开始上传'}</Button>}</ModalFooter></form></ModalContent>
  </Modal>;
}
