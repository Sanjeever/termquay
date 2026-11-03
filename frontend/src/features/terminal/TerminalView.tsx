import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { Stream, Events, Browser } from '@wailsio/runtime';
import { Button, Dropdown, DropdownTrigger, DropdownMenu, DropdownItem, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@heroui/react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import TerminalSearch, { searchHighlightLimit } from './TerminalSearch';
import { addLogHighlights } from './logHighlights';
import { addShellIntegration, shellSetupForHost } from './shellIntegration';
import SelectControl from '../../components/SelectControl';
import TmuxDialog from './TmuxDialog';
import { ExportTerminalBuffer, StartTerminalLog, PauseTerminalLog, GetTerminalLogStatus } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { TerminalLogStatus } from '../../../bindings/github.com/Sanjeever/termquay/internal/ssh/models';
import Icon from '../../components/Icon';
import { useAppearance } from '../settings/AppearanceProvider';
import { monoFonts, terminalTheme } from '../settings/appearance';
import { CloseTerminal, ResizeTerminal } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import { CloseLocalTerminal, ResizeLocalTerminal } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import '@xterm/xterm/css/xterm.css';

export type TerminalAction = 'find' | 'copy' | 'paste' | 'selectAll' | 'clear' | 'zoomIn' | 'zoomOut' | 'zoomReset';
export type TerminalHandle = { ended():boolean; action(action: TerminalAction): void; insert(text: string): boolean };
const TerminalView = forwardRef<TerminalHandle, { id: string; workspace: string; host?:string; local?: boolean; visible: boolean; fontSize: number; demoOutput?: string; focusOnShow?:boolean; onConnectionChange?():void; onSnippets(): void; onDirectory?(path: string, host: string): void; onFile?(path: string, line: number): void }>(function TerminalView({ id, workspace, host='localhost', local=false, visible, fontSize, demoOutput, focusOnShow=true, onConnectionChange, onSnippets, onDirectory, onFile }, ref) {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const [connected, setConnected] = useState<boolean|null>(null);
  const terminal = useRef<Terminal>();
  const { appearance, dark } = useAppearance();
  const colors = terminalTheme(appearance.terminalPalette, dark);
  const requestFit = useRef<() => void>();
  const search = useRef<SearchAddon>();
  const [searchOpen, setSearchOpen] = useState(false);
  const [paste, setPaste] = useState<string>();
  const [zoom, setZoom] = useState(0);
  const [cwd, setCwd] = useState('');
  const [exitCode, setExitCode] = useState('');
  const [integrationOpen, setIntegrationOpen] = useState(false);
  const [tmuxOpen, setTmuxOpen] = useState(false);
  const [logConfirm, setLogConfirm] = useState(false);
  const [log, setLog] = useState<TerminalLogStatus>();
  const [keywordOpen, setKeywordOpen] = useState(false);
  const [keyword, setKeyword] = useState('');
  async function exportBuffer() { try { const buffer = terminal.current?.buffer.active; if (!buffer) return; const lines: string[] = []; for (let y = 0; y < buffer.length; y++) lines.push(buffer.getLine(y)?.translateToString(true) || ''); await ExportTerminalBuffer(lines.join('\n')); } catch (e) { setError(String(e)); } }
  async function pauseLog() { try { setLog(await PauseTerminalLog(id)); } catch (e) { setError(String(e)); } }
  useEffect(() => { if (!log?.recording || !connected) return; let ended = false; let timer: ReturnType<typeof setTimeout>; async function load() { try { const value = await GetTerminalLogStatus(id); if (!ended) { setLog(value); if (value.error) setError(`日志记录停止：${value.error}`); } } catch (e) { if (!ended) setError(String(e)); } finally { if (!ended) timer = setTimeout(load, 2000); } } timer = setTimeout(load, 2000); return () => { ended = true; clearTimeout(timer); }; }, [id, log?.recording, connected]);
  const [shell, setShell] = useState<'bash' | 'zsh'>('bash');
  const shellSetup=shellSetupForHost(shell,host);
  const integration = useRef<ReturnType<typeof addShellIntegration>>();
  const callbacks = useRef({ onDirectory, onFile }); callbacks.current = { onDirectory, onFile };
  const shown = useRef(visible); shown.current = visible;
  const focusRequested=useRef(focusOnShow);focusRequested.current=focusOnShow;
  const inputStream=useRef<ReturnType<typeof Stream>>();
  const stateCallback=useRef(onConnectionChange);stateCallback.current=onConnectionChange;
  function insert(text: string):boolean {
    if (demoOutput !== undefined) { setError('演示终端不执行命令'); return false; }
    const size=new TextEncoder().encode(text).length;
    if (size > 256 * 1024 - 16) { setError('粘贴内容超过输入队列上限（256 KiB）'); return false; }
    const stream=inputStream.current;if(!stream||stream.readyState!==stream.OPEN){setError('终端已断开');return false;}
    if(stream.bufferedAmount+size+Math.ceil(size/32768)+16>256*1024){setError('输入队列已满，请等待远端响应');return false;}
    if (/[\r\n]/.test(text)) setPaste(text); else terminal.current?.paste(text);
    return true;
  }
  function action(name: TerminalAction) {
    const term = terminal.current; if (!term) return;
    if (name === 'find') setSearchOpen(true);
    if (name === 'copy') navigator.clipboard.writeText(term.getSelection()).catch(e => setError(String(e)));
    if (name === 'paste' && demoOutput === undefined) navigator.clipboard.readText().then(insert).catch(e => setError(String(e)));
    if (name === 'selectAll') term.selectAll();
    if (name === 'clear') term.clear();
    if (name === 'zoomIn') setZoom(v => Math.min(36 - fontSize, v + 1));
    if (name === 'zoomOut') setZoom(v => Math.max(9 - fontSize, v - 1));
    if (name === 'zoomReset') setZoom(0);
    if (name !== 'find' && name !== 'paste') term.focus();
  }
  useImperativeHandle(ref, () => ({ action, insert,ended:()=>!!inputStream.current&&inputStream.current.readyState===inputStream.current.CLOSED }));
  useEffect(() => {
    const term = new Terminal({
      fontFamily: monoFonts[appearance.monoFont],
      fontSize, lineHeight: 1.3, scrollback: 5000, cursorBlink: demoOutput === undefined, disableStdin: demoOutput !== undefined,
      allowProposedApi: true, theme: colors,
    });
    const fit = new FitAddon(); term.loadAddon(fit); term.open(container.current!);
    const finder = new SearchAddon({highlightLimit:searchHighlightLimit}); term.loadAddon(finder); search.current = finder;
    term.loadAddon(new WebLinksAddon((event, uri) => {
      if (demoOutput !== undefined || !(event.ctrlKey || event.metaKey)) return;
      const url = new URL(uri); if (url.protocol === 'http:' || url.protocol === 'https:') Browser.OpenURL(url).catch(e => setError(String(e)));
    }));
    terminal.current = term;
    integration.current = addShellIntegration(term, (path, host) => { setCwd(path); callbacks.current.onDirectory?.(path, host); }, setExitCode, (path, line) => callbacks.current.onFile?.(path, line));
    let fitFrame = 0;
    const fitVisible = () => {
      if (fitFrame) return;
      fitFrame = requestAnimationFrame(() => {
        fitFrame = 0;
        if (!shown.current || !container.current?.clientWidth || !container.current.clientHeight) return;
        const size = fit.proposeDimensions();
        if (size && (size.cols !== term.cols || size.rows !== term.rows)) fit.fit();
      });
    };
    requestFit.current = fitVisible;
    if (demoOutput !== undefined) {
      if (shown.current && container.current?.clientWidth) fit.fit();
      term.write(demoOutput);
      setConnected(true);
      if(shown.current&&focusRequested.current)term.focus();
      const observer = new ResizeObserver(fitVisible); observer.observe(container.current!);
      return () => { observer.disconnect(); cancelAnimationFrame(fitFrame); requestFit.current = undefined; integration.current?.dispose(); integration.current = undefined; term.dispose(); terminal.current = undefined; search.current = undefined; };
    }
    const stream = Stream(local ? 'local-terminal' : 'terminal');
    inputStream.current=stream;
    let disposed = false;
    const fail = (e: unknown) => { if (!disposed) setError(String(e)); };
    stream.onopen = () => { stream.send(new TextEncoder().encode(id)); setConnected(true); stateCallback.current?.();fitVisible(); if (shown.current&&focusRequested.current&&!document.querySelector('[role=dialog][data-open=true]')) term.focus(); };
    stream.onmessage = (event) => {
      const bytes = new Uint8Array(event.data);
      term.write(bytes, () => {
        if (stream.readyState !== stream.OPEN) return;
        const ack = new Uint8Array(5); ack[0] = 1;
        new DataView(ack.buffer).setUint32(1, bytes.length);
        stream.send(ack);
      });
    };
    stream.onclose = () => { if (!disposed) { setConnected(false); term.options.disableStdin = true;stateCallback.current?.(); } };
    stream.onerror = () => fail('终端数据流中断');
    const input = term.onData((data) => {
      const bytes = new TextEncoder().encode(data);
      if (stream.readyState !== stream.OPEN) return;
      if (stream.bufferedAmount + bytes.length + Math.ceil(bytes.length/32768) > 256 * 1024) { fail('输入队列已满，请等待远端响应'); return; }
      for (let offset = 0; offset < bytes.length; offset += 32768) {
        const chunk = bytes.subarray(offset, offset + 32768);
        const frame = new Uint8Array(chunk.length + 1); frame.set(chunk, 1); stream.send(frame);
      }
    });
    const resize = term.onResize(({ cols, rows }) => { if (stream.readyState === stream.OPEN) (local ? ResizeLocalTerminal(id, cols, rows) : ResizeTerminal(id, cols, rows)).catch(fail); });
    const observer = new ResizeObserver(fitVisible); observer.observe(container.current!);
    const unsubscribe = Events.On('terminal:error', (event) => {
      const data = event.data as { id: string; error: string };
      if (data.id === id) fail(data.error);
    });
    return () => { disposed = true; integration.current?.dispose(); integration.current = undefined; observer.disconnect(); cancelAnimationFrame(fitFrame); requestFit.current = undefined; unsubscribe(); input.dispose(); resize.dispose(); stream.close(); term.dispose(); terminal.current = undefined; search.current = undefined; inputStream.current=undefined; (local ? CloseLocalTerminal(id) : CloseTerminal(id)).catch(() => {}); };
  }, [id, demoOutput]);
  useEffect(() => { if (terminal.current) terminal.current.options.theme = terminalTheme(appearance.terminalPalette, dark); }, [id, dark, appearance.terminalPalette]);
  useEffect(() => { if (terminal.current && visible && appearance.terminalLogHighlight) return addLogHighlights(terminal.current, terminalTheme(appearance.terminalPalette, dark)).dispose; }, [id, visible, appearance.terminalLogHighlight, appearance.terminalPalette, dark]);
  useEffect(() => { if (terminal.current && visible && keyword) return addLogHighlights(terminal.current, terminalTheme(appearance.terminalPalette, dark), keyword).dispose; }, [id, visible, keyword, appearance.terminalPalette, dark]);
  useEffect(() => { const term = terminal.current; if (!term) return; const family = monoFonts[appearance.monoFont]; if (term.options.fontFamily !== family) { term.options.fontFamily = family; requestFit.current?.(); } }, [id, appearance.monoFont]);
  useEffect(() => { const term = terminal.current; if (!term) return; const size = Math.max(9, Math.min(36, fontSize + zoom)); if (term.options.fontSize !== size) { term.options.fontSize = size; requestFit.current?.(); } }, [id, fontSize, zoom]);
  useLayoutEffect(() => { if (visible) { requestFit.current?.(); if (focusRequested.current&&!document.activeElement?.closest('[role=tablist]')) terminal.current?.focus(); } }, [id, visible]);
  function closeSearch() { setSearchOpen(false); search.current?.clearDecorations(); terminal.current?.focus(); }
  return <div className="terminal-view" onPasteCapture={e => { if (!(e.target as HTMLElement).closest('.xterm')) return; e.preventDefault(); e.stopPropagation(); insert(e.clipboardData.getData('text/plain')); }}>
    <div className="terminal-tools"><button className="icon-button" aria-label="命令片段" title="命令片段" disabled={demoOutput !== undefined} onClick={onSnippets}><Icon name="list" width="14" /></button><button className="icon-button" aria-label="终端查找" title="终端查找" onClick={() => action('find')}><Icon name="search" width="14" /></button>
      <Dropdown><DropdownTrigger><button className="icon-button" aria-label="终端操作" title="终端操作"><Icon name="more" width="14" /></button></DropdownTrigger><DropdownMenu aria-label="终端操作" disabledKeys={demoOutput !== undefined ? ['paste','export','log','tmux','integration'] : []} onAction={key => { if(demoOutput !== undefined && ['paste','export','log','tmux','integration'].includes(String(key)))return; if (key === 'keyword') setKeywordOpen(value => !value); else if (key === 'export') void exportBuffer(); else if (key === 'log') { if (log?.recording) void pauseLog(); else setLogConfirm(true); } else if (key === 'tmux') setTmuxOpen(true); else if (key === 'integration') setIntegrationOpen(true); else if (key === 'previousCommand') integration.current?.previous(); else if (key === 'commandOutput') integration.current?.selectOutput(); else action(key as TerminalAction); }}>
        <DropdownItem key="copy">复制</DropdownItem><DropdownItem key="paste">粘贴</DropdownItem><DropdownItem key="selectAll">全选</DropdownItem><DropdownItem key="find">查找</DropdownItem><DropdownItem key="clear">清空显示</DropdownItem><DropdownItem key="zoomIn">放大字号</DropdownItem><DropdownItem key="zoomOut">缩小字号</DropdownItem><DropdownItem key="zoomReset">复位字号</DropdownItem>
        <DropdownItem key="previousCommand">跳到上一条命令</DropdownItem><DropdownItem key="commandOutput">选择上次命令输出</DropdownItem><DropdownItem key="integration" isDisabled={!connected}>启用当前 Shell 集成…</DropdownItem>
        <DropdownItem key="tmux" className={local?'hidden':''} isDisabled={local||!connected}>tmux 会话…</DropdownItem>
        <DropdownItem key="keyword">临时关键词高亮</DropdownItem><DropdownItem key="export">导出当前缓冲区</DropdownItem><DropdownItem key="log" className={local?'hidden':''} isDisabled={local||!connected}>{log?.recording ? '暂停日志记录' : log?.directory ? '继续日志记录…' : '记录终端输出…'}</DropdownItem>
      </DropdownMenu></Dropdown>
    </div>
    {searchOpen && search.current && <TerminalSearch addon={search.current} onClose={closeSearch} />}
    {keywordOpen && <div className="terminal-search"><input aria-label="临时高亮关键词" placeholder="高亮关键词" value={keyword} onChange={event => setKeyword(event.target.value)} maxLength={128} onKeyDown={event => { if (event.key === 'Escape' && !event.nativeEvent.isComposing) { setKeyword(''); setKeywordOpen(false); terminal.current?.focus(); } }}/><button className="icon-button" aria-label="清除临时高亮" onClick={() => { setKeyword(''); setKeywordOpen(false); }}><Icon name="close" width="14"/></button></div>}
    {tmuxOpen && <TmuxDialog workspace={workspace} onInsert={insert} onClose={() => setTmuxOpen(false)} />}
    <div className="terminal-canvas" ref={container} style={{ background: colors.background }} />
    {log?.directory && <div className="session-status"><span>{connected && log.recording ? '日志记录中' : '日志已暂停'}</span><button className="session-tool file-path" title={log.directory} onClick={() => { navigator.clipboard.writeText(log.directory).catch(e => setError(String(e))); }}>{log.directory}</button></div>}
    <Modal isOpen={logConfirm} onClose={() => setLogConfirm(false)} className="app-dialog"><ModalContent><ModalHeader>记录终端输出</ModalHeader><ModalBody><p>输出以 ANSI 原始字节保存在本机，可能包含敏感信息。最多保留三段日志，每段 8 MiB，循环覆盖最旧段。</p>{log?.directory && <p className="file-path">{log.directory}</p>}</ModalBody><ModalFooter><Button variant="light" onPress={() => setLogConfirm(false)}>取消</Button><Button color="primary" onPress={async () => { try { const value = await StartTerminalLog(id); if (value.directory) setLog(value); setLogConfirm(false); } catch (e) { setError(String(e)); } }}>开始记录</Button></ModalFooter></ModalContent></Modal>
    {(connected !== true || cwd || exitCode && exitCode !== '0' || error) && <div className="session-status">{connected !== true && <span role="status">{connected===null?'连接中':'已断开'}</span>}{cwd && <span className="file-path" title={cwd}>{cwd}</span>}{exitCode && exitCode !== '0' && <span className="error">退出码 {exitCode}</span>}{error && <span role="alert" className="error">{error}</span>}</div>}
    <Modal isOpen={integrationOpen} onClose={() => setIntegrationOpen(false)} className="app-dialog"><ModalContent><ModalHeader>当前 Shell 集成</ModalHeader><ModalBody><label className="form-field">Shell<SelectControl value={shell} onChange={event => setShell(event.target.value as 'bash' | 'zsh')}><option value="bash">Bash 4.4+</option><option value="zsh">Zsh</option></SelectControl></label><p className="muted">在当前 Shell 提示符执行，退出后失效。将设置提示符与命令钩子。</p><pre className="paste-preview">{shellSetup}</pre></ModalBody><ModalFooter><Button variant="light" onPress={() => setIntegrationOpen(false)}>取消</Button><Button color="primary" onPress={() => { if (insert(shellSetup + '\n')) setIntegrationOpen(false); }}>插入并预览</Button></ModalFooter></ModalContent></Modal>
    <Modal isOpen={paste !== undefined} onClose={() => { setPaste(undefined); terminal.current?.focus(); }} className="app-dialog"><ModalContent><ModalHeader>确认多行粘贴</ModalHeader><ModalBody><p>换行可能立即执行命令，请核对内容。</p><pre className="paste-preview">{paste}</pre></ModalBody><ModalFooter><Button variant="light" onPress={() => { setPaste(undefined); terminal.current?.focus(); }}>取消</Button><Button color="primary" onPress={() => { if (paste !== undefined) terminal.current?.paste(paste); setPaste(undefined); terminal.current?.focus(); }}>粘贴到终端</Button></ModalFooter></ModalContent></Modal>
  </div>;
});
export default TerminalView;
