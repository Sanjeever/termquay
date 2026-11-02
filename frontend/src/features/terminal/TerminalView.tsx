import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Stream, Events, Browser } from '@wailsio/runtime';
import { Button, Dropdown, DropdownTrigger, DropdownMenu, DropdownItem, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@heroui/react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import TerminalSearch from './TerminalSearch';
import Icon from '../../components/Icon';
import { CloseTerminal, ResizeTerminal } from '../../../bindings/github.com/Sanjeever/termquay/appservice';
import '@xterm/xterm/css/xterm.css';

export type TerminalAction = 'find' | 'copy' | 'paste' | 'selectAll' | 'clear' | 'zoomIn' | 'zoomOut' | 'zoomReset';
export type TerminalHandle = { action(action: TerminalAction): void; insert(text: string): void };
const TerminalView = forwardRef<TerminalHandle, { id: string; visible: boolean; fontSize: number }>(function TerminalView({ id, visible, fontSize }, ref) {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const [connected, setConnected] = useState<boolean|null>(null);
  const terminal = useRef<Terminal>();
  const fitAddon = useRef<FitAddon>();
  const search = useRef<SearchAddon>();
  const [searchOpen, setSearchOpen] = useState(false);
  const [paste, setPaste] = useState<string>();
  const [zoom, setZoom] = useState(0);
  const shown = useRef(visible); shown.current = visible;
  function insert(text: string) {
    if (new TextEncoder().encode(text).length > 256 * 1024 - 16) { setError('粘贴内容超过输入队列上限（256 KiB）'); return; }
    if (/[\r\n]/.test(text)) setPaste(text); else terminal.current?.paste(text);
  }
  function action(name: TerminalAction) {
    const term = terminal.current; if (!term) return;
    if (name === 'find') setSearchOpen(true);
    if (name === 'copy') navigator.clipboard.writeText(term.getSelection()).catch(e => setError(String(e)));
    if (name === 'paste') navigator.clipboard.readText().then(insert).catch(e => setError(String(e)));
    if (name === 'selectAll') term.selectAll();
    if (name === 'clear') term.clear();
    if (name === 'zoomIn') setZoom(v => Math.min(36 - fontSize, v + 1));
    if (name === 'zoomOut') setZoom(v => Math.max(9 - fontSize, v - 1));
    if (name === 'zoomReset') setZoom(0);
    if (name !== 'find' && name !== 'paste') term.focus();
  }
  const actions = useRef(action); actions.current = action;
  useImperativeHandle(ref, () => ({ action, insert }));
  useEffect(() => {
    const term = new Terminal({
      fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--font-mono'),
      fontSize, lineHeight: 1.3, scrollback: 5000, cursorBlink: true,
      allowProposedApi: false, theme: { background: '#101216', foreground: '#e6e9ef', cursor: '#8ba7ff', selectionBackground: '#252f48' },
    });
    const fit = new FitAddon(); term.loadAddon(fit); term.open(container.current!);
    const finder = new SearchAddon(); term.loadAddon(finder); search.current = finder;
    term.loadAddon(new WebLinksAddon((event, uri) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const url = new URL(uri); if (url.protocol === 'http:' || url.protocol === 'https:') Browser.OpenURL(url).catch(e => setError(String(e)));
    }));
    term.attachCustomKeyEventHandler(event => {
      if (event.isComposing || event.type !== 'keydown') return true;
      if ((event.ctrlKey || event.metaKey) && event.shiftKey) {
        const name = ({ f: 'find', c: 'copy', v: 'paste' } as const)[event.key.toLowerCase() as 'f' | 'c' | 'v'];
        if (name) { event.preventDefault(); actions.current(name); return false; }
      }
      return true;
    });
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
    return () => { disposed = true; observer.disconnect(); unsubscribe(); input.dispose(); resize.dispose(); stream.close(); term.dispose(); terminal.current = undefined; fitAddon.current = undefined; search.current = undefined; CloseTerminal(id).catch(() => {}); };
  }, [id]);
  useEffect(() => { if (!terminal.current) return; terminal.current.options.fontSize = Math.max(9, Math.min(36, fontSize + zoom)); if (visible && container.current?.clientWidth && container.current.clientHeight) { fitAddon.current?.fit(); if (!document.activeElement?.closest('[role=tablist]')) terminal.current.focus(); } }, [visible, fontSize, zoom]);
  function closeSearch() { setSearchOpen(false); search.current?.clearDecorations(); terminal.current?.focus(); }
  return <div className="terminal-view" onPasteCapture={e => { if (!(e.target as HTMLElement).closest('.xterm')) return; e.preventDefault(); e.stopPropagation(); insert(e.clipboardData.getData('text/plain')); }}>
    <div className="terminal-tools"><button className="icon-button" aria-label="终端查找" onClick={() => action('find')}><Icon name="search" width="14" /></button>
      <Dropdown><DropdownTrigger><button className="icon-button" aria-label="终端操作"><Icon name="more" width="14" /></button></DropdownTrigger><DropdownMenu aria-label="终端操作" onAction={key => action(key as TerminalAction)}>
        <DropdownItem key="copy">复制</DropdownItem><DropdownItem key="paste">粘贴</DropdownItem><DropdownItem key="selectAll">全选</DropdownItem><DropdownItem key="find">查找</DropdownItem><DropdownItem key="clear">清空显示</DropdownItem><DropdownItem key="zoomIn">放大字号</DropdownItem><DropdownItem key="zoomOut">缩小字号</DropdownItem><DropdownItem key="zoomReset">复位字号</DropdownItem>
      </DropdownMenu></Dropdown>
    </div>
    {searchOpen && search.current && <TerminalSearch addon={search.current} onClose={closeSearch} />}
    <div className="terminal-canvas" ref={container} />
    <div className="session-status"><span>{connected===null?'连接中':connected ? '已连接' : '已断开'}</span>{error && <span role="alert" className="error">{error}</span>}</div>
    <Modal isOpen={paste !== undefined} onClose={() => { setPaste(undefined); terminal.current?.focus(); }} className="app-dialog"><ModalContent><ModalHeader>确认多行粘贴</ModalHeader><ModalBody><p>换行可能立即执行命令，请核对内容。</p><pre className="paste-preview">{paste}</pre></ModalBody><ModalFooter><Button variant="light" onPress={() => { setPaste(undefined); terminal.current?.focus(); }}>取消</Button><Button color="primary" onPress={() => { if (paste !== undefined) terminal.current?.paste(paste); setPaste(undefined); terminal.current?.focus(); }}>粘贴到终端</Button></ModalFooter></ModalContent></Modal>
  </div>;
});
export default TerminalView;
