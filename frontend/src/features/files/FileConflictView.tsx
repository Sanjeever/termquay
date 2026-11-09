import Modal from '../../components/Modal';
import { t as translate, currentLocale } from '../../i18n/index.ts';
import { useMessageState } from '../../i18n/useMessageState.ts';
import { useTranslation } from 'react-i18next';

import { useEffect, useRef, useState } from 'react';
import { Button, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react';
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
  useTranslation();
  const host = useRef<HTMLDivElement>(null);
  const merge = useRef<MergeView>();
  const [remote, setRemote] = useState<Document | undefined>(remoteDocument);
  const [error, setError] = useMessageState('');
  const snapshot = useRef(content);
  const { appearance, dark } = useAppearance();
  const themes = useRef([new Compartment(), new Compartment()]);
  const labels = useRef([new Compartment(), new Compartment()]);
  const languages = useRef([new Compartment(),new Compartment()]);
  useEffect(() => { if (remoteDocument) { setRemote(remoteDocument); return; } let ended=false; const request=ReadRemoteFileEncoded(sessionID,path,encoding); request.then(doc=>{if(!ended)setRemote(doc);}).catch(e=>{if(!ended)setError(e);}); return()=>{ended=true;request.cancel();}; }, [sessionID,path,encoding,remoteDocument]);
  useEffect(() => {
    if(!remote||!host.current)return;
    const view=new MergeView({parent:host.current,a:{doc:snapshot.current,extensions:[languages.current[0].of([]),lineNumbers(),history(),keymap.of([{key:'Mod-s',run:()=>true},...defaultKeymap,...historyKeymap]),EditorView.lineWrapping,themes.current[0].of(editorTheme(dark)),labels.current[0].of([])]},b:{doc:remote.content,extensions:[languages.current[1].of([]),lineNumbers(),EditorState.readOnly.of(true),EditorView.editable.of(false),EditorView.lineWrapping,themes.current[1].of(editorTheme(dark)),labels.current[1].of([])]},highlightChanges:true,gutter:true});
    let ended=false;void editorLanguage(path,remote.content).then(extension=>{if(!ended)[view.a,view.b].forEach((editor,index)=>editor.dispatch({effects:languages.current[index].reconfigure(extension)}));}).catch(error=>{if(!ended)setError(error);});
    merge.current=view;return()=>{ended=true;view.destroy();merge.current=undefined;};
  },[remote]);
  useEffect(() => { [merge.current?.a, merge.current?.b].forEach((view, i) => { view?.dispatch({ effects: themes.current[i].reconfigure(editorTheme(dark)) }); view?.requestMeasure(); }); }, [dark, appearance.monoFont, remote]);
  useEffect(() => { [merge.current?.a, merge.current?.b].forEach((view, index) => view?.dispatch({ effects: labels.current[index].reconfigure(EditorView.contentAttributes.of({ 'aria-label': index ? translate('files:latestRemoteContent') : translate('files:mergeLocalDraft') })) })); }, [currentLocale(), remote]);
  return <Modal isOpen onClose={onClose} className="app-dialog file-conflict-dialog" scrollBehavior="inside" onKeyDown={e=>{if(e.key==='Escape'&&!e.nativeEvent.isComposing){e.stopPropagation();onClose();}}}><ModalContent><ModalHeader>{translate('files:compareAndMerge')}</ModalHeader><ModalBody><p className="file-path">{path}</p>{error&&<p role="alert" className="error">{error}</p>}
    {!remote&&!error&&<p role="status">{translate('files:readingLatestRemoteContent')}</p>}
    <div className="conflict-labels"><span>{translate('files:localDraftEditable')}</span><span>{translate('files:latestRemoteReadOnly')}</span></div><div className="conflict-editors" ref={host}/>
  </ModalBody><ModalFooter><Button variant="light" onPress={onClose}>{translate('files:cancel')}</Button><Button variant="light" isDisabled={!remote} onPress={()=>navigator.clipboard.writeText(merge.current?.a.state.doc.toString()||'').catch(e=>setError(e))}>{translate('files:copyMergedDraft')}</Button><Button color="primary" isDisabled={!remote} onPress={()=>{if(remote&&merge.current)onApply(lineEnding === 'CRLF' ? merge.current.a.state.doc.toString().replace(/\n/g,'\r\n') : merge.current.a.state.doc.toString(),remote);}}>{translate('files:useMergedDraftAndRemoteBaseline')}</Button></ModalFooter></ModalContent></Modal>;
}
