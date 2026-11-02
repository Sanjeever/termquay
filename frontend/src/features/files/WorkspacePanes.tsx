import { useEffect, useRef, useState, type ReactNode } from 'react';
import ResizeHandle from '../../components/layout/ResizeHandle';

export default function WorkspacePanes({ split, maximized, ratio, onRatio, children }: { split: boolean; maximized: boolean; ratio: number; onRatio(value: number): void; children: ReactNode }) {
  const host=useRef<HTMLDivElement>(null);
  const [width,setWidth]=useState(100);
  useEffect(()=>{const observer=new ResizeObserver(([entry])=>setWidth(Math.max(100,entry.contentRect.width)));observer.observe(host.current!);return()=>observer.disconnect();},[]);
  return <div ref={host} className="workspace-panes" style={{gridTemplateColumns:split&&!maximized?`minmax(0,${ratio}fr) 5px minmax(0,${100-ratio}fr)`:'minmax(0,1fr)',gridTemplateRows:'36px minmax(0,1fr)'}}>
    {children}
    {split&&!maximized&&<div className="workspace-pane-separator"><ResizeHandle label="双窗格比例" value={ratio} min={20} max={80} pixelsPerUnit={width/100} onChange={onRatio}/></div>}
  </div>;
}
