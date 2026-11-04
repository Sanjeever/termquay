import { errorMessage } from "../../lib/errors";
import { useEffect, useRef, useState } from 'react';
import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react';
import { MergeView } from '@codemirror/merge';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { ReadRemoteFileEncoded } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { Document } from '../../../bindings/github.com/Sanjeever/termquay/internal/files/models';
import { useAppearance } from '../settings/AppearanceProvider';
import { editorTheme } from './editorTheme';
import { editorLanguage } from './editorLanguage';

export default function FileConflictView({ sessionID, path, content, encoding, lineEnding, remoteDocument, onApply, onClose }: { sessionID: string; path: string; content: string; encoding: string; lineEnding: string; remoteDocument?: Document; onApply(content: string, remote: Document): void; onClose(): void }) {
  const host = useRef<HTMLDivElement>(null);
  const merge = useRef<MergeView>();
  const [remote, setRemote] = useState<Document | undefined>(remoteDocument);
  const [error, setError] = useState('');
  const snapshot = useRef(content);
  const { appearance, dark } = useAppearance();
  const themes = useRef([new Compartment(), new Compartment()]);
  const languages = useRef([new Compartment(),new Compartment()]);
  useEffect(() => { if (remoteDocument) { setRemote(remoteDocument); return; } let ended=false; const request=ReadRemoteFileEncoded(sessionID,path,encoding); request.then(doc=>{if(!ended)setRemote(doc);}).catch(e=>{if(!ended)setError(errorMessage(e));}); return()=>{ended=true;request.cancel();}; }, [sessionID,path,encoding,remoteDocument]);
  useEffect(() => {
    if(!remote||!host.current)return;
    const view=new MergeView({parent:host.current,a:{doc:snapshot.current,extensions:[languages.current[0].of([]),lineNumbers(),history(),keymap.of([{key:'Mod-s',run:()=>true},...defaultKeymap,...historyKeymap]),EditorView.lineWrapping,themes.current[0].of(editorTheme(dark)),EditorView.contentAttributes.of({'aria-label':'合并本地草稿'})]},b:{doc:remote.content,extensions:[languages.current[1].of([]),lineNumbers(),EditorState.readOnly.of(true),EditorView.editable.of(false),EditorView.lineWrapping,themes.current[1].of(editorTheme(dark)),EditorView.contentAttributes.of({'aria-label':'最新远端内容'})]},highlightChanges:true,gutter:true});
    let ended=false;void editorLanguage(path,remote.content).then(extension=>{if(!ended)[view.a,view.b].forEach((editor,index)=>editor.dispatch({effects:languages.current[index].reconfigure(extension)}));}).catch(error=>{if(!ended)setError(errorMessage(error));});
    merge.current=view;return()=>{ended=true;view.destroy();merge.current=undefined;};
  },[remote]);
  useEffect(() => { [merge.current?.a, merge.current?.b].forEach((view, i) => { view?.dispatch({ effects: themes.current[i].reconfigure(editorTheme(dark)) }); view?.requestMeasure(); }); }, [dark, appearance.monoFont, remote]);
  return <Modal isOpen onClose={onClose} className="app-dialog file-conflict-dialog" scrollBehavior="inside" onKeyDown={e=>{if(e.key==='Escape'&&!e.nativeEvent.isComposing){e.stopPropagation();onClose();}}}><ModalContent><ModalHeader>对比与合并</ModalHeader><ModalBody><p className="file-path">{path}</p>{error&&<p role="alert" className="error">{error}</p>}
    {!remote&&!error&&<p role="status">正在读取最新远端内容…</p>}
    <div className="conflict-labels"><span>本地草稿 · 可编辑</span><span>最新远端 · 只读</span></div><div className="conflict-editors" ref={host}/>
  </ModalBody><ModalFooter><Button variant="light" onPress={onClose}>取消</Button><Button variant="light" isDisabled={!remote} onPress={()=>navigator.clipboard.writeText(merge.current?.a.state.doc.toString()||'').catch(e=>setError(errorMessage(e)))}>复制合并草稿</Button><Button color="primary" isDisabled={!remote} onPress={()=>{if(remote&&merge.current)onApply(lineEnding === 'CRLF' ? merge.current.a.state.doc.toString().replace(/\n/g,'\r\n') : merge.current.a.state.doc.toString(),remote);}}>采用合并草稿与远端基线</Button></ModalFooter></ModalContent></Modal>;
}
