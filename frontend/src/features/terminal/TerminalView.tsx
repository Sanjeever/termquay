import { useEffect, useRef, useState } from 'react';
import { Stream, Events } from '@wailsio/runtime';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { CloseTerminal, ResizeTerminal } from '../../../bindings/github.com/Sanjeever/termquay/appservice';
import '@xterm/xterm/css/xterm.css';

export default function TerminalView({ id }: { id: string }) {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const [connected, setConnected] = useState<boolean|null>(null);
  useEffect(() => {
    const term = new Terminal({
      fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
      fontSize: 13, lineHeight: 1.2, scrollback: 5000, cursorBlink: true,
      allowProposedApi: false, theme: { background: '#121418', foreground: '#d7dce2', cursor: '#8fc6b4', selectionBackground: '#344c50' },
    });
    const fit = new FitAddon(); term.loadAddon(fit); term.open(container.current!);
    const stream = Stream('terminal');
    let disposed = false;
    const fail = (e: unknown) => { if (!disposed) setError(String(e)); };
    stream.onopen = () => { stream.send(new TextEncoder().encode(id)); setConnected(true); fit.fit(); term.focus(); };
    stream.onmessage = (event) => {
      const bytes = new Uint8Array(event.data);
      term.write(bytes, () => {
        if (stream.readyState !== stream.OPEN) return;
        const ack = new Uint8Array(5); ack[0] = 1;
        new DataView(ack.buffer).setUint32(1, bytes.length);
        stream.send(ack);
      });
    };
    stream.onclose = () => { if (!disposed) setConnected(false); };
    stream.onerror = () => fail('终端数据流中断');
    const input = term.onData((data) => {
      const bytes = new TextEncoder().encode(data);
      if (stream.readyState !== stream.OPEN) return;
      if (stream.bufferedAmount + bytes.length > 256 * 1024) { fail('输入队列已满，请等待远端响应'); return; }
      for (let offset = 0; offset < bytes.length; offset += 32768) {
        const chunk = bytes.subarray(offset, offset + 32768);
        const frame = new Uint8Array(chunk.length + 1); frame.set(chunk, 1); stream.send(frame);
      }
    });
    const resize = term.onResize(({ cols, rows }) => { if (stream.readyState === stream.OPEN) ResizeTerminal(id, cols, rows).catch(fail); });
    const observer = new ResizeObserver(() => fit.fit()); observer.observe(container.current!);
    const unsubscribe = Events.On('terminal:error', (event) => {
      const data = event.data as { id: string; error: string };
      if (data.id === id) fail(data.error);
    });
    return () => { disposed = true; observer.disconnect(); unsubscribe(); input.dispose(); resize.dispose(); stream.close(); term.dispose(); CloseTerminal(id).catch(() => {}); };
  }, [id]);
  return <div className="terminal-view">
    <div className="terminal-canvas" ref={container} />
    <div className="session-status"><span>{connected===null?'连接中':connected ? '已连接' : '已断开'}</span>{error && <span role="alert" className="error">{error}</span>}</div>
  </div>;
}
