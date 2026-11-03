import { Fragment, useEffect, useRef, useState } from 'react';
import { Button, Dropdown, DropdownTrigger, DropdownMenu, DropdownItem, Modal, ModalBody, ModalContent, ModalHeader, ModalFooter, Tooltip } from '@heroui/react';
import { Events } from '@wailsio/runtime';
import { GetDirectoryBookmarks, SetDirectoryBookmarks, CreateRemoteDirectory, RenameRemotePath, DeleteRemotePath, StartUploads, StartDownload, StartDownloads, MoveRemotePaths, DeleteRemotePaths } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { UploadDropResult } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import type { Entry } from '../../../bindings/github.com/Sanjeever/termquay/internal/files/models';
import Icon from '../../components/Icon';
import DirectorySyncDialog from './DirectorySyncDialog';
import { selectItems } from '../../lib/selection';
import type { RemotePathResult } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import useFileTree from './useFileTree';
import { entryMetadata, fileTreeRows, inDirectory } from './fileTree';
import FileIcon from './FileIcon';
import RemoteLogDialog from './RemoteLogDialog';

function FileMetadata({entry}:{entry:Entry}) {
  return <dl className="file-tooltip">{entryMetadata(entry).map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}

export default function FileBrowser({ id, connectionID, visible, onOpen, onClose, initialDirectory='', onDirectory, directoryRequest, followDirectory, onFollowDirectory, onTerminalDirectory }: { id: string; connectionID: string; visible: boolean; onOpen(entry: Entry): Promise<void>; onClose(): void; initialDirectory?:string; onDirectory?(path:string):void; directoryRequest?: { path: string; sequence: number }; followDirectory?: boolean; onFollowDirectory?(): void; onTerminalDirectory?(path: string): void }) {
  const [directory, setDirectory] = useState(initialDirectory);
  const tree = useFileTree(id, visible);
  const [selected, setSelected] = useState('');
  const [selection,setSelection]=useState<string[]>([]);
  const anchor=useRef('');
  const [menu,setMenu]=useState('');
  const [batch,setBatch]=useState<{kind:'download'|'move'|'delete';paths:string[]}>();
  const [results,setResults]=useState<RemotePathResult[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [editingPath, setEditingPath] = useState(false);
  const [action, setAction] = useState<{ kind: 'mkdir' | 'rename' | 'delete'; path: string }>();
  const [working, setWorking] = useState(false);
  const [history,setHistory]=useState<{paths:string[];index:number}>({paths:[],index:-1});
  const [bookmarks,setBookmarks]=useState<string[]>([]);
  const [filter,setFilter]=useState('');
  const [filterOpen,setFilterOpen]=useState(false);
  const [sort,setSort]=useState('name');
  const [descending,setDescending]=useState(false);
  const [showHidden,setShowHidden]=useState(true);
  const [bookmarkSaving,setBookmarkSaving]=useState(false);
  const [uploadDialog,setUploadDialog]=useState(false);
  const [overwrite,setOverwrite]=useState(false);
  const [syncOpen,setSyncOpen]=useState(false);
  const [logPath,setLogPath]=useState('');
  const loaded = useRef(false);
  const pending = useRef<ReturnType<typeof tree.reveal>>();
  const list = useRef<HTMLUListElement>(null);
  const lastDirectoryRequest = useRef(0);
  useEffect(() => { if (visible && directoryRequest && lastDirectoryRequest.current !== directoryRequest.sequence) { lastDirectoryRequest.current = directoryRequest.sequence; void load(directoryRequest.path); } }, [visible, directoryRequest]);

  async function load(path: string, historyIndex?:number, refresh=false) {
    setError(''); setLoading(true);
    const request = (async()=>{if(refresh)await tree.refresh();return tree.reveal(path);})(); pending.current = request;
    try { const result = await request; if (pending.current !== request) return; setDirectory(result.path);onDirectory?.(result.path); setSelected(result.path); setSelection([]); loaded.current = true; setHistory(prev=>{if(historyIndex!==undefined)return {...prev,index:historyIndex};if(prev.paths[prev.index]===result.path)return prev;const paths=[...prev.paths.slice(0,prev.index+1),result.path].slice(-100);return{paths,index:paths.length-1};}); requestAnimationFrame(()=>list.current?.querySelector<HTMLElement>(`[data-tree-path="${CSS.escape(result.path)}"]`)?.scrollIntoView({block:'nearest'})); }
    catch (e) { if (pending.current === request) setError(String(e)); }
    finally { if (pending.current === request) { pending.current = undefined; setLoading(false); } }
  }
  useEffect(() => { loaded.current=false; if(visible)void load(directory); return () => { pending.current = undefined; }; }, [id]);
  useEffect(() => { if (visible && !loaded.current && !pending.current) void load(directory); if(!visible&&pending.current){pending.current=undefined;loaded.current=false;setLoading(false);} }, [visible]);
  useEffect(()=>{if(!connectionID)return;let ended=false;GetDirectoryBookmarks(connectionID).then(values=>{if(!ended)setBookmarks(values||[]);}).catch(e=>{if(!ended)setError(String(e));});return()=>{ended=true;};},[connectionID]);
  useEffect(()=>Events.On('files:upload-result',event=>{const value=event.data as UploadDropResult;if(value.workspace===id)setError([value.error,...value.result.errors||[]].filter(Boolean).join('\n'));}),[id]);
  const rows=fileTreeRows(tree.nodes,tree.expanded,{filter,showHidden,sort,descending});
  const visibleEntries=rows.map(row=>row.entry);
  const focusedVisible=visibleEntries.some(entry=>entry.path===selected);
  const root=tree.nodes['/'];
  function focusEntry(path:string){setSelected(path);requestAnimationFrame(()=>list.current?.querySelector<HTMLElement>(`[data-tree-path="${CSS.escape(path)}"]`)?.focus());}
  function toggle(path:string){setError('');if(tree.expanded.has(path)){tree.collapse(path);setSelection(prev=>prev.filter(value=>value===path||!inDirectory(value,path)));if(selected!==path&&inDirectory(selected,path))focusEntry(path);}else void tree.expand(path).catch(e=>{if(e instanceof RangeError)setError(String(e));});}
  const selectedEntries=visibleEntries.filter(entry=>selection.includes(entry.path));
  function pick(path:string,toggle=false,range=false){setSelected(path);setSelection(prev=>selectItems(visibleEntries.map(e=>e.path),prev,path,anchor.current,toggle,range));if(!range)anchor.current=path;}
  const regular=(entry:Entry)=>!entry.directory&&!entry.symlink&&entry.mode.startsWith('-');
  function batchAction(kind:'download'|'move'|'delete',entry?:Entry){const paths=entry&&!selectedEntries.some(e=>e.path===entry.path)?[entry.path]:selectedEntries.map(e=>e.path);setError('');setOverwrite(false);setBatch({kind,paths});}
  async function performBatch(target:string){if(!batch||working)return;setWorking(true);setError('');try{
    if(batch.kind==='download'){const result=await StartDownloads(id,batch.paths,overwrite);setResults([...(result.items||[]).map(t=>({path:t.name,target:'',state:'queued',error:''})),...(result.errors||[]).map(error=>({path:'',target:'',state:'not_run',error}))]);}
    else{setResults(await (batch.kind==='move'?MoveRemotePaths(id,batch.paths,target):DeleteRemotePaths(id,batch.paths))||[]);await load(directory,undefined,true);}
    setBatch(undefined);
  }catch(e){setError(String(e));}finally{setWorking(false);}}
  async function toggleBookmark(){if(!directory||bookmarkSaving)return;const next=bookmarks.includes(directory)?bookmarks.filter(p=>p!==directory):[...bookmarks,directory];if(next.length>32){setError('目录书签达到上限（32 个）');return;}setBookmarkSaving(true);try{if(connectionID)await SetDirectoryBookmarks(connectionID,next);setBookmarks(next);}catch(e){setError(String(e));}finally{setBookmarkSaving(false);}}

  async function open(entry: Entry) { if (entry.directory) await load(entry.path); else { try { setError(''); await onOpen(entry); } catch (e) { setError(String(e)); } } }
  async function perform(name = '') {
    if (!action || working) return; setWorking(true); setError('');
    try {
      if (action.kind === 'mkdir') await CreateRemoteDirectory(id, `${directory.replace(/\/$/, '')}/${name}`);
      if (action.kind === 'rename') await RenameRemotePath(id, action.path, `${action.path.slice(0, action.path.lastIndexOf('/') + 1)}${name}`);
      if (action.kind === 'delete') await DeleteRemotePath(id, action.path);
      setAction(undefined); await load(directory,undefined,true);
    } catch (e) { setError(String(e)); } finally { setWorking(false); }
  }
  function keyDown(e:React.KeyboardEvent,entry:Entry,index:number){
    if(e.nativeEvent.isComposing||e.defaultPrevented||(e.target as HTMLElement).closest('input,textarea,select,[role=menu]'))return;
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='a'){e.preventDefault();setSelection(visibleEntries.map(e=>e.path));}
    if(e.key===' '){e.preventDefault();pick(entry.path,true,e.shiftKey);}
    if(e.key==='ContextMenu'||(e.shiftKey&&e.key==='F10')){e.preventDefault();if(!selection.includes(entry.path))pick(entry.path);setMenu(entry.path);}
    if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?rows.length-1:Math.max(0,Math.min(rows.length-1,index+(e.key==='ArrowDown'?1:-1)));pick(rows[next].entry.path,false,e.shiftKey);focusEntry(rows[next].entry.path);}
    if(e.key==='ArrowRight'&&entry.directory){e.preventDefault();if(!tree.expanded.has(entry.path))toggle(entry.path);else if(rows[index+1]?.parent===entry.path){pick(rows[index+1].entry.path);focusEntry(rows[index+1].entry.path);}}
    if(e.key==='ArrowLeft'){e.preventDefault();if(entry.directory&&tree.expanded.has(entry.path))toggle(entry.path);else if(rows[index].parent!=='/'){pick(rows[index].parent);focusEntry(rows[index].parent);}}
    if(e.key==='Enter'){e.preventDefault();void open(entry);}
    if(e.key==='F2'&&selectedEntries.length<=1){e.preventDefault();setError('');setAction({kind:'rename',path:entry.path});}
    if(e.key==='Delete'){e.preventDefault();batchAction('delete',entry);}
  }
  const parent = directory.slice(0, directory.lastIndexOf('/')) || '/';
  return <aside className="file-panel" aria-label="远端文件" data-file-drop-target data-workspace-id={id} data-remote-directory={directory}>
    <div className="sidebar-heading file-heading"><h2>文件</h2><button className="icon-button" aria-label="新建目录" disabled={!directory} onClick={() => { setError(''); setAction({ kind: 'mkdir', path: directory }); }}><Icon name="plus" width="15" /></button><button className="icon-button" aria-label="上传文件" disabled={!directory} onClick={() => {setOverwrite(false);setUploadDialog(true);}}><Icon name="transfer" width="15" /></button><button className="icon-button" aria-label="过滤文件" aria-pressed={filterOpen || !!filter} onClick={() => setFilterOpen(v=>!v)}><Icon name="search" width="15" /></button><Dropdown><DropdownTrigger><button className="icon-button" aria-label="文件视图选项"><Icon name="more" width="15" /></button></DropdownTrigger><DropdownMenu aria-label="文件视图选项" closeOnSelect={false} onAction={key=>{if(key==='follow')onFollowDirectory?.();if(key==='terminal')onTerminalDirectory?.(directory);if(key==='sync')setSyncOpen(true);if(key==='copy')navigator.clipboard.writeText(directory).catch(e=>setError(String(e)));if(key==='hidden')setShowHidden(v=>!v);if(key==='direction')setDescending(v=>!v);if(['name','modified','size'].includes(String(key)))setSort(String(key));}}><DropdownItem key="name" endContent={sort==='name'?'✓':null}>按名称排序</DropdownItem><DropdownItem key="modified" endContent={sort==='modified'?'✓':null}>按修改时间排序</DropdownItem><DropdownItem key="size" endContent={sort==='size'?'✓':null}>按大小排序</DropdownItem><DropdownItem key="direction">{descending?'改为升序':'改为降序'}</DropdownItem><DropdownItem key="hidden" endContent={showHidden?'✓':null} aria-label={`显示隐藏文件，${showHidden?'已开启':'已关闭'}`}>显示隐藏文件</DropdownItem><DropdownItem key="follow" endContent={followDirectory?'✓':null}>跟随终端目录</DropdownItem><DropdownItem key="terminal" isDisabled={!directory}>在终端定位此目录</DropdownItem><DropdownItem key="copy" isDisabled={!directory}>复制当前目录路径</DropdownItem><DropdownItem key="sync" isDisabled={!directory}>目录同步</DropdownItem></DropdownMenu></Dropdown><button className="icon-button" aria-label="收起文件面板" onClick={onClose}><Icon name="close" width="15" /></button></div>
    <div className="file-toolbar"><button className="icon-button" aria-label="后退目录" title="后退目录" disabled={loading||history.index<=0} onClick={()=>void load(history.paths[history.index-1],history.index-1)}><Icon name="back" width="15" /></button><button className="icon-button" aria-label="前进目录" title="前进目录" disabled={loading||history.index>=history.paths.length-1} onClick={()=>void load(history.paths[history.index+1],history.index+1)}><Icon name="back" width="15" style={{transform:'rotate(180deg)'}} /></button><button className="icon-button" aria-label="上级目录" title="上级目录" disabled={loading || directory === '/'} onClick={() => void load(parent)}><Icon name="up" width="15" /></button><button className="icon-button" aria-label="刷新目录" title="刷新目录" disabled={loading} onClick={() => void load(directory,undefined,true)}><Icon name="refresh" width="15" /></button><Dropdown><DropdownTrigger><button className="session-tool" disabled={bookmarkSaving||!directory} aria-label="目录书签">书签</button></DropdownTrigger><DropdownMenu aria-label="目录书签" items={[{key:'toggle',name:bookmarks.includes(directory)?'移除当前目录书签':'收藏当前目录'},...bookmarks.map(path=>({key:path,name:path}))]} onAction={key=>{if(key==='toggle')void toggleBookmark();else void load(String(key));}}>{item=><DropdownItem key={item.key}>{item.name}</DropdownItem>}</DropdownMenu></Dropdown></div>
    {editingPath ? <form className="path-form" onSubmit={e => { e.preventDefault(); void load(String(new FormData(e.currentTarget).get('path'))); setEditingPath(false); }}><input name="path" aria-label="远端目录" defaultValue={directory} autoFocus onFocus={e => e.target.select()} onKeyDown={e => { if (e.key === 'Escape') setEditingPath(false); }} onBlur={() => setEditingPath(false)} /></form> : <div className="path-bar"><div className="breadcrumbs"><button onClick={() => void load('/')} aria-label="根目录">/</button>{directory.split('/').filter(Boolean).map((part, index, parts) => <button key={index} onClick={() => void load(`/${parts.slice(0, index + 1).join('/')}`)}>{part}<span>/</span></button>)}</div><button className="path-edit" aria-label="编辑目录路径" title={`编辑目录路径 · ${directory}`} onClick={() => setEditingPath(true)}><Icon name="edit" width="13" /></button></div>}
    {(error||root?.error) && <p role="alert" className="error file-error">{error||root?.error}<button className="session-tool" onClick={()=>void load(directory)}>重试</button></p>}
    <div className="file-filters" hidden={!filterOpen && !filter}><input aria-label="过滤已展开目录文件名" placeholder="过滤已展开目录" value={filter} onChange={e=>setFilter(e.target.value)} onKeyDown={e=>{if(e.key==='Escape'&&!e.nativeEvent.isComposing){setFilter('');setFilterOpen(false);}}} /></div>
    {(loading||root?.loading) && <p className="muted" role="status">正在读取…</p>}
    <div className="file-selection" style={{visibility:selectedEntries.length?'visible':'hidden'}}><label><input type="checkbox" aria-label="选择全部可见文件" checked={selectedEntries.length===visibleEntries.length} onChange={e=>setSelection(e.target.checked?visibleEntries.map(e=>e.path):[])} />{selectedEntries.length} 项</label><button disabled={working||!selectedEntries.every(regular)} onClick={()=>batchAction('download')}>下载</button><button disabled={working||selectedEntries.some(e=>!regular(e)&&!e.directory&&!e.symlink)} onClick={()=>batchAction('move')}>移动</button><button disabled={working} onClick={()=>batchAction('delete')}>删除</button></div>
    {!!results.length&&<details className="file-results" open><summary>批量操作结果 <button aria-label="关闭批量结果" onClick={e=>{e.preventDefault();setResults([]);}}>×</button></summary>{results.map((result,index)=><p key={index} className={['failed','not_run'].includes(result.state)?'error':'muted'}>{({done:'已完成',queued:'已入队',failed:'失败',skipped:'已跳过',not_run:'未执行'} as Record<string,string>)[result.state]} · {result.path}{result.error&&` · ${result.error}`}</p>)}</details>}
    <ul className="file-list file-tree" ref={list} role="tree" aria-label="远端目录树" aria-multiselectable="true">{rows.map(({entry,depth,parent,position,siblings}, index) => <Fragment key={entry.path}><Tooltip placement="right" delay={450} closeDelay={0} isDisabled={menu===entry.path||!!action||!!batch} content={<FileMetadata entry={entry} />}><li role="treeitem" aria-label={entry.name} aria-level={depth+1} aria-posinset={position} aria-setsize={siblings} aria-expanded={entry.directory?tree.expanded.has(entry.path):undefined} aria-selected={selection.includes(entry.path)} data-tree-path={entry.path} data-file-drop-target data-workspace-id={id} data-remote-directory={entry.directory?entry.path:parent} tabIndex={focusedVisible?selected===entry.path?0:-1:index===0?0:-1} style={{paddingInlineStart:4+depth*14}} className={selection.includes(entry.path) ? 'selected' : ''} onKeyDown={e=>keyDown(e,entry,index)} onContextMenu={e=>{e.preventDefault();if(!selection.includes(entry.path))pick(entry.path);setMenu(entry.path);}}>
      {entry.directory?<button className="tree-expand" tabIndex={-1} aria-label={`${tree.expanded.has(entry.path)?'收起':'展开'}目录 ${entry.path}`} aria-expanded={tree.expanded.has(entry.path)} onClick={()=>toggle(entry.path)}><Icon name="chevron" width="11" height="11" style={{transform:tree.expanded.has(entry.path)?'rotate(90deg)':undefined}} /></button>:<span className="tree-expand" />}
      {action?.kind === 'rename' && action.path === entry.path ? <form className="inline-rename" onSubmit={e => { e.preventDefault(); void perform(String(new FormData(e.currentTarget).get('name'))); }}><input aria-label="新名称" name="name" defaultValue={entry.name} required pattern="[^/]+" autoFocus disabled={working} onKeyDown={e => { if (e.key === 'Escape') setAction(undefined); }} /><Button type="submit" size="sm" isLoading={working}>保存</Button><button aria-label="取消重命名" type="button" onClick={() => setAction(undefined)}><Icon name="close" width="14" /></button></form> : <>
        <button className="file-name" tabIndex={-1} aria-pressed={selection.includes(entry.path)} onClick={e => { pick(entry.path,e.ctrlKey||e.metaKey,e.shiftKey); if (entry.directory && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.detail < 2) toggle(entry.path); }} onDoubleClick={() => { if (!entry.directory) void open(entry); }}><FileIcon {...entry} expanded={tree.expanded.has(entry.path)} /><span className="file-entry-name">{entry.name}</span>{entry.symlink && <span className="file-link-target">→ {entry.link_target || '无法读取目标'}</span>}</button>
        <span className="file-metadata" title={`${entry.size} 字节`}>{entry.directory ? '' : entry.size.toLocaleString()}</span><span className="file-metadata">{new Date(entry.modified).toLocaleDateString()}</span><span className="file-metadata">{entry.mode}</span>
        <Dropdown isOpen={menu===entry.path} onOpenChange={open=>setMenu(open?entry.path:'')}><DropdownTrigger><button className="icon-button row-menu" aria-label={`${entry.name} 操作`}><Icon name="more" width="16" /></button></DropdownTrigger><DropdownMenu aria-label={`${entry.name} 操作`} disabledKeys={working?['open','log','download','move','rename','delete']:[]} onAction={key => { setError(''); const multiple=selectedEntries.length>1&&selection.includes(entry.path);if(key==='log')setLogPath(entry.path);if(key==='open')void open(entry);if(key==='download'){if(multiple)batchAction('download',entry);else StartDownload(id,entry.path).catch(e=>setError(String(e)));}if(key==='move'||key==='delete')batchAction(key,entry);if(key==='copy')navigator.clipboard.writeText(entry.path).catch(e=>setError(String(e)));if(key==='rename')setAction({kind:'rename',path:entry.path}); }}><DropdownItem key="open">打开</DropdownItem><DropdownItem key="log" isDisabled={!regular(entry)}>查看日志 / 大文件</DropdownItem><DropdownItem key="download" isDisabled={selection.includes(entry.path)?!selectedEntries.every(regular):!regular(entry)}>下载</DropdownItem><DropdownItem key="move" isDisabled={selection.includes(entry.path)?selectedEntries.some(e=>!regular(e)&&!e.directory&&!e.symlink):!regular(entry)&&!entry.directory&&!entry.symlink}>移动到目录</DropdownItem><DropdownItem key="copy">复制完整路径</DropdownItem><DropdownItem key="rename" isDisabled={selectedEntries.length>1&&selection.includes(entry.path)}>重命名</DropdownItem><DropdownItem key="delete" color="danger">删除</DropdownItem></DropdownMenu></Dropdown>
      </>}
    </li></Tooltip>{entry.directory&&tree.expanded.has(entry.path)&&<>
      {tree.nodes[entry.path]?.loading&&<li role="none" className="tree-message" style={{paddingInlineStart:22+(depth+1)*14}}><span role="status">正在读取…</span></li>}
      {tree.nodes[entry.path]?.error&&<li role="none" className="tree-message error" style={{paddingInlineStart:22+(depth+1)*14}}><details><summary>目录读取失败</summary>{tree.nodes[entry.path].error}</details><button aria-label={`重试读取 ${entry.path}`} onClick={()=>void tree.read(entry.path,true).catch(()=>{})}>重试</button></li>}
      {!tree.nodes[entry.path]?.loading&&!tree.nodes[entry.path]?.error&&tree.nodes[entry.path]?.entries?.length===0&&<li role="none" className="tree-message" style={{paddingInlineStart:22+(depth+1)*14}}>空目录</li>}
    </>}</Fragment>)}</ul>
    {root?.entries && !root.loading && !loading && !error && visibleEntries.length === 0 && <p className="sidebar-empty">{root.entries.length === 0 ? '空目录' : filter ? '没有匹配文件' : '没有可见文件'}</p>}
    <Modal isOpen={!!batch} onClose={()=>!working&&setBatch(undefined)} isDismissable={!working} isKeyboardDismissDisabled={working} className="app-dialog"><ModalContent><ModalHeader>{batch?.kind==='download'?'下载':batch?.kind==='move'?'移动':'删除'} {batch?.paths.length} 项</ModalHeader><form onSubmit={e=>{e.preventDefault();void performBatch(String(new FormData(e.currentTarget).get('directory')||''));}}><ModalBody><ul className="batch-paths">{batch?.paths.map(path=><li className="file-path" key={path}>{path}</li>)}</ul>{batch?.kind==='download'&&<label className="checkbox-label"><input type="checkbox" checked={overwrite} disabled={working} onChange={e=>setOverwrite(e.target.checked)} />覆盖同名普通文件</label>}{batch?.kind==='move'&&<label className="form-field">远端目标目录<input className="native-input" name="directory" aria-label="远端目标目录" required defaultValue={directory} disabled={working} /></label>}{batch?.kind==='delete'&&<p className="muted">目录须为空，删除后无法撤销。</p>}{error&&<p role="alert" className="error">{error}</p>}</ModalBody><ModalFooter><Button variant="light" isDisabled={working} onPress={()=>setBatch(undefined)}>取消</Button><Button type="submit" color={batch?.kind==='delete'?'danger':'primary'} isLoading={working}>{batch?.kind==='download'?'选择下载目录':batch?.kind==='move'?'移动':'删除'}</Button></ModalFooter></form></ModalContent></Modal>
    {syncOpen&&<DirectorySyncDialog key={id} id={id} remote={directory} connectionID={connectionID} onClose={()=>setSyncOpen(false)}/>}
    {logPath&&<RemoteLogDialog key={`${id}:${logPath}`} workspace={id} path={logPath} visible={visible} onClose={()=>setLogPath('')}/>}
    <Modal isOpen={uploadDialog} onClose={()=>setUploadDialog(false)} className="app-dialog"><ModalContent><ModalHeader>上传文件</ModalHeader><ModalBody><p className="file-path">{directory}</p><label className="checkbox-label"><input type="checkbox" checked={overwrite} onChange={e=>setOverwrite(e.target.checked)} />覆盖同名普通文件</label></ModalBody><ModalFooter><Button variant="light" onPress={()=>setUploadDialog(false)}>取消</Button><Button color="primary" onPress={async()=>{setUploadDialog(false);try{const result=await StartUploads(id,directory,overwrite);setError((result.errors||[]).join('\n'));}catch(e){setError(String(e));}}}>选择文件</Button></ModalFooter></ModalContent></Modal>
    <Modal isOpen={!!action && action.kind !== 'rename'} onClose={() => !working && setAction(undefined)} className="app-dialog"><ModalContent><ModalHeader>{action?.kind === 'mkdir' ? '新建目录' : '删除远端路径'}</ModalHeader><form onSubmit={e => { e.preventDefault(); void perform(String(new FormData(e.currentTarget).get('name') || '')); }}><ModalBody>{action?.kind === 'delete' ? <p>确认删除 <code>{action.path}</code>？</p> : <label className="form-field">目录名称<input className="native-input" name="name" aria-label="目录名称" required pattern="[^/]+" autoFocus /></label>}{error && <p role="alert" className="error">{error}</p>}</ModalBody><ModalFooter><Button variant="light" isDisabled={working} onPress={() => setAction(undefined)}>取消</Button><Button type="submit" color={action?.kind === 'delete' ? 'danger' : 'primary'} isLoading={working}>{action?.kind === 'delete' ? '删除' : '创建'}</Button></ModalFooter></form></ModalContent></Modal>
  </aside>;
}
