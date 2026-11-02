import { useEffect, useRef, useState } from 'react';
import { Stream, Events } from '@wailsio/runtime';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { CloseTerminal, ResizeTerminal } from '../../../bindings/github.com/Sanjeever/termquay/appservice';
import '@xterm/xterm/css/xterm.css';

export default function TerminalView({ id, visible, fontSize }: { id: string; visible: boolean; fontSize: number }) {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const [connected, setConnected] = useState<boolean|null>(null);
  const terminal = useRef<Terminal>();
  const fitAddon = useRef<FitAddon>();
  const shown = useRef(visible); shown.current = visible;
  useEffect(() => {
    const term = new Terminal({
      fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--font-mono'),
      fontSize, lineHeight: 1.3, scrollback: 5000, cursorBlink: true,
      allowProposedApi: false, theme: { background: '#101216', foreground: '#e6e9ef', cursor: '#8ba7ff', selectionBackground: '#252f48' },
    });
    const fit = new FitAddon(); term.loadAddon(fit); term.open(container.current!);
    terminal.current = term; fitAddon.current = fit;
    const fitVisible = () => { if (container.current && container.current.clientWidth > 0 && container.current.clientHeight > 0) fit.fit(); };
    const stream = Stream('terminal');
    let disposed = false;
    const fail = (e: unknown) => { if (!disposed) setError(String(e)); };
    stream.onopen = () => { stream.send(new TextEncoder().encode(id)); setConnected(true); fitVisible(); if (shown.current) term.focus(); };
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
    const observer = new ResizeObserver(fitVisible); observer.observe(container.current!);
    const unsubscribe = Events.On('terminal:error', (event) => {
      const data = event.data as { id: string; error: string };
      if (data.id === id) fail(data.error);
    });
    return () => { disposed = true; observer.disconnect(); unsubscribe(); input.dispose(); resize.dispose(); stream.close(); term.dispose(); terminal.current = undefined; fitAddon.current = undefined; CloseTerminal(id).catch(() => {}); };
  }, [id]);
  useEffect(() => { if (!terminal.current) return; terminal.current.options.fontSize = fontSize; if (visible && container.current?.clientWidth && container.current.clientHeight) { fitAddon.current?.fit(); terminal.current.focus(); } }, [visible, fontSize]);
  return <div className="terminal-view">
    <div className="terminal-canvas" ref={container} />
    <div className="session-status"><span>{connected===null?'连接中':connected ? '已连接' : '已断开'}</span>{error && <span role="alert" className="error">{error}</span>}</div>
  </div>;
}
