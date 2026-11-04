import Tooltip from '../../components/Tooltip';
import { Component, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSlug from 'rehype-slug';
import { Browser } from '@wailsio/runtime';
import { HighlightStyle, LanguageSupport, type Language } from '@codemirror/language';
import { highlightTree, tags } from '@lezer/highlight';
import { documentTarget } from './fileTypes';
import useImageResource from './useImageResource';
import { languageFromTag, loadEditorLanguage } from './editorLanguage';
import ErrorNotice from '../../components/ErrorNotice';
import { errorMessage } from '../../lib/errors';

const codeStyle=HighlightStyle.define([
  {tag:tags.keyword,class:'md-token-keyword'},{tag:tags.string,class:'md-token-string'},{tag:tags.comment,class:'md-token-comment'},
  {tag:[tags.number,tags.bool,tags.null],class:'md-token-number'},{tag:[tags.typeName,tags.className],class:'md-token-type'},
  {tag:[tags.propertyName,tags.attributeName],class:'md-token-property'},{tag:tags.function(tags.variableName),class:'md-token-function'},
]);

function MarkdownCode({className,children}:{className?:string;children?:ReactNode}) {
  const text=String(children??'');
  const id=languageFromTag(className?.match(/(?:^|\s)language-([^\s]+)/)?.[1]||'');
  const [tokens,setTokens]=useState<{text:string;language:string;parts:ReactNode[]}>();
  const [error,setError]=useState('');
  useEffect(()=>{
    if(!id||id==='text'||text.length>65536)return;
    let ended=false;setError('');
    void loadEditorLanguage(id).then(extension=>{
      if(ended)return;
      const language=extension instanceof LanguageSupport?extension.language:extension as Language;
      const parts:ReactNode[]=[];let previous=0;
      highlightTree(language.parser.parse(text),codeStyle,(from,to,classes)=>{if(from>previous)parts.push(text.slice(previous,from));parts.push(<span key={from} className={classes}>{text.slice(from,to)}</span>);previous=to;});
      if(previous<text.length)parts.push(text.slice(previous));
      if(!ended)setTokens({text,language:id,parts});
    }).catch(error=>{if(!ended)setError(`高亮加载失败：${errorMessage(error)}`);});
    return()=>{ended=true;};
  },[id,text]);
  return <Tooltip content={error||undefined}><code className={className} data-highlight-error={error?true:undefined}>{tokens?.text===text&&tokens.language===id?tokens.parts:text}</code></Tooltip>;
}

function MarkdownImage({workspace,path,src,alt,visible,allowed,onAllow}:{workspace:string;path:string;src?:string;alt?:string;visible:boolean;allowed:ReadonlySet<string>;onAllow(address:string):void}) {
  const target=documentTarget(path,src||'');
  const external=target.kind==='external';
  const address=target.kind==='remote'?target.path:target.kind==='external'?target.url:'';
  const [near,setNear]=useState(false);
  const [dimensions,setDimensions]=useState<{address:string;width:number;height:number}>();
  const host=useRef<HTMLSpanElement>(null);
  useEffect(()=>{const observer=new IntersectionObserver(([entry])=>setNear(entry.isIntersecting),{rootMargin:'120px'});if(host.current)observer.observe(host.current);return()=>observer.disconnect();},[]);
  const consent=allowed.has(address);
  const image=useImageResource(workspace,address,visible&&near&&!!address&&(!external||consent),external);
  const size=dimensions?.address===address?dimensions:image.resource?.metadata;
  return <span ref={host} className="markdown-image" style={size?{width:size.width,aspectRatio:`${size.width}/${size.height}`} : undefined}>
    {!address?<span className="muted">{alt||'图片'} · 图片地址不支持</span>:external&&!consent?<button type="button" className="markdown-external-image" onClick={event=>{event.preventDefault();event.stopPropagation();onAllow(address);}}>加载来自 {new URL(address).host} 的图片{alt?` · ${alt}`:''}</button>:image.error?<span className="error">{image.error}<button type="button" className="session-tool" onClick={event=>{event.preventDefault();event.stopPropagation();image.retry();}}>重试</button></span>:image.resource?<img src={image.resource.url} alt={alt||''} draggable={false} onLoad={event=>setDimensions({address,width:event.currentTarget.naturalWidth,height:event.currentTarget.naturalHeight})} onError={image.decodeFailed}/>:<span className="muted" role={near?'status':undefined}>{near?'正在读取图片…':alt||''}</span>}
  </span>;
}

type MarkdownNode = {type:string;children?:MarkdownNode[]};
function limitMarkdownTree() {
  return (tree:MarkdownNode)=>{
    const pending=[tree];let count=0;
    while(pending.length){const node=pending.pop()!;if(++count>15000)throw new Error('文档结构超过预览限制，请切换源码查看');if(node.children)for(const child of node.children)pending.push(child);}
  };
}

class PreviewBoundary extends Component<{revision:string;children:ReactNode},{error:string}> {
  state={error:''};
  static getDerivedStateFromError(error:unknown){return {error:errorMessage(error)};}
  componentDidUpdate(previous:Readonly<{revision:string;children:ReactNode}>){if(this.state.error&&previous.revision!==this.props.revision)this.setState({error:''});}
  render(){return this.state.error?<ErrorNotice message={`Markdown 预览失败：${this.state.error}`}/>:this.props.children;}
}

export default function MarkdownPreview({workspace,path,content,visible,focusOnShow,anchor,onNavigate}:{workspace:string;path:string;content:string;visible:boolean;focusOnShow?:boolean;anchor?:{hash:string;sequence:number};onNavigate(path:string,hash:string):void}) {
  const host=useRef<HTMLDivElement>(null);
  const prefix=`md-${useId().replace(/:/g,'')}-`;
  const [rendered,setRendered]=useState(content);
  const [error,setError]=useState('');
  const [allowed,setAllowed]=useState(new Set<string>());
  const callbacks=useRef({onNavigate,allowed});callbacks.current={onNavigate,allowed};
  useEffect(()=>{if(!visible)return;const timer=setTimeout(()=>setRendered(content),150);return()=>clearTimeout(timer);},[content,visible]);
  const scroll=(hash:string)=>{try{const name=decodeURIComponent(hash.replace(/^#/,''));host.current?.querySelector<HTMLElement>(`#${CSS.escape(name.startsWith(prefix)?name:prefix+name)}`)?.scrollIntoView({block:'start'});}catch{setError('文档锚点无效');}};
  useEffect(()=>{if(visible&&focusOnShow)host.current?.focus();},[visible,focusOnShow]);
  useEffect(()=>{if(!visible||!anchor)return;const frame=requestAnimationFrame(()=>scroll(anchor.hash));return()=>cancelAnimationFrame(frame);},[visible,anchor?.sequence,rendered]);
  const components=useMemo(()=>({
    code:MarkdownCode,
    img:({src,alt}:{src?:string;alt?:string})=><MarkdownImage workspace={workspace} path={path} src={src} alt={alt} visible allowed={callbacks.current.allowed} onAllow={address=>setAllowed(previous=>{const next=new Set(previous);if(next.size>=256)next.delete(next.values().next().value!);next.add(address);return next;})}/>,
    a:({href,children}:{href?:string;children?:ReactNode})=><a href={href} onClick={event=>{
      event.preventDefault();const target=documentTarget(path,href||'');
      if(target.kind==='anchor'){scroll(target.hash);return;}
      if(target.kind==='remote'){callbacks.current.onNavigate(target.path,target.hash);return;}
      if(target.kind==='external'){void Browser.OpenURL(target.url).catch(error=>setError(errorMessage(error)));return;}
      setError('此链接暂不支持打开');
    }}>{children}</a>,
  }),[workspace,path,prefix]);
  const renderedDocument=useMemo(()=><PreviewBoundary revision={rendered}><Markdown skipHtml remarkPlugins={[remarkGfm,limitMarkdownTree]} rehypePlugins={[[rehypeSlug,{prefix}]]} remarkRehypeOptions={{clobberPrefix:prefix}} components={components}>{rendered}</Markdown></PreviewBoundary>,[rendered,components,prefix,allowed]);
  return <div className="markdown-preview" ref={host} tabIndex={0} aria-label="Markdown 预览" data-markdown-preview>
    <ErrorNotice message={error} onDismiss={()=>setError('')}/>
    {visible&&(Math.max(content.length,rendered.length)>512*1024?<ErrorNotice message="Markdown 超过预览大小限制，请切换源码查看"/>:renderedDocument)}
  </div>;
}
