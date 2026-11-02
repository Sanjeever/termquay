import { useEffect, useRef, useState } from 'react';
import { Button, Dropdown, DropdownTrigger, DropdownMenu, DropdownItem, Modal, ModalBody, ModalContent, ModalHeader, ModalFooter } from '@heroui/react';
import { ReadDirectory, CreateRemoteDirectory, RenameRemotePath, DeleteRemotePath, StartUpload, StartDownload } from '../../../bindings/github.com/Sanjeever/termquay/appservice';
import type { Entry } from '../../../bindings/github.com/Sanjeever/termquay/internal/files/models';
import Icon from '../../components/Icon';

export default function FileBrowser({ id, visible, onOpen }: { id: string; visible: boolean; onOpen(entry: Entry): Promise<void> }) {
  const [directory, setDirectory] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [editingPath, setEditingPath] = useState(false);
  const [action, setAction] = useState<{ kind: 'mkdir' | 'rename' | 'delete'; path: string }>();
  const [working, setWorking] = useState(false);
  const loaded = useRef(false);
  const pending = useRef<ReturnType<typeof ReadDirectory>>();
  const list = useRef<HTMLUListElement>(null);

  async function load(path: string) {
    pending.current?.cancel(); setError(''); setLoading(true);
    const request = ReadDirectory(id, path); pending.current = request;
    try { const result = await request; if (pending.current !== request) return; setDirectory(result.path); setEntries((result.entries ?? []).sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name))); setSelected(''); loaded.current = true; }
    catch (e) { if (pending.current === request) setError(String(e)); }
    finally { if (pending.current === request) { pending.current = undefined; setLoading(false); } }
  }
  useEffect(() => { if (visible && !loaded.current && !pending.current) void load(''); }, [visible]);
  useEffect(() => () => { const operation = pending.current; pending.current = undefined; operation?.cancel(); }, [id]);

  async function open(entry: Entry) { if (entry.directory) await load(entry.path); else { try { setError(''); await onOpen(entry); } catch (e) { setError(String(e)); } } }
  async function perform(name = '') {
    if (!action || working) return; setWorking(true); setError('');
    try {
      if (action.kind === 'mkdir') await CreateRemoteDirectory(id, `${directory.replace(/\/$/, '')}/${name}`);
      if (action.kind === 'rename') await RenameRemotePath(id, action.path, `${action.path.slice(0, action.path.lastIndexOf('/') + 1)}${name}`);
      if (action.kind === 'delete') await DeleteRemotePath(id, action.path);
      setAction(undefined); await load(directory);
    } catch (e) { setError(String(e)); } finally { setWorking(false); }
  }
  const parent = directory.slice(0, directory.lastIndexOf('/')) || '/';
  return <aside className="file-panel" aria-label="远端文件">
    <div className="sidebar-heading"><h2>文件</h2><span className="muted">SFTP</span></div>
    <div className="file-toolbar"><button className="icon-button" aria-label="上级目录" title="上级目录" disabled={loading || directory === '/'} onClick={() => void load(parent)}><Icon name="up" /></button><button className="icon-button" aria-label="刷新目录" title="刷新目录" disabled={loading} onClick={() => void load(directory)}><Icon name="refresh" /></button><button className="icon-button" aria-label="新建目录" title="新建目录" disabled={!directory} onClick={() => { setError(''); setAction({ kind: 'mkdir', path: directory }); }}><Icon name="files" /><span>＋</span></button><button className="icon-button" aria-label="上传文件" title="上传文件" disabled={!directory} onClick={() => { StartUpload(id, directory).catch(e => setError(String(e))); }}><Icon name="transfer" /></button></div>
    {editingPath ? <form className="path-form" onSubmit={e => { e.preventDefault(); void load(String(new FormData(e.currentTarget).get('path'))); setEditingPath(false); }}><input name="path" aria-label="远端目录" defaultValue={directory} autoFocus onFocus={e => e.target.select()} onKeyDown={e => { if (e.key === 'Escape') setEditingPath(false); }} onBlur={() => setEditingPath(false)} /></form> : <div className="path-bar"><div className="breadcrumbs"><button onClick={() => void load('/')} aria-label="根目录">/</button>{directory.split('/').filter(Boolean).map((part, index, parts) => <button key={index} onClick={() => void load(`/${parts.slice(0, index + 1).join('/')}`)}>{part}<span>/</span></button>)}</div><button className="path-edit" aria-label="编辑目录路径" title={directory} onClick={() => setEditingPath(true)}>…</button></div>}
    {error && <p role="alert" className="error file-error">{error}</p>}
    {loading && <p className="muted" role="status">正在读取…</p>}
    <ul className="file-list" ref={list} aria-label="目录内容">{entries.map((entry, index) => <li key={entry.path} className={selected === entry.path ? 'selected' : ''}>
      {action?.kind === 'rename' && action.path === entry.path ? <form className="inline-rename" onSubmit={e => { e.preventDefault(); void perform(String(new FormData(e.currentTarget).get('name'))); }}><input aria-label="新名称" name="name" defaultValue={entry.name} required pattern="[^/]+" autoFocus disabled={working} onKeyDown={e => { if (e.key === 'Escape') setAction(undefined); }} /><Button type="submit" size="sm" isLoading={working}>保存</Button><button aria-label="取消重命名" type="button" onClick={() => setAction(undefined)}><Icon name="close" width="14" /></button></form> : <>
        <button className="file-name" onClick={() => setSelected(entry.path)} onDoubleClick={() => void open(entry)} title={`${entry.path} · ${entry.mode} · ${entry.size} 字节`} onKeyDown={e => {
          if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) { e.preventDefault(); const next = e.key === 'Home' ? 0 : e.key === 'End' ? entries.length - 1 : Math.max(0, Math.min(entries.length - 1, index + (e.key === 'ArrowDown' ? 1 : -1))); setSelected(entries[next].path); (list.current?.querySelectorAll('.file-name')[next] as HTMLElement)?.focus(); }
          if (e.key === 'Enter') { e.preventDefault(); void open(entry); }
          if (e.key === 'F2' || e.key === 'Delete') { e.preventDefault(); setError(''); setAction({ kind: e.key === 'F2' ? 'rename' : 'delete', path: entry.path }); }
        }}><span>{entry.directory ? <Icon name="files" width="15" height="15" /> : entry.symlink ? '↗' : '·'}</span><span className="file-entry-name">{entry.name}</span></button>
        <Dropdown><DropdownTrigger><button className="icon-button row-menu" aria-label={`${entry.name} 操作`}><Icon name="more" width="16" /></button></DropdownTrigger><DropdownMenu aria-label={`${entry.name} 操作`} onAction={key => { setError(''); if (key === 'open') void open(entry); else if (key === 'download') StartDownload(id, entry.path).catch(e => setError(String(e))); else setAction({ kind: key as 'rename' | 'delete', path: entry.path }); }}><DropdownItem key="open">打开</DropdownItem><DropdownItem key="download" className={entry.directory ? 'hidden' : ''}>下载</DropdownItem><DropdownItem key="rename">重命名</DropdownItem><DropdownItem key="delete" color="danger">删除</DropdownItem></DropdownMenu></Dropdown>
      </>}
    </li>)}</ul>
    {loaded.current && !loading && entries.length === 0 && <p className="sidebar-empty">空目录</p>}
    <Modal isOpen={!!action && action.kind !== 'rename'} onClose={() => !working && setAction(undefined)} className="app-dialog"><ModalContent><ModalHeader>{action?.kind === 'mkdir' ? '新建目录' : '删除远端路径'}</ModalHeader><form onSubmit={e => { e.preventDefault(); void perform(String(new FormData(e.currentTarget).get('name') || '')); }}><ModalBody>{action?.kind === 'delete' ? <p>确认删除 <code>{action.path}</code>？</p> : <label className="form-field">目录名称<input className="native-input" name="name" aria-label="目录名称" required pattern="[^/]+" autoFocus /></label>}{error && <p role="alert" className="error">{error}</p>}</ModalBody><ModalFooter><Button variant="light" isDisabled={working} onPress={() => setAction(undefined)}>取消</Button><Button type="submit" color={action?.kind === 'delete' ? 'danger' : 'primary'} isLoading={working}>{action?.kind === 'delete' ? '删除' : '创建'}</Button></ModalFooter></form></ModalContent></Modal>
  </aside>;
}
