import { useEffect, useRef, useState } from 'react';
import { Button, Dropdown, DropdownTrigger, DropdownMenu, DropdownItem, Modal, ModalBody, ModalContent, ModalHeader, ModalFooter } from '@heroui/react';
import { Events } from '@wailsio/runtime';
import { ReadDirectory, GetDirectoryBookmarks, SetDirectoryBookmarks, CreateRemoteDirectory, RenameRemotePath, DeleteRemotePath, StartUploads, StartDownload } from '../../../bindings/github.com/Sanjeever/termquay/appservice';
import type { UploadDropResult } from '../../../bindings/github.com/Sanjeever/termquay/models';
import type { Entry } from '../../../bindings/github.com/Sanjeever/termquay/internal/files/models';
import Icon from '../../components/Icon';
import DirectorySyncDialog from './DirectorySyncDialog';

export default function FileBrowser({ id, connectionID, visible, onOpen, onClose }: { id: string; connectionID: string; visible: boolean; onOpen(entry: Entry): Promise<void>; onClose(): void }) {
  const [directory, setDirectory] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [editingPath, setEditingPath] = useState(false);
  const [action, setAction] = useState<{ kind: 'mkdir' | 'rename' | 'delete'; path: string }>();
  const [working, setWorking] = useState(false);
  const [history,setHistory]=useState<{paths:string[];index:number}>({paths:[],index:-1});
  const [bookmarks,setBookmarks]=useState<string[]>([]);
  const [filter,setFilter]=useState('');
  const [sort,setSort]=useState('name');
  const [descending,setDescending]=useState(false);
  const [showHidden,setShowHidden]=useState(true);
  const [bookmarkSaving,setBookmarkSaving]=useState(false);
  const [uploadDialog,setUploadDialog]=useState(false);
  const [overwrite,setOverwrite]=useState(false);
  const [syncOpen,setSyncOpen]=useState(false);
  const loaded = useRef(false);
  const pending = useRef<ReturnType<typeof ReadDirectory>>();
  const list = useRef<HTMLUListElement>(null);

  async function load(path: string, historyIndex?:number) {
    pending.current?.cancel(); setError(''); setLoading(true);
    const request = ReadDirectory(id, path); pending.current = request;
    try { const result = await request; if (pending.current !== request) return; setDirectory(result.path); setEntries(result.entries ?? []); setSelected(''); loaded.current = true; setHistory(prev=>{if(historyIndex!==undefined)return {...prev,index:historyIndex};if(prev.paths[prev.index]===result.path)return prev;const paths=[...prev.paths.slice(0,prev.index+1),result.path].slice(-100);return{paths,index:paths.length-1};}); }
    catch (e) { if (pending.current === request) setError(String(e)); }
    finally { if (pending.current === request) { pending.current = undefined; setLoading(false); } }
  }
  useEffect(() => { loaded.current=false; if(visible)void load(directory); return () => { const operation = pending.current; pending.current = undefined; operation?.cancel(); }; }, [id]);
  useEffect(() => { if (visible && !loaded.current && !pending.current) void load(directory); }, [visible]);
  useEffect(()=>{if(!connectionID)return;let ended=false;GetDirectoryBookmarks(connectionID).then(values=>{if(!ended)setBookmarks(values||[]);}).catch(e=>{if(!ended)setError(String(e));});return()=>{ended=true;};},[connectionID]);
  useEffect(()=>Events.On('files:upload-result',event=>{const value=event.data as UploadDropResult;if(value.workspace===id)setError([value.error,...value.result.errors||[]].filter(Boolean).join('\n'));}),[id]);
  const visibleEntries=entries.filter(entry=>(showHidden||!entry.name.startsWith('.'))&&entry.name.toLowerCase().includes(filter.toLowerCase())).sort((a,b)=>Number(b.directory)-Number(a.directory)||((sort==='size'?a.size-b.size:sort==='modified'?a.modified-b.modified:a.name.localeCompare(b.name))*(descending?-1:1))||a.name.localeCompare(b.name));
  async function toggleBookmark(){if(!directory||bookmarkSaving)return;const next=bookmarks.includes(directory)?bookmarks.filter(p=>p!==directory):[...bookmarks,directory];if(next.length>32){setError('目录书签达到上限（32 个）');return;}setBookmarkSaving(true);try{if(connectionID)await SetDirectoryBookmarks(connectionID,next);setBookmarks(next);}catch(e){setError(String(e));}finally{setBookmarkSaving(false);}}

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
  return <aside className="file-panel" aria-label="远端文件" data-file-drop-target data-workspace-id={id} data-remote-directory={directory}>
    <div className="sidebar-heading"><h2>文件</h2><button className="icon-button" aria-label="收起文件面板" onClick={onClose}><Icon name="close" width="15" /></button></div>
    <button className="session-tool" disabled={!directory} onClick={()=>setSyncOpen(true)}>目录同步</button>
    <div className="file-toolbar"><button aria-label="后退目录" disabled={loading||history.index<=0} onClick={()=>void load(history.paths[history.index-1],history.index-1)}>←</button><button aria-label="前进目录" disabled={loading||history.index>=history.paths.length-1} onClick={()=>void load(history.paths[history.index+1],history.index+1)}>→</button><Dropdown><DropdownTrigger><button disabled={bookmarkSaving||!directory} aria-label="目录书签">书签</button></DropdownTrigger><DropdownMenu aria-label="目录书签" items={[{key:'toggle',name:bookmarks.includes(directory)?'移除当前目录书签':'收藏当前目录'},...bookmarks.map(path=>({key:path,name:path}))]} onAction={key=>{if(key==='toggle')void toggleBookmark();else void load(String(key));}}>{item=><DropdownItem key={item.key}>{item.name}</DropdownItem>}</DropdownMenu></Dropdown><button aria-label="复制当前目录路径" onClick={()=>navigator.clipboard.writeText(directory).catch(e=>setError(String(e)))}>复制路径</button></div>
    <div className="file-toolbar"><button className="icon-button" aria-label="上级目录" title="上级目录" disabled={loading || directory === '/'} onClick={() => void load(parent)}><Icon name="up" /></button><button className="icon-button" aria-label="刷新目录" title="刷新目录" disabled={loading} onClick={() => void load(directory)}><Icon name="refresh" /></button><button className="icon-button" aria-label="新建目录" title="新建目录" disabled={!directory} onClick={() => { setError(''); setAction({ kind: 'mkdir', path: directory }); }}><Icon name="files" /><span>＋</span></button><button className="icon-button" aria-label="上传文件" title="上传文件" disabled={!directory} onClick={() => {setOverwrite(false);setUploadDialog(true);}}><Icon name="transfer" /></button></div>
    {editingPath ? <form className="path-form" onSubmit={e => { e.preventDefault(); void load(String(new FormData(e.currentTarget).get('path'))); setEditingPath(false); }}><input name="path" aria-label="远端目录" defaultValue={directory} autoFocus onFocus={e => e.target.select()} onKeyDown={e => { if (e.key === 'Escape') setEditingPath(false); }} onBlur={() => setEditingPath(false)} /></form> : <div className="path-bar"><div className="breadcrumbs"><button onClick={() => void load('/')} aria-label="根目录">/</button>{directory.split('/').filter(Boolean).map((part, index, parts) => <button key={index} onClick={() => void load(`/${parts.slice(0, index + 1).join('/')}`)}>{part}<span>/</span></button>)}</div><button className="path-edit" aria-label="编辑目录路径" title={directory} onClick={() => setEditingPath(true)}>…</button></div>}
    {error && <p role="alert" className="error file-error">{error}</p>}
    <div className="file-filters"><input aria-label="过滤当前目录文件名" placeholder="过滤文件名" value={filter} onChange={e=>setFilter(e.target.value)} /><div><select aria-label="文件排序" value={sort} onChange={e=>setSort(e.target.value)}><option value="name">名称</option><option value="modified">修改时间</option><option value="size">大小</option></select><button aria-label={descending?'改为升序':'改为降序'} onClick={()=>setDescending(v=>!v)}>{descending?'↓':'↑'}</button><label><input type="checkbox" checked={showHidden} onChange={e=>setShowHidden(e.target.checked)} />隐藏文件</label></div></div>
    {loading && <p className="muted" role="status">正在读取…</p>}
    <ul className="file-list" ref={list} aria-label="目录内容">{visibleEntries.map((entry, index) => <li key={entry.path} className={selected === entry.path ? 'selected' : ''}>
      {action?.kind === 'rename' && action.path === entry.path ? <form className="inline-rename" onSubmit={e => { e.preventDefault(); void perform(String(new FormData(e.currentTarget).get('name'))); }}><input aria-label="新名称" name="name" defaultValue={entry.name} required pattern="[^/]+" autoFocus disabled={working} onKeyDown={e => { if (e.key === 'Escape') setAction(undefined); }} /><Button type="submit" size="sm" isLoading={working}>保存</Button><button aria-label="取消重命名" type="button" onClick={() => setAction(undefined)}><Icon name="close" width="14" /></button></form> : <>
        <button className="file-name" onClick={() => setSelected(entry.path)} onDoubleClick={() => void open(entry)} title={`${entry.path} · ${entry.mode} · ${entry.size} 字节`} onKeyDown={e => {
          if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) { e.preventDefault(); const next = e.key === 'Home' ? 0 : e.key === 'End' ? visibleEntries.length - 1 : Math.max(0, Math.min(visibleEntries.length - 1, index + (e.key === 'ArrowDown' ? 1 : -1))); setSelected(visibleEntries[next].path); (list.current?.querySelectorAll('.file-name')[next] as HTMLElement)?.focus(); }
          if (e.key === 'Enter') { e.preventDefault(); void open(entry); }
          if (e.key === 'F2' || e.key === 'Delete') { e.preventDefault(); setError(''); setAction({ kind: e.key === 'F2' ? 'rename' : 'delete', path: entry.path }); }
        }}><span>{entry.directory ? <Icon name="files" width="15" height="15" /> : entry.symlink ? '↗' : '·'}</span><span className="file-entry-name">{entry.name}</span></button>
        <Dropdown><DropdownTrigger><button className="icon-button row-menu" aria-label={`${entry.name} 操作`}><Icon name="more" width="16" /></button></DropdownTrigger><DropdownMenu aria-label={`${entry.name} 操作`} onAction={key => { setError(''); if (key === 'open') void open(entry); else if (key === 'download') StartDownload(id, entry.path).catch(e => setError(String(e))); else if(key==='copy')navigator.clipboard.writeText(entry.path).catch(e=>setError(String(e)));else setAction({ kind: key as 'rename' | 'delete', path: entry.path }); }}><DropdownItem key="open">打开</DropdownItem><DropdownItem key="download" className={entry.directory ? 'hidden' : ''}>下载</DropdownItem><DropdownItem key="copy">复制完整路径</DropdownItem><DropdownItem key="rename">重命名</DropdownItem><DropdownItem key="delete" color="danger">删除</DropdownItem></DropdownMenu></Dropdown>
      </>}
    </li>)}</ul>
    {loaded.current && !loading && entries.length === 0 && <p className="sidebar-empty">空目录</p>}
    {syncOpen&&<DirectorySyncDialog key={id} id={id} remote={directory} onClose={()=>setSyncOpen(false)}/>}
    <Modal isOpen={uploadDialog} onClose={()=>setUploadDialog(false)} className="app-dialog"><ModalContent><ModalHeader>上传文件</ModalHeader><ModalBody><p className="file-path">{directory}</p><label className="checkbox-label"><input type="checkbox" checked={overwrite} onChange={e=>setOverwrite(e.target.checked)} />覆盖同名普通文件</label></ModalBody><ModalFooter><Button variant="light" onPress={()=>setUploadDialog(false)}>取消</Button><Button color="primary" onPress={async()=>{setUploadDialog(false);try{const result=await StartUploads(id,directory,overwrite);setError((result.errors||[]).join('\n'));}catch(e){setError(String(e));}}}>选择文件</Button></ModalFooter></ModalContent></Modal>
    <Modal isOpen={!!action && action.kind !== 'rename'} onClose={() => !working && setAction(undefined)} className="app-dialog"><ModalContent><ModalHeader>{action?.kind === 'mkdir' ? '新建目录' : '删除远端路径'}</ModalHeader><form onSubmit={e => { e.preventDefault(); void perform(String(new FormData(e.currentTarget).get('name') || '')); }}><ModalBody>{action?.kind === 'delete' ? <p>确认删除 <code>{action.path}</code>？</p> : <label className="form-field">目录名称<input className="native-input" name="name" aria-label="目录名称" required pattern="[^/]+" autoFocus /></label>}{error && <p role="alert" className="error">{error}</p>}</ModalBody><ModalFooter><Button variant="light" isDisabled={working} onPress={() => setAction(undefined)}>取消</Button><Button type="submit" color={action?.kind === 'delete' ? 'danger' : 'primary'} isLoading={working}>{action?.kind === 'delete' ? '删除' : '创建'}</Button></ModalFooter></form></ModalContent></Modal>
  </aside>;
}
