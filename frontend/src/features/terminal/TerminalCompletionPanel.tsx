import { eventError, errorMessage } from '../../lib/errors.ts';
import { t as translate } from '../../i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type useTerminalCompletion from './useTerminalCompletion';
import { commandContext } from './terminalCompletion';

const kinds={get command() { return translate('terminal:command'); },get option() { return translate('terminal:options'); },get value() { return translate('terminal:parameter'); },get file() { return translate('terminal:file'); },get directory() { return translate('terminal:directory'); }};
export default function TerminalCompletion({completion,onHelp}:{completion:ReturnType<typeof useTerminalCompletion>;onHelp(command?:string):void}) {
  useTranslation();
  const {view}=completion;
  const id=useId();
  const list=useRef<HTMLUListElement>(null);
  const panel=useRef<HTMLElement>(null);
  const [position,setPosition]=useState<CSSProperties>({left:8,bottom:32});
  useLayoutEffect(()=>{
    if(!view||!panel.current)return;
    const parent=panel.current.closest('.terminal-view')!,rect=parent.getBoundingClientRect(),anchor=completion.anchor();
    if(!anchor)return;
    const width=Math.min(720,rect.width-16),x=Math.max(8,Math.min(anchor.x-rect.left,rect.width-width-8)),y=anchor.y-rect.top,below=rect.height-y-anchor.rowHeight;
    setPosition({left:x,width,maxHeight:Math.max(64,Math.min(320,(below>=160?below:y)-8)),...(below>=160?{top:y+anchor.rowHeight+4}:{bottom:rect.height-y+4})});
  },[view?.snapshot.sequence]);
  useEffect(()=>{
    if(!view)return;
    const input=panel.current?.closest('.terminal-view')?.querySelector('textarea');if(!input)return;
    const attributes=['aria-controls','aria-expanded','aria-activedescendant'];
    const previous=attributes.map(name=>input.getAttribute(name));
    input.setAttribute('aria-controls',id);input.setAttribute('aria-expanded','true');
    if(view.candidates.length)input.setAttribute('aria-activedescendant',`${id}-${view.selected}`);
    return()=>attributes.forEach((name,index)=>previous[index]===null?input.removeAttribute(name):input.setAttribute(name,previous[index]!));
  },[!!view,view?.selected,id]);
  useEffect(()=>{list.current?.querySelector('[aria-selected=true]')?.scrollIntoView({block:'nearest'});},[view?.selected,view?.snapshot.sequence]);
  if(!view)return null;
  const currentContext = commandContext(view.snapshot);
  const candidates = view.candidates.map(candidate => currentContext.candidates.find(item => item.text === candidate.text) || candidate);
  const selected=candidates[view.selected];
  return <section ref={panel} style={position} className="terminal-completion" aria-label={translate('terminal:terminalCompletion')} onPointerDown={event=>event.preventDefault()}>
    <div className="terminal-completion-heading"><span>{view.context.command?.name||translate('terminal:commandCompletion')}</span><button className="session-tool" onClick={()=>onHelp(view.context.command?.name)}>{translate('terminal:help')}</button><button className="session-tool" aria-label={translate('terminal:closeTerminalCompletion')} onClick={completion.dismiss}>{translate('terminal:close')}</button></div>
    <div className="terminal-completion-body">
      <ul ref={list} id={id} role="listbox" aria-label={translate('terminal:completionCandidates')}>{candidates.map((item,index)=><li id={`${id}-${index}`} key={`${item.kind}:${item.text}`} role="option" aria-selected={index===view.selected} onPointerEnter={()=>completion.select(index)} onClick={()=>completion.accept(index)}><code>{item.label}</code><span>{item.description}</span><small>{kinds[item.kind]}</small></li>)}</ul>
      {selected&&<div className="terminal-completion-detail"><strong>{selected.label}</strong>{selected.description&&<p>{selected.description}</p>}{view.context.command&&<code>{view.context.command.synopsis}</code>}</div>}
    </div>
    {view.loading&&<p className="terminal-completion-status" role="status">{translate('terminal:readingDirectory')}</p>}
    {errorMessage(eventError(view))&&<p className="terminal-completion-status error" role="status">{errorMessage(eventError(view))}</p>}
    {!view.loading&&!errorMessage(eventError(view))&&!view.candidates.length&&<p className="terminal-completion-status" role="status">{translate('terminal:noMatchingCandidates')}</p>}
    {view.truncated&&<p className="terminal-completion-status" role="status">{translate('terminal:directoryScanOrCandidateLimitReached')}</p>}
  </section>;
}
