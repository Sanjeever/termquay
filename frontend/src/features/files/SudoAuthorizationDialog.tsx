import { useState } from 'react';
import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react';
import SelectControl from '../../components/SelectControl';

export type SudoAuthorization = { path: string; encoding: string; password: string };

export default function SudoAuthorizationDialog({ path, encoding, operation, target, onAnswer }: { path: string; encoding: string; operation: 'open' | 'read' | 'save'; target: string; onAnswer(value?: SudoAuthorization): void }) {
  const [filename, setFilename] = useState(path);
  const [charset, setCharset] = useState(encoding);
  const [password, setPassword] = useState('');
  function answer() { const value = { path: filename, encoding: charset, password }; setPassword(''); onAnswer(value); }
  return <Modal isOpen onClose={() => onAnswer()} className="app-dialog"><ModalContent><form onSubmit={event => { event.preventDefault(); if (filename.startsWith('/')) answer(); }}><ModalHeader>{operation === 'save' ? '授权 sudo 保存' : '授权 sudo 读取'}</ModalHeader><ModalBody>
    <p className="file-path">{target}</p>
    <label className="form-field">实际文件路径<input autoFocus={operation === 'open'} value={filename} readOnly={operation !== 'open'} maxLength={4096} onChange={event => setFilename(event.target.value)} /></label>
    {operation === 'open' && <label className="form-field">编码<SelectControl value={charset} onChange={event => setCharset(event.target.value)}>{['UTF-8', 'GBK', 'GB18030'].map(value => <option key={value}>{value}</option>)}</SelectControl></label>}
    <label className="form-field">sudo 密码<input autoFocus={operation !== 'open'} type="password" autoComplete="off" value={password} maxLength={4096} onChange={event => setPassword(event.target.value)} /></label>
    <p className="muted">授权本次以 root {operation === 'save' ? '保存' : '读取'}文件。免密 sudo 可留空。</p>
  </ModalBody><ModalFooter><Button variant="light" onPress={() => onAnswer()}>取消</Button><Button color="primary" type="submit" isDisabled={!filename.startsWith('/')}>授权并{operation === 'save' ? '保存' : '读取'}</Button></ModalFooter></form></ModalContent></Modal>;
}
