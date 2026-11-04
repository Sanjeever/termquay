import { useState } from 'react';
import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react';
import { SaveSnippet } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { CommandIndexEntry } from './shellIntegration';
import { errorMessage } from '../../lib/errors';

export default function CommandIndexDialog({ entries, onGoTo, onOutput, onClose }: { entries: CommandIndexEntry[]; onGoTo(id: number): boolean; onOutput(id: number): string; onClose(): void }) {
  const [filter, setFilter] = useState('');
  const [error, setError] = useState('');
  const [snippet, setSnippet] = useState<CommandIndexEntry>();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  async function copy(value: () => string) { try { await navigator.clipboard.writeText(value()); setError(''); } catch (e) { setError(errorMessage(e)); } }
  return <><Modal isOpen onClose={onClose} size="4xl" className="app-dialog" scrollBehavior="inside"><ModalContent><ModalHeader>会话命令索引</ModalHeader><ModalBody>
    <label className="form-field">筛选<input autoFocus value={filter} onChange={event => setFilter(event.target.value)} /></label>
    {error && <p className="error" role="alert">{error}</p>}
    <table><thead><tr><th>时间 / 目录</th><th>命令</th><th>退出码 / 耗时</th><th>操作</th></tr></thead><tbody>{entries.filter(entry => `${entry.command || ''} ${entry.directory} ${entry.exitCode || ''}`.toLowerCase().includes(filter.toLowerCase())).slice().reverse().map(entry => <tr key={entry.id}><td>{new Date(entry.startedAt).toLocaleTimeString()}<div className="file-path">{entry.directory}</div></td><td><pre className="command-source">{entry.command || '命令文本未采集'}</pre></td><td>{entry.duration === undefined ? '执行中' : `${entry.exitCode ?? '未知'} · ${(entry.duration / 1000).toFixed(2)}s`}</td><td><div className="button-row"><button className="session-tool" onClick={() => { if (onGoTo(entry.id)) onClose(); else setError('输出已移出终端缓冲区'); }}>跳转</button>{entry.command && <><button className="session-tool" onClick={() => void copy(() => entry.command!)}>复制命令</button><button className="session-tool" onClick={() => { setName(''); setSnippet(entry); setError(''); }}>保存片段</button></>}<button className="session-tool" disabled={entry.duration === undefined} onClick={() => void copy(() => onOutput(entry.id))}>复制输出</button></div></td></tr>)}</tbody></table>
    {!entries.length && <p className="muted">启用当前 Shell 集成后记录本次会话的命令边界。</p>}
  </ModalBody><ModalFooter><Button variant="light" onPress={onClose}>关闭</Button></ModalFooter></ModalContent></Modal>
    <Modal isOpen={!!snippet} onClose={() => !busy && setSnippet(undefined)} className="app-dialog"><ModalContent><ModalHeader>保存命令片段</ModalHeader><ModalBody><label className="form-field">名称<input autoFocus value={name} maxLength={128} disabled={busy} onChange={event => setName(event.target.value)} /></label><pre className="paste-preview">{snippet?.command}</pre>{error && <p className="error" role="alert">{error}</p>}</ModalBody><ModalFooter><Button variant="light" isDisabled={busy} onPress={() => setSnippet(undefined)}>取消</Button><Button color="primary" isLoading={busy} isDisabled={!name.trim()} onPress={async () => { if (!snippet?.command) return; setBusy(true); try { await SaveSnippet({ id: '', name: name.trim(), group: '', body: snippet.command }); setSnippet(undefined); setError(''); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); } }}>保存</Button></ModalFooter></ModalContent></Modal>
  </>;
}
