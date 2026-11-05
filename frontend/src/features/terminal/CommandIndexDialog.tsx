import { useState } from 'react';
import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react';
import { SaveSnippet } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { CommandIndexEntry } from './shellIntegration';
import { errorMessage } from '../../lib/errors';

export default function CommandIndexDialog({ entries, enabled, pending, canEnable, onEnable, onGoTo, onOutput, onClose }: { entries: CommandIndexEntry[]; enabled: boolean; pending: boolean; canEnable: boolean; onEnable(): void; onGoTo(id: number): boolean; onOutput(id: number): string; onClose(): void }) {
  const [filter, setFilter] = useState('');
  const [error, setError] = useState('');
  const [snippet, setSnippet] = useState<CommandIndexEntry>();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const filtered = entries.filter(entry => `${entry.command || ''} ${entry.directory} ${entry.exitCode ?? ''}`.toLowerCase().includes(filter.toLowerCase())).slice().reverse();
  async function copy(value: () => string) { try { await navigator.clipboard.writeText(value()); setError(''); } catch (e) { setError(errorMessage(e)); } }
  return <><Modal isOpen onClose={onClose} size="4xl" className="app-dialog session-commands-dialog" scrollBehavior="inside"><ModalContent><ModalHeader>本次会话命令</ModalHeader><ModalBody>
    {!enabled && <div className="command-recording-setup"><div><p>{pending ? '等待 Shell 启用命令记录' : '启用后记录后续命令，关闭终端后清除。'}</p>{pending && <p className="muted">请在终端执行已预览的集成命令。</p>}</div><Button size="sm" variant="bordered" isDisabled={!canEnable} onPress={onEnable}>{pending ? '重新启用…' : '启用命令记录…'}</Button></div>}
    {!!entries.length && <input className="command-index-search" aria-label="搜索本次会话命令" placeholder="搜索命令、目录或退出码" autoFocus value={filter} onChange={event => setFilter(event.target.value)} />}
    {error && <p className="error" role="alert">{error}</p>}
    {!!entries.length && <div className="command-index-table"><table><thead><tr><th>命令 / 目录</th><th>时间</th><th>结果 / 耗时</th><th>操作</th></tr></thead><tbody>{filtered.map(entry => <tr key={entry.id}><td><button className="command-index-command" disabled={!entry.canLocate} onClick={() => { if (onGoTo(entry.id)) onClose(); else setError('输出已移出终端缓冲区'); }}>{entry.command || '未获取到命令文本'}</button><div className="muted file-path">{entry.directory || '目录未知'}{!entry.canLocate && ' · 输出已清除'}</div></td><td>{new Date(entry.startedAt).toLocaleTimeString()}</td><td className={entry.exitCode && entry.exitCode !== '0' ? 'error' : ''}>{entry.duration === undefined ? '执行中' : <>{entry.exitCode === undefined ? '退出状态未知' : entry.exitCode === '0' ? '成功' : `失败 · ${entry.exitCode}`}<div className="muted">{(entry.duration / 1000).toFixed(2)}s</div></>}</td><td><div className="button-row">{entry.command && <><button className="session-tool" onClick={() => void copy(() => entry.command!)}>复制命令</button><button className="session-tool" onClick={() => { setName(''); setSnippet(entry); setError(''); }}>保存片段</button></>}<button className="session-tool" disabled={!entry.canCopyOutput} onClick={() => void copy(() => onOutput(entry.id))}>复制输出</button></div></td></tr>)}</tbody></table></div>}
    {!!entries.length && !filtered.length && <p className="muted">没有匹配的命令</p>}
    {!entries.length && enabled && <p className="command-index-empty muted" role="status">等待下一条命令</p>}
    {!!entries.length && <p className="muted">记录随当前终端关闭而清除，输出保留范围取决于终端缓冲区。</p>}
  </ModalBody><ModalFooter><Button variant="light" onPress={onClose}>关闭</Button></ModalFooter></ModalContent></Modal>
    <Modal isOpen={!!snippet} onClose={() => !busy && setSnippet(undefined)} className="app-dialog"><ModalContent><ModalHeader>保存命令片段</ModalHeader><ModalBody><label className="form-field">名称<input autoFocus value={name} maxLength={128} disabled={busy} onChange={event => setName(event.target.value)} /></label><pre className="paste-preview">{snippet?.command}</pre>{error && <p className="error" role="alert">{error}</p>}</ModalBody><ModalFooter><Button variant="light" isDisabled={busy} onPress={() => setSnippet(undefined)}>取消</Button><Button color="primary" isLoading={busy} isDisabled={!name.trim()} onPress={async () => { if (!snippet?.command) return; setBusy(true); try { await SaveSnippet({ id: '', name: name.trim(), group: '', body: snippet.command }); setSnippet(undefined); setError(''); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); } }}>保存</Button></ModalFooter></ModalContent></Modal>
  </>;
}
