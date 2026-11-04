import Tooltip from '../../components/Tooltip';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@heroui/react';
import useImageResource from './useImageResource';
import ErrorNotice from '../../components/ErrorNotice';
import { bytes } from './transferFormat';

export default function ImagePreview({workspace,path,visible,onDownload,onText}:{workspace:string;path:string;visible:boolean;onDownload():void;onText():void}) {
  const image=useImageResource(workspace,path,visible);
  const [zoom,setZoom]=useState<number|'fit'>('fit');
  const stage=useRef<HTMLDivElement>(null);
  const [natural,setNatural]=useState<{width:number;height:number}>();
  const metadata=image.resource?.metadata;
  const width=natural?.width||metadata?.width||0;
  const height=natural?.height||metadata?.height||0;
  useEffect(()=>{if(visible)stage.current?.focus();},[visible]);
  const scale=(delta:number)=>setZoom(value=>Math.max(10,Math.min(400,(value==='fit'?100:value)+delta)));
  return <div className="image-preview">
    <div className="image-toolbar"><Button size="sm" variant="light" onPress={()=>setZoom('fit')} aria-pressed={zoom==='fit'}>适应窗口</Button><Button size="sm" variant="light" onPress={()=>setZoom(100)} aria-pressed={zoom===100}>100%</Button><button className="icon-button" aria-label="缩小图片" onClick={()=>scale(-25)}>−</button><span>{zoom==='fit'?'适应':`${zoom}%`}</span><button className="icon-button" aria-label="放大图片" onClick={()=>scale(25)}>+</button><div className="status-spacer"/><Button size="sm" variant="light" onPress={image.retry}>重新读取</Button><Button size="sm" variant="light" onPress={onDownload}>下载原图</Button><Button size="sm" variant="light" onPress={onText}>以文本打开</Button></div>
    <ErrorNotice message={image.error}><button className="session-tool" onClick={image.retry}>重试读取</button></ErrorNotice>
    <div className={`image-stage${zoom==='fit'?' image-fit':''}`} ref={stage} tabIndex={0} data-image-preview aria-label="图片预览" onKeyDown={event=>{if(event.isDefaultPrevented()||event.nativeEvent.isComposing)return;if(event.key==='+'||event.key==='='){event.preventDefault();scale(25);}if(event.key==='-'){event.preventDefault();scale(-25);}if(event.key==='0'){event.preventDefault();setZoom('fit');}}}>
      {image.resource&&!image.error?<img src={image.resource.url} alt={path.split('/').pop()||'远端图片'} draggable={false} style={zoom==='fit'?undefined:{width:Math.round(width*zoom/100),maxWidth:'none',maxHeight:'none'}} onLoad={event=>setNatural({width:event.currentTarget.naturalWidth,height:event.currentTarget.naturalHeight})} onError={image.decodeFailed}/>:!image.error&&<span className="muted" role="status">正在读取图片…</span>}
    </div>
    <div className="editor-status"><Tooltip content={path}><span className="editor-path">{path}</span></Tooltip>{metadata&&<><span>{width} × {height}</span><span>{bytes(metadata.size)}</span><span>{metadata.format==='gif'?'GIF · 首帧':metadata.format.toUpperCase()}</span></>}</div>
  </div>;
}
