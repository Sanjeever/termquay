import { useEffect, useRef, useState } from 'react';
import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react';
import { MergeView } from '@codemirror/merge';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { ReadRemoteFile } from '../../../bindings/github.com/Sanjeever/termquay/appservice';
import type { Document } from '../../../bindings/github.com/Sanjeever/termquay/internal/files/models';

export default function FileConflictView({ sessionID, path, content, onApply, onClose }: { sessionID: string; path: string; content: string; onApply(content: string, remote: Document): void; onClose(): void }) {
  const host = useRef<HTMLDivElement>(null);
  const merge = useRef<MergeView>();
  const [remote, setRemote] = useState<Document>();
  const [error, setError] = useState('');
  const snapshot = useRef(content);
  useEffect(() => { let ended=false; const request=ReadRemoteFile(sessionID,path); request.then(doc=>{if(!ended)setRemote(doc);}).catch(e=>{if(!ended)setError(String(e));}); return()=>{ended=true;request.cancel();}; }, [sessionID,path]);
  useEffect(() => {
    if(!remote||!host.current)return;
    const theme=EditorView.theme({'&':{height:'100%',background:'var(--color-background)',color:'var(--color-text)'},'.cm-scroller':{overflow:'auto',fontFamily:'var(--font-mono)'},'.cm-gutters':{background:'var(--color-surface)',color:'var(--color-muted)'},'.cm-cursor':{borderLeftColor:'var(--color-primary)'} });
    const view=new MergeView({parent:host.current,a:{doc:snapshot.current,extensions:[lineNumbers(),history(),keymap.of([{key:'Mod-s',run:()=>true},...defaultKeymap,...historyKeymap]),EditorView.lineWrapping,theme,EditorView.contentAttributes.of({'aria-label':'合并本地草稿'})]},b:{doc:remote.content,extensions:[lineNumbers(),EditorState.readOnly.of(true),EditorView.editable.of(false),EditorView.lineWrapping,theme,EditorView.contentAttributes.of({'aria-label':'最新远端内容'})]},highlightChanges:true,gutter:true});
    merge.current=view;return()=>{view.destroy();merge.current=undefined;};
  },[remote]);
  return <Modal isOpen onClose={onClose} className="app-dialog file-conflict-dialog" scrollBehavior="inside" onKeyDown={e=>{if(e.key==='Escape'&&!e.nativeEvent.isComposing){e.stopPropagation();onClose();}}}><ModalContent><ModalHeader>对比与合并</ModalHeader><ModalBody><p className="file-path">{path}</p>{error&&<p role="alert" className="error">{error}</p>}
    {!remote&&!error&&<p role="status">正在读取最新远端内容…</p>}
    <div className="conflict-labels"><span>本地草稿 · 可编辑</span><span>最新远端 · 只读</span></div><div className="conflict-editors" ref={host}/>
  </ModalBody><ModalFooter><Button variant="light" onPress={onClose}>取消</Button><Button variant="light" isDisabled={!remote} onPress={()=>navigator.clipboard.writeText(merge.current?.a.state.doc.toString()||'').catch(e=>setError(String(e)))}>复制合并草稿</Button><Button color="primary" isDisabled={!remote} onPress={()=>{if(remote&&merge.current)onApply(merge.current.a.state.doc.toString(),remote);}}>采用合并草稿与远端基线</Button></ModalFooter></ModalContent></Modal>;
}
