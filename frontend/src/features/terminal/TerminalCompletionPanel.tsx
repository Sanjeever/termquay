import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type useTerminalCompletion from './useTerminalCompletion';

const kinds={command:'命令',option:'选项',value:'参数',file:'文件',directory:'目录'};
export default function TerminalCompletion({completion,onHelp}:{completion:ReturnType<typeof useTerminalCompletion>;onHelp(command?:string):void}) {
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
  const selected=view.candidates[view.selected];
  return <section ref={panel} style={position} className="terminal-completion" aria-label="终端补全" onPointerDown={event=>event.preventDefault()}>
    <div className="terminal-completion-heading"><span>{view.context.command?.name||'命令补全'}</span><button className="session-tool" onClick={()=>onHelp(view.context.command?.name)}>帮助</button><button className="session-tool" aria-label="关闭终端补全" onClick={completion.dismiss}>关闭</button></div>
    <div className="terminal-completion-body">
      <ul ref={list} id={id} role="listbox" aria-label="补全候选">{view.candidates.map((item,index)=><li id={`${id}-${index}`} key={`${item.kind}:${item.text}`} role="option" aria-selected={index===view.selected} onPointerEnter={()=>completion.select(index)} onClick={()=>completion.accept(index)}><code>{item.label}</code><span>{item.description}</span><small>{kinds[item.kind]}</small></li>)}</ul>
      {selected&&<div className="terminal-completion-detail"><strong>{selected.label}</strong>{selected.description&&<p>{selected.description}</p>}{view.context.command&&<code>{view.context.command.synopsis}</code>}</div>}
    </div>
    {view.loading&&<p className="terminal-completion-status" role="status">正在读取目录…</p>}
    {view.error&&<p className="terminal-completion-status error" role="status">{view.error}</p>}
    {!view.loading&&!view.error&&!view.candidates.length&&<p className="terminal-completion-status" role="status">无匹配候选</p>}
    {view.truncated&&<p className="terminal-completion-status" role="status">已达到目录扫描或候选上限</p>}
  </section>;
}
