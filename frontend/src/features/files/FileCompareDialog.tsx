import { useEffect, useRef, useState } from 'react';
import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react';
import { MergeView } from '@codemirror/merge';
import { EditorState } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';
import SelectControl from '../../components/SelectControl';
import { ChooseComparisonFile, CopyRemoteFile, ReadRemoteFileEncoded } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { Transfer } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import type { Document } from '../../../bindings/github.com/Sanjeever/termquay/internal/files/models';
import { errorMessage } from '../../lib/errors';
import { useAppearance } from '../settings/AppearanceProvider';
import { editorTheme } from './editorTheme';
import '../../styles/file-compare.css';

type Side = { workspace: string; path: string; encoding: string; document?: Document };
type Target = { id: string; name: string };

export default function FileCompareDialog({ targets, initial, onTransfer, onClose }: { targets: Target[]; initial?: string; onTransfer(transfer: Transfer): void; onClose(): void }) {
  const [sides, setSides] = useState<[Side, Side]>([{ workspace: initial || '', path: '', encoding: 'UTF-8' }, { workspace: '', path: '', encoding: 'UTF-8' }]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [overwrite, setOverwrite] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const requests = useRef(new Set<{ cancel(): void }>());
  const mounted = useRef(true);
  const { dark } = useAppearance();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; requests.current.forEach(request => request.cancel()); }; }, []);
  function update(index: number, value: Partial<Side>) { setSides(previous => previous.map((side, i) => i === index ? { ...side, ...value, document: undefined } : side) as [Side, Side]); }
  async function read(index: number) {
    const side = sides[index]; setBusy(true); setError('');
    const request = side.workspace ? ReadRemoteFileEncoded(side.workspace, side.path, side.encoding) : ChooseComparisonFile(side.encoding);
    requests.current.add(request);
    try { const document = await request; if (mounted.current && document) setSides(previous => previous.map((value, i) => i === index ? { ...value, path: document.path, document } : value) as [Side, Side]); }
    catch (e) { if (mounted.current) setError(errorMessage(e)); }
    finally { requests.current.delete(request); if (mounted.current) setBusy(false); }
  }
  useEffect(() => {
    if (!host.current || !sides[0].document || !sides[1].document) return;
    const extensions = [EditorState.readOnly.of(true), EditorView.editable.of(false), lineNumbers(), editorTheme(dark)];
    const view = new MergeView({ parent: host.current, a: { doc: sides[0].document.content, extensions: [...extensions, EditorView.contentAttributes.of({ 'aria-label': '左侧文件' })] }, b: { doc: sides[1].document.content, extensions: [...extensions, EditorView.contentAttributes.of({ 'aria-label': '右侧文件' })] }, highlightChanges: true, gutter: true });
    return () => view.destroy();
  }, [sides[0].document, sides[1].document, dark]);
  async function copy() {
    setBusy(true); setError('');
    const request = CopyRemoteFile(sides[0].workspace, sides[0].path, sides[1].workspace, sides[1].path, overwrite);
    requests.current.add(request);
    try { const transfer = await request; if (mounted.current) { onTransfer(transfer); onClose(); } }
    catch (e) { if (mounted.current) setError(errorMessage(e)); }
    finally { requests.current.delete(request); if (mounted.current) setBusy(false); }
  }
  return <Modal isOpen onClose={onClose} size="5xl" className="app-dialog file-conflict-dialog" isDismissable={!busy}><ModalContent><ModalHeader>文件对比与复制</ModalHeader><ModalBody>
    <div className="file-compare-sides">{sides.map((side, index) => <div key={index}>
      <label className="form-field">{index === 0 ? '来源' : '目标'}<SelectControl disabled={busy} value={side.workspace} onChange={event => update(index, { workspace: event.target.value, path: '' })}><option value="">本地文件</option>{targets.map(target => <option key={target.id} value={target.id}>{target.name}</option>)}</SelectControl></label>
      <label className="form-field">文件路径<input value={side.path} readOnly={!side.workspace} disabled={busy} onChange={event => update(index, { path: event.target.value })} /></label>
      <label className="form-field">编码<SelectControl disabled={busy} value={side.encoding} onChange={event => update(index, { encoding: event.target.value })}>{['UTF-8', 'GBK', 'GB18030'].map(encoding => <option key={encoding}>{encoding}</option>)}</SelectControl></label>
      <Button size="sm" variant="light" isDisabled={busy || !!side.workspace && !side.path.startsWith('/')} onPress={() => void read(index)}>{side.workspace ? '读取文件' : '选择文件'}</Button>
    </div>)}</div>
    {error && <p className="error" role="alert">{error}</p>}<div className="conflict-editors" ref={host} />
    {!!sides[0].workspace && !!sides[1].workspace && <label className="checkbox-label"><input type="checkbox" disabled={busy} checked={overwrite} onChange={event => setOverwrite(event.target.checked)} />允许覆盖目标普通文件</label>}
  </ModalBody><ModalFooter><Button variant="light" isDisabled={busy} onPress={onClose}>关闭</Button>{!!sides[0].workspace && !!sides[1].workspace && <Button color="primary" isLoading={busy} isDisabled={!sides.every(side => side.path.startsWith('/')) || !targets.some(target => target.id === sides[0].workspace) || !targets.some(target => target.id === sides[1].workspace)} onPress={() => void copy()}>复制来源到目标</Button>}</ModalFooter></ModalContent></Modal>;
}
