import { useEffect, useRef, useState } from 'react';
import { Button } from '@heroui/react';
import { ReadDirectory, ReadRemoteFile, SaveRemoteFile, CreateRemoteDirectory, RenameRemotePath, DeleteRemotePath } from '../../../bindings/github.com/Sanjeever/termquay/appservice';
import type { Document, Entry } from '../../../bindings/github.com/Sanjeever/termquay/internal/files/models';
import TerminalView from '../terminal/TerminalView';
import CodeEditor from './CodeEditor';
import MonitorPanel from '../monitor/MonitorPanel';

type Draft = Document & { saved: string; error: string; saving: boolean };

export default function SSHWorkspace({ id, onDirtyChange }: { id: string; onDirtyChange(dirty: boolean): void }) {
  const [directory, setDirectory] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState('');
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [active, setActive] = useState('terminal');
  const [filesOpen, setFilesOpen] = useState(true);
  const [monitorOpen,setMonitorOpen]=useState(false);
  const [width, setWidth] = useState(Number(localStorage.getItem('termquay.files-width')) || 220);
  const [action, setAction] = useState<{ kind: string; path: string }>();
  const [closing, setClosing] = useState('');
  const pending = useRef<ReturnType<typeof ReadDirectory>>();
  const dirtyCallback=useRef(onDirtyChange);dirtyCallback.current=onDirtyChange;

  const dirty = drafts.some((d) => d.content !== d.saved);
  useEffect(() => { dirtyCallback.current(dirty); }, [dirty]);
  useEffect(() => { const handler = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } }; window.addEventListener('beforeunload', handler); return () => window.removeEventListener('beforeunload', handler); }, [dirty]);

  async function load(remote: string) {
    pending.current?.cancel(); setError('');
    const request = ReadDirectory(id, remote); pending.current = request;
    try { const list = await request; if (pending.current !== request) return; setEntries(list); setDirectory(remote || (list.length ? list[0].path.slice(0, list[0].path.lastIndexOf('/')) || '/' : '.')); } catch (e) { if (pending.current === request) setError(String(e)); }
  }
  useEffect(() => { void load(''); return () => { pending.current?.cancel(); }; }, [id]);

  async function open(entry: Entry) {
    if (entry.directory) { await load(entry.path); return; }
    if (drafts.some((d) => d.path === entry.path)) { setActive(entry.path); return; }
    try { const document = await ReadRemoteFile(id, entry.path); setDrafts((prev) => [...prev, { ...document, saved: document.content, error: '', saving: false }]); setActive(entry.path); } catch (e) { setError(String(e)); }
  }

  async function save(draft: Draft) {
    if (draft.saving) return;
    setDrafts((prev) => prev.map((d) => d.path === draft.path ? { ...d, saving: true, error: '' } : d));
    try {
      const result = await SaveRemoteFile(id, { path: draft.path, content: draft.content, revision: draft.revision });
      setDrafts((prev) => prev.map((d) => d.path === draft.path ? { ...d, saved: result.content, revision: result.revision, saving: false } : d));
    } catch (e) { setDrafts((prev) => prev.map((d) => d.path === draft.path ? { ...d, saving: false, error: String(e) } : d)); }
  }

  function close(path: string, discard = false) {
    if (!discard && drafts.find((d) => d.path === path && d.content !== d.saved)) { setClosing(path); return; }
    setDrafts((prev) => prev.filter((d) => d.path !== path)); if (active === path) setActive('terminal'); setClosing('');
  }

  async function perform(form: HTMLFormElement) {
    if (!action) return; const data = new FormData(form); const name = String(data.get('name'));
    try {
      if (action.kind === 'mkdir') await CreateRemoteDirectory(id, `${directory.replace(/\/$/, '')}/${name}`);
      if (action.kind === 'rename') await RenameRemotePath(id, action.path, `${action.path.slice(0, action.path.lastIndexOf('/') + 1)}${name}`);
      if (action.kind === 'delete') await DeleteRemotePath(id, action.path);
      setAction(undefined); await load(directory);
    } catch (e) { setError(String(e)); }
  }

  return <div className="ssh-workspace">
    {filesOpen && <>
      <aside className="file-panel" style={{ width }}>
        <div className="file-toolbar"><button aria-label="上级目录" onClick={() => void load(directory.slice(0, directory.lastIndexOf('/')) || '/')}>↑</button><button aria-label="刷新目录" onClick={() => void load(directory)}>刷新</button><button onClick={() => setAction({ kind: 'mkdir', path: directory })}>新建目录</button></div>
        <form onSubmit={(e) => { e.preventDefault(); void load(String(new FormData(e.currentTarget).get('path'))); }}><input key={directory} name="path" aria-label="远端目录" defaultValue={directory} /></form>
        {error && <p role="alert" className="error">{error}</p>}
        {action && <form className="file-action" onSubmit={(e) => { e.preventDefault(); void perform(e.currentTarget); }}>{action.kind === 'delete' ? <span>删除 {action.path.split('/').pop()}？</span> : <input name="name" aria-label={action.kind === 'mkdir' ? '新目录名称' : '新名称'} defaultValue={action.kind === 'rename' ? action.path.split('/').pop() : ''} required pattern="[^/]+" />}<div className="button-row"><Button size="sm" type="submit" color={action.kind === 'delete' ? 'danger' : 'default'}>确认</Button><Button size="sm" variant="light" onPress={() => setAction(undefined)}>取消</Button></div></form>}
        <ul className="file-list">{entries.map((entry) => <li key={entry.path}><button className="file-name" onClick={() => void open(entry)} title={`${entry.mode} · ${entry.size} 字节`}><span>{entry.directory ? '▸' : entry.symlink ? '↗' : '·'}</span>{entry.name}</button><details><summary aria-label={`${entry.name} 操作`}>⋯</summary><div className="file-menu"><button onClick={() => setAction({ kind: 'rename', path: entry.path })}>重命名</button><button onClick={() => setAction({ kind: 'delete', path: entry.path })}>删除</button></div></details></li>)}</ul>
      </aside>
      <div className="panel-separator" role="separator" aria-label="文件面板宽度" aria-orientation="vertical" aria-valuenow={width} aria-valuemin={160} aria-valuemax={500} tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') setWidth((w) => Math.max(160, Math.min(500, w + (e.key === 'ArrowRight' ? 10 : -10)))); }}
        onPointerDown={(e) => { const start = e.clientX; const initial = width; const element = e.currentTarget; element.setPointerCapture(e.pointerId); element.onpointermove = (event) => setWidth(Math.max(160, Math.min(500, initial + event.clientX - start))); element.onpointerup = () => { element.onpointermove = null; element.onpointerup = null; }; }} />
    </>}
    <div className="ssh-center">
      <div className="inner-tabs"><button onClick={() => { localStorage.setItem('termquay.files-width', String(width)); setFilesOpen(!filesOpen); }} aria-label={filesOpen ? '收起文件面板' : '展开文件面板'}>文件</button><button className={active === 'terminal' ? 'selected' : ''} onClick={() => setActive('terminal')}>终端</button>{drafts.map((d) => <div key={d.path} className={active === d.path ? 'selected' : ''}><button onClick={() => setActive(d.path)}>{d.path.split('/').pop()}{d.content !== d.saved ? ' ●' : ''}</button><button aria-label={`关闭文件 ${d.path}`} onClick={() => close(d.path)}>×</button></div>)}<button className="monitor-toggle" onClick={()=>setMonitorOpen(!monitorOpen)} aria-label={monitorOpen?'收起监控面板':'展开监控面板'}>监控</button></div>
      <div className="terminal-tab" hidden={active !== 'terminal'}><TerminalView id={id} /></div>
      {drafts.map((d) => <div key={d.path} className="editor-tab" hidden={active !== d.path}><div className="editor-toolbar"><span>{d.path}</span><Button size="sm" isDisabled={d.saving || d.content === d.saved} onPress={() => void save(d)}>保存</Button></div>{d.error && <p role="alert" className="error">{d.error}</p>}{closing === d.path && <div className="draft-confirm">文件有未保存修改<Button size="sm" onPress={() => { void save(d); setClosing(''); }}>保存</Button><Button size="sm" color="danger" onPress={() => close(d.path, true)}>放弃修改</Button><Button size="sm" variant="light" onPress={() => setClosing('')}>取消</Button></div>}<CodeEditor path={d.path} content={d.content} onChange={(value) => setDrafts((prev) => prev.map((item) => item.path === d.path ? { ...item, content: value } : item))} onSave={() => void save(d)} /></div>)}
    </div>
    {monitorOpen&&<MonitorPanel id={id}/>}
  </div>;
}
