import Tooltip from '../../components/Tooltip';
import { errorMessage } from "../../lib/errors";
import { forwardRef, lazy, Suspense, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Stream, Events, Browser, System } from '@wailsio/runtime';
import { Button, Dropdown, DropdownTrigger, DropdownMenu, DropdownItem, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@heroui/react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import TerminalSearch, { searchHighlightLimit } from './TerminalSearch';
import { addLogHighlights } from './logHighlights';
import { addShellIntegration, type CommandIndexEntry } from './shellIntegration';
import type { CommandAttention } from './commandAttention';
import { parseRecordedCommand } from './shellCompletionProtocol';
import { shellCompletionSetup } from './shellCompletionSetup';
import useTerminalCompletion from './useTerminalCompletion';
import TerminalCompletion from './TerminalCompletionPanel';
import CommandHelpDialog from './CommandHelpDialog';
import SelectControl from '../../components/SelectControl';
import TmuxDialog from './TmuxDialog';
import { ExportTerminalBuffer, StartTerminalLog, StartTerminalRecording, PauseTerminalLog, GetTerminalLogStatus } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import { EnableCommandNotification, NotifyCommandFinished } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { TerminalLogStatus } from '../../../bindings/github.com/Sanjeever/termquay/internal/ssh/models';
import Icon from '../../components/Icon';
import ErrorNotice from '../../components/ErrorNotice';
import { useAppearance } from '../settings/AppearanceProvider';
import { monoFonts, terminalTheme } from '../settings/appearance';
import { CloseTerminal, ResizeTerminal } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import { CloseLocalTerminal, ResizeLocalTerminal } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import { CloseContainerTerminal, ResizeContainerTerminal } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import '@xterm/xterm/css/xterm.css';

const CommandIndexDialog = lazy(() => import('./CommandIndexDialog'));
const RecordingPlayer = lazy(() => import('./RecordingPlayer'));

export type TerminalAction = 'find' | 'terminalCompletion' | 'commandHelp' | 'copy' | 'paste' | 'selectAll' | 'clear' | 'zoomIn' | 'zoomOut' | 'zoomReset';
export type TerminalHandle = { ended():boolean; action(action: TerminalAction): void; insert(text: string): boolean };
const TerminalView = forwardRef<TerminalHandle, { id: string; workspace: string; host?:string; local?: boolean; container?: boolean; visible: boolean; fontSize: number; demoOutput?: string; focusOnShow?:boolean; tmuxSession?: string; tmuxAttached?: boolean; tmuxAvailable?: boolean; onTmuxAttach?(name: string): Promise<boolean>; onTmuxUnbind?(): void; onConnectionChange?():void; onAttention?(state?: CommandAttention): void; onActivate?(): void; onSnippets(): void; onDirectory?(path: string, host: string): void; onFile?(path: string, line: number): void }>(function TerminalView({ id, workspace, host='localhost', local=false, container: containerConsole=false, visible, fontSize, demoOutput, focusOnShow=true, tmuxSession, tmuxAttached=false, tmuxAvailable=false, onTmuxAttach, onTmuxUnbind, onConnectionChange, onAttention, onActivate, onSnippets, onDirectory, onFile }, ref) {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<{ source: string; message: string }>();
  const [streamError, setStreamError] = useState('');
  const [logError, setLogError] = useState('');
  const [logErrorDismissed, setLogErrorDismissed] = useState(false);
  function reportError(source: string, error: unknown) { setError({source,message:errorMessage(error)}); }
  function clearError(source: string) { setError(previous=>previous?.source===source?undefined:previous); }
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
  const [runningCommand, setRunningCommand] = useState(false);
  const [reminder, setReminder] = useState(false);
  const [armingReminder, setArmingReminder] = useState(false);
  const currentCommand = useRef(0);
  const running = useRef(false);
  const reminderCommand = useRef<number>();
  const [integrationOpen, setIntegrationOpen] = useState(false);
  const [help, setHelp] = useState<{command?:string}>();
  const [pathCompletion, setPathCompletion] = useState(false);
  const [setupToken, setSetupToken] = useState(()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),byte=>byte.toString(16).padStart(2,'0')).join(''));
  const nextIntegration = useRef<{token:string;paths:boolean}>();
  const [tmuxOpen, setTmuxOpen] = useState(false);
  const [commandIndexOpen, setCommandIndexOpen] = useState(false);
  const [commandEntries, setCommandEntries] = useState<CommandIndexEntry[]>([]);
  const commandToken = useRef('');
  const [logConfirm, setLogConfirm] = useState(false);
  const [log, setLog] = useState<TerminalLogStatus>();
  const [logFormat, setLogFormat] = useState('asciicast');
  const [playback, setPlayback] = useState(false);
  const [keywordOpen, setKeywordOpen] = useState(false);
  const [keyword, setKeyword] = useState('');
  async function exportBuffer() { clearError('export'); try { const buffer = terminal.current?.buffer.active; if (!buffer) return; const lines: string[] = []; for (let y = 0; y < buffer.length; y++) lines.push(buffer.getLine(y)?.translateToString(true) || ''); await ExportTerminalBuffer(lines.join('\n')); clearError('export'); } catch (e) { reportError('export',e); } }
  async function pauseLog() { clearError('log'); try { const value = await PauseTerminalLog(id); setLog(value); setLogError(value.error ? `记录停止：${value.error}` : ''); setLogErrorDismissed(false); clearError('log'); } catch (e) { reportError('log',e); } }
  useEffect(() => { if (!log?.recording || !connected) return; let ended = false; let timer: ReturnType<typeof setTimeout>; async function load() { try { const value = await GetTerminalLogStatus(id); if (!ended) { setLog(value); setLogError(value.error ? `日志记录停止：${value.error}` : ''); if (!value.error) setLogErrorDismissed(false); } } catch (e) { if (!ended) setLogError(errorMessage(e)); } finally { if (!ended) timer = setTimeout(load, 2000); } } timer = setTimeout(load, 2000); return () => { ended = true; clearTimeout(timer); }; }, [id, log?.recording, connected]);
  const [shell, setShell] = useState<'bash' | 'zsh'>(local&&System.IsMac()?'zsh':'bash');
  const shellSetup=useMemo(()=>shellCompletionSetup(shell,host,setupToken),[shell,host,setupToken]);
  const integration = useRef<ReturnType<typeof addShellIntegration>>();
  const callbacks = useRef({ onDirectory, onFile, onAttention, onActivate }); callbacks.current = { onDirectory, onFile, onAttention, onActivate };
  const shown = useRef(visible); shown.current = visible;
  const focusRequested=useRef(focusOnShow);focusRequested.current=focusOnShow;
  const inputStream=useRef<ReturnType<typeof Stream>>();
  const completion=useTerminalCompletion({id,workspace,visible,terminal,send:sendFrame,fail:message=>reportError('completion',message),help:()=>setHelp({})});
  const complete=useRef(completion);complete.current=completion;
  const stateCallback=useRef(onConnectionChange);stateCallback.current=onConnectionChange;
  async function toggleReminder() {
    if (reminderCommand.current !== undefined) { reminderCommand.current = undefined; setReminder(false); return; }
    const term = terminal.current;
    const command = currentCommand.current;
    setArmingReminder(true); clearError('notification');
    try {
      await EnableCommandNotification();
      if (terminal.current === term && running.current && currentCommand.current === command) { reminderCommand.current = command; setReminder(true); }
    } catch (e) { if (terminal.current === term) reportError('notification', e); }
    finally { if (terminal.current === term) setArmingReminder(false); }
  }
  useEffect(() => {
    if (demoOutput !== undefined) return;
    const clearAttention = () => { if (shown.current && !running.current) callbacks.current.onAttention?.(); };
    const off = [Events.On(Events.Types.Common.WindowFocus, clearAttention), Events.On('terminal:notification-activated', event => { if (event.data === id) callbacks.current.onActivate?.(); })];
    return () => off.forEach(dispose => dispose());
  }, [id, demoOutput]);
  useEffect(() => { if (visible && document.hasFocus() && !running.current) callbacks.current.onAttention?.(); }, [visible]);
  function sendFrame(data:string):boolean {
    const stream=inputStream.current,bytes=new TextEncoder().encode(data);
    if(!stream||stream.readyState!==stream.OPEN){reportError('completion','终端已断开');return false;}
    if(stream.bufferedAmount+bytes.length+Math.ceil(bytes.length/32768)>256*1024){reportError('completion','输入队列已满，请等待远端响应');return false;}
    for(let offset=0;offset<bytes.length;offset+=32768){const chunk=bytes.subarray(offset,offset+32768);const frame=new Uint8Array(chunk.length+1);frame.set(chunk,1);stream.send(frame);}
    return true;
  }
  function openIntegration(){completion.dismiss();setPathCompletion(false);setSetupToken(Array.from(crypto.getRandomValues(new Uint8Array(32)),byte=>byte.toString(16).padStart(2,'0')).join(''));setIntegrationOpen(true);}
  function confirmPaste(){if(nextIntegration.current){clearError('completion');commandToken.current=nextIntegration.current.token;completion.activate(nextIntegration.current.token,nextIntegration.current.paths&&!containerConsole);nextIntegration.current=undefined;}terminal.current?.paste(paste||'');setPaste(undefined);terminal.current?.focus();}
  function insert(text: string):boolean {
    if (demoOutput !== undefined) { reportError('input','演示终端不执行命令'); return false; }
    const size=new TextEncoder().encode(text).length;
    if (size > 256 * 1024 - 16) { reportError('input','粘贴内容超过输入队列上限（256 KiB）'); return false; }
    const stream=inputStream.current;if(!stream||stream.readyState!==stream.OPEN){reportError('input','终端已断开');return false;}
    if(stream.bufferedAmount+size+Math.ceil(size/32768)+16>256*1024){reportError('input','输入队列已满，请等待远端响应');return false;}
    clearError('input');
    completion.dismiss();if (/[\r\n]/.test(text)) setPaste(text); else terminal.current?.paste(text);
    return true;
  }
  function action(name: TerminalAction) {
    const term = terminal.current; if (!term) return;
    if (name === 'find') setSearchOpen(true);
    if (name === 'terminalCompletion') {clearError('completion');term.focus();completion.request();return;}
    if (name === 'commandHelp') {const command=completion.view?.context.command?.name;completion.dismiss();setHelp({command});return;}
    if (name === 'copy') navigator.clipboard.writeText(term.getSelection()).then(()=>clearError('clipboard')).catch(e => reportError('clipboard',e));
    if (name === 'paste' && demoOutput === undefined) navigator.clipboard.readText().then(value=>{clearError('clipboard');insert(value);}).catch(e => reportError('clipboard',e));
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
      const url = new URL(uri); if (url.protocol === 'http:' || url.protocol === 'https:') Browser.OpenURL(url).then(()=>clearError('link')).catch(e => reportError('link',e));
    }));
    terminal.current = term;
    setCommandEntries([]); commandToken.current = '';
    integration.current = addShellIntegration(term, (path, host) => { setCwd(path); callbacks.current.onDirectory?.(path, host); }, setExitCode, (path, line) => callbacks.current.onFile?.(path, line),kind=>complete.current.command(kind),data=>{ const command = parseRecordedCommand(data, commandToken.current); if (command !== undefined) integration.current?.recordCommand(command); else complete.current.receive(data); }, entries => {
      setCommandEntries(entries);
      const latest = entries[entries.length - 1];
      if (!latest || demoOutput !== undefined) return;
      if (latest.duration === undefined) {
        currentCommand.current = latest.id; running.current = true; setRunningCommand(true);
        callbacks.current.onAttention?.('running');
      } else if (running.current && currentCommand.current === latest.id) {
        running.current = false; setRunningCommand(false);
        const failed = latest.exitCode !== undefined && latest.exitCode !== '0';
        callbacks.current.onAttention?.(shown.current && document.hasFocus() ? undefined : failed ? 'failed' : 'completed');
        if (reminderCommand.current === latest.id) {
          reminderCommand.current = undefined; setReminder(false);
          NotifyCommandFinished(id, failed).catch(e => { if (terminal.current === term) reportError('notification', e); });
        }
      }
    });
    term.attachCustomKeyEventHandler(event=>complete.current.key(event));
    const bufferChange=term.buffer.onBufferChange(()=>complete.current.invalidate());
    const textarea=term.textarea,blur=()=>complete.current.dismiss();textarea?.addEventListener('blur',blur);
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
      return () => { observer.disconnect();bufferChange.dispose();textarea?.removeEventListener('blur',blur);cancelAnimationFrame(fitFrame); requestFit.current = undefined; integration.current?.dispose(); integration.current = undefined; term.dispose(); terminal.current = undefined; search.current = undefined; };
    }
    const stream = Stream(containerConsole ? 'container-terminal' : local ? 'local-terminal' : 'terminal');
    inputStream.current=stream;
    let disposed = false;
    const fail = (e: unknown) => { if (!disposed) reportError('resize',e); };
    stream.onopen = () => { stream.send(new TextEncoder().encode(id)); setConnected(true); setStreamError(''); stateCallback.current?.();fitVisible(); if (shown.current&&focusRequested.current&&!document.querySelector('[role=dialog][data-open=true]')) term.focus(); };
    stream.onmessage = (event) => {
      const bytes = new Uint8Array(event.data);
      term.write(bytes, () => {
        if (stream.readyState !== stream.OPEN) return;
        const ack = new Uint8Array(5); ack[0] = 1;
        new DataView(ack.buffer).setUint32(1, bytes.length);
        stream.send(ack);
      });
    };
    stream.onclose = () => { if (!disposed) { running.current = false; reminderCommand.current = undefined; setRunningCommand(false); setReminder(false); callbacks.current.onAttention?.(); complete.current.invalidate();setConnected(false); term.options.disableStdin = true;stateCallback.current?.(); } };
    stream.onerror = () => { if (!disposed) setStreamError('终端数据流中断'); };
    const input = term.onData((data) => {
      complete.current.input(data);
      const bytes = new TextEncoder().encode(data);
      if (stream.readyState !== stream.OPEN) return;
      if (stream.bufferedAmount + bytes.length + Math.ceil(bytes.length/32768) > 256 * 1024) { if (!disposed) reportError('input','输入队列已满，请等待远端响应'); return; }
      clearError('input');
      for (let offset = 0; offset < bytes.length; offset += 32768) {
        const chunk = bytes.subarray(offset, offset + 32768);
        const frame = new Uint8Array(chunk.length + 1); frame.set(chunk, 1); stream.send(frame);
      }
    });
    const resize = term.onResize(({ cols, rows }) => { if (stream.readyState === stream.OPEN) (containerConsole ? ResizeContainerTerminal(id, cols, rows) : local ? ResizeLocalTerminal(id, cols, rows) : ResizeTerminal(id, cols, rows)).then(()=>{if(!disposed)clearError('resize');}).catch(fail); });
    const observer = new ResizeObserver(fitVisible); observer.observe(container.current!);
    const unsubscribe = Events.On('terminal:error', (event) => {
      const data = event.data as { id: string; error: string };
      if (data.id === id && !disposed) setStreamError(data.error);
    });
    return () => { disposed = true;bufferChange.dispose();textarea?.removeEventListener('blur',blur); integration.current?.dispose(); integration.current = undefined; observer.disconnect(); cancelAnimationFrame(fitFrame); requestFit.current = undefined; unsubscribe(); input.dispose(); resize.dispose(); stream.close(); term.dispose(); terminal.current = undefined; search.current = undefined; inputStream.current=undefined; (containerConsole ? CloseContainerTerminal(id) : local ? CloseLocalTerminal(id) : CloseTerminal(id)).catch(() => {}); };
  }, [id, demoOutput]);
  useEffect(() => { if (terminal.current) terminal.current.options.theme = terminalTheme(appearance.terminalPalette, dark); }, [id, dark, appearance.terminalPalette]);
  useEffect(() => { if (terminal.current && visible && appearance.terminalLogHighlight) return addLogHighlights(terminal.current, terminalTheme(appearance.terminalPalette, dark)).dispose; }, [id, visible, appearance.terminalLogHighlight, appearance.terminalPalette, dark]);
  useEffect(() => { if (terminal.current && visible && keyword) return addLogHighlights(terminal.current, terminalTheme(appearance.terminalPalette, dark), keyword).dispose; }, [id, visible, keyword, appearance.terminalPalette, dark]);
  useEffect(() => { const term = terminal.current; if (!term) return; const family = monoFonts[appearance.monoFont]; if (term.options.fontFamily !== family) { term.options.fontFamily = family; requestFit.current?.(); } }, [id, appearance.monoFont]);
  useEffect(() => { const term = terminal.current; if (!term) return; const size = Math.max(9, Math.min(36, fontSize + zoom)); if (term.options.fontSize !== size) { term.options.fontSize = size; requestFit.current?.(); } }, [id, fontSize, zoom]);
  useLayoutEffect(() => { if (visible) { requestFit.current?.(); if (focusRequested.current&&!document.activeElement?.closest('[role=tablist]')) terminal.current?.focus(); } }, [id, visible]);
  function closeSearch() { setSearchOpen(false); search.current?.clearDecorations(); terminal.current?.focus(); }
  return <div className="terminal-view" onPasteCapture={e => { if (!(e.target as HTMLElement).closest('.xterm')) return; e.preventDefault(); e.stopPropagation(); insert(e.clipboardData.getData('text/plain')); }}>
    <div className="terminal-tools">{!containerConsole && <Tooltip content="命令片段"><button className="icon-button" aria-label="命令片段" disabled={demoOutput !== undefined} onClick={onSnippets}><Icon name="list" width="14" /></button></Tooltip>}<Tooltip content="终端查找"><button className="icon-button" aria-label="终端查找" onClick={() => action('find')}><Icon name="search" width="14" /></button></Tooltip>
      <Dropdown><DropdownTrigger><Tooltip content="终端操作"><button className="icon-button" aria-label="终端操作"><Icon name="more" width="14" /></button></Tooltip></DropdownTrigger><DropdownMenu aria-label="终端操作" disabledKeys={demoOutput !== undefined ? ['paste','export','log','tmux','integration'] : []} onAction={key => { if(demoOutput !== undefined && ['paste','export','log','tmux','integration'].includes(String(key)))return; if (key === 'keyword') setKeywordOpen(value => !value); else if (key === 'export') void exportBuffer(); else if (key === 'log') { if (log?.recording) void pauseLog(); else setLogConfirm(true); } else if (key === 'tmux') setTmuxOpen(true); else if (key === 'integration') openIntegration();  else if (key === 'previousCommand') integration.current?.previous(); else if (key === 'commandOutput') integration.current?.selectOutput(); else action(key as TerminalAction); }}>
        <DropdownItem key="copy">复制</DropdownItem><DropdownItem key="paste">粘贴</DropdownItem><DropdownItem key="selectAll">全选</DropdownItem><DropdownItem key="find">查找</DropdownItem><DropdownItem key="clear">清空显示</DropdownItem><DropdownItem key="zoomIn">放大字号</DropdownItem><DropdownItem key="zoomOut">缩小字号</DropdownItem><DropdownItem key="zoomReset">复位字号</DropdownItem>
        <DropdownItem key="previousCommand">跳到上一条命令</DropdownItem><DropdownItem key="commandOutput">选择上次命令输出</DropdownItem><DropdownItem key="integration" isDisabled={!connected}>启用当前 Shell 集成…</DropdownItem>
        <DropdownItem key="commandIndex" onPress={() => setCommandIndexOpen(true)}>会话命令索引</DropdownItem>
        <DropdownItem key="reminder" isDisabled={!connected || !runningCommand || armingReminder || demoOutput !== undefined} onPress={() => void toggleReminder()} endContent={reminder ? '✓' : null}>完成时提醒</DropdownItem>
        <DropdownItem key="terminalCompletion" isDisabled={!connected||demoOutput!==undefined}>命令补全</DropdownItem><DropdownItem key="commandHelp">POSIX 命令参考…</DropdownItem>
        <DropdownItem key="tmux" className={local||containerConsole?'hidden':''} isDisabled={local||containerConsole||!connected}>tmux 会话…</DropdownItem>
        <DropdownItem key="keyword">临时关键词高亮</DropdownItem><DropdownItem key="export">导出当前缓冲区</DropdownItem><DropdownItem key="log" className={local||containerConsole?'hidden':''} isDisabled={local||containerConsole||!connected} onPress={() => setLogFormat(log?.format === 'asciicast' ? 'asciicast' : log?.directory ? 'ansi' : 'asciicast')}>{log?.recording ? '暂停记录' : log?.directory ? '继续记录…' : '记录终端输出…'}</DropdownItem><DropdownItem key="playback" isDisabled={demoOutput !== undefined} onPress={() => setPlayback(true)}>打开录制回放…</DropdownItem>
      </DropdownMenu></Dropdown>
    </div>
    {searchOpen && search.current && <TerminalSearch addon={search.current} onClose={closeSearch} />}
    {playback && <Suspense fallback={<div role="status">正在载入回放…</div>}><RecordingPlayer onClose={() => setPlayback(false)} /></Suspense>}
    {commandIndexOpen && <Suspense fallback={<div role="status">正在载入命令索引…</div>}><CommandIndexDialog entries={commandEntries} onGoTo={id => integration.current?.goTo(id) || false} onOutput={id => { if (!integration.current) throw new Error('终端已关闭'); return integration.current.outputText(id); }} onClose={() => setCommandIndexOpen(false)} /></Suspense>}
    {keywordOpen && <div className="terminal-search"><input aria-label="临时高亮关键词" placeholder="高亮关键词" value={keyword} onChange={event => setKeyword(event.target.value)} maxLength={128} onKeyDown={event => { if (event.key === 'Escape' && !event.nativeEvent.isComposing) { setKeyword(''); setKeywordOpen(false); terminal.current?.focus(); } }}/><button className="icon-button" aria-label="清除临时高亮" onClick={() => { setKeyword(''); setKeywordOpen(false); }}><Icon name="close" width="14"/></button></div>}
    {tmuxSession && <div className="terminal-tmux"><span>tmux · {tmuxSession}</span>{(!tmuxAttached || connected === false) && <Button size="sm" variant="light" isDisabled={!tmuxAvailable} onPress={() => { void onTmuxAttach?.(tmuxSession); }}>继续附着</Button>}<Button size="sm" variant="light" onPress={onTmuxUnbind}>解除绑定</Button></div>}
    {tmuxOpen && <TmuxDialog workspace={workspace} onInsert={insert} onAttach={onTmuxAttach} onClose={() => setTmuxOpen(false)} />}
    <div className="terminal-canvas" ref={container} style={{ background: colors.background }} />
    <TerminalCompletion completion={completion} onHelp={command=>{completion.dismiss();setHelp({command});}}/>
    {help&&<CommandHelpDialog initial={help.command} enabled={completion.enabled} onEnable={()=>{setHelp(undefined);openIntegration();}} onClose={()=>{setHelp(undefined);terminal.current?.focus();}}/>}
    {log?.directory && <div className="session-status"><span>{connected && log.recording ? '日志记录中' : '日志已暂停'}</span><Tooltip content={log.directory}><button className="session-tool file-path" onClick={() => { navigator.clipboard.writeText(log.directory).then(()=>clearError('clipboard')).catch(e => reportError('clipboard',e)); }}>{log.directory}</button></Tooltip>{logError && <button className="session-tool error" onClick={()=>setLogErrorDismissed(false)}>日志异常</button>}</div>}
    <Modal isOpen={logConfirm} onClose={() => {setLogConfirm(false);clearError('log');}} className="app-dialog"><ModalContent><ModalHeader>记录终端输出</ModalHeader><ModalBody><SelectControl aria-label="记录格式" value={logFormat} onChange={event => setLogFormat(event.target.value)}><option value="asciicast">带时间轴录制（asciicast v2）</option><option value="ansi">原始 ANSI 日志</option></SelectControl><p>{logFormat === 'asciicast' ? '记录后续输出与尺寸变化，保存在本机 session.cast。达到 16 MiB 或 100000 个事件时停止。' : '最多保留三段原始日志，每段 8 MiB，循环覆盖最旧段。'} 输出可能包含敏感信息，不进入常规备份。</p>{log?.directory && <p className="file-path">{log.directory}</p>}<ErrorNotice message={error?.source==='log'?error.message:''} onDismiss={()=>clearError('log')}/></ModalBody><ModalFooter><Button variant="light" onPress={() => {setLogConfirm(false);clearError('log');}}>取消</Button><Button color="primary" onPress={async () => { clearError('log');setLogErrorDismissed(false);try { const value = await (logFormat === 'asciicast' ? StartTerminalRecording(id) : StartTerminalLog(id)); if (value.directory) setLog(value); setLogError(''); setLogConfirm(false); } catch (e) { reportError('log',e); } }}>开始记录</Button></ModalFooter></ModalContent></Modal>
    <ErrorNotice message={logConfirm&&error?.source==='log'?'':error?.message || ''} onDismiss={()=>setError(undefined)}/>
    {logError && !logErrorDismissed && <ErrorNotice message={logError} onDismiss={()=>setLogErrorDismissed(true)}/>}
    {(connected !== true || cwd || exitCode && exitCode !== '0' || streamError) && <div className="session-status">{connected !== true && <span role="status">{connected===null?'连接中':'已断开'}</span>}{cwd && <Tooltip content={cwd}><span className="file-path">{cwd}</span></Tooltip>}{exitCode && exitCode !== '0' && <span className="error">退出码 {exitCode}</span>}{streamError && <details className="error"><summary>终端连接异常</summary>{errorMessage(streamError)}</details>}</div>}
    <Modal isOpen={integrationOpen} onClose={() => setIntegrationOpen(false)} className="app-dialog"><ModalContent><ModalHeader>当前 Shell 集成</ModalHeader><ModalBody><label className="form-field">Shell<SelectControl value={shell} onChange={event => setShell(event.target.value as 'bash' | 'zsh')}><option value="bash">Bash 4.4+</option><option value="zsh">Zsh</option></SelectControl></label><p className="muted">在当前 Shell 提示符执行，退出后失效。将设置提示符、命令钩子和补全键位，并在本次会话内采集命令文本。</p>{!containerConsole && <label className="terminal-path-confirm"><input type="checkbox" checked={pathCompletion} disabled={local&&System.IsWindows()} onChange={event=>setPathCompletion(event.target.checked)}/>确认当前 Shell 与本工作区使用同一文件系统，开启路径补全</label>}<pre className="paste-preview">{shellSetup}</pre></ModalBody><ModalFooter><Button variant="light" onPress={() => setIntegrationOpen(false)}>取消</Button><Button color="primary" onPress={() => { if (insert(shellSetup + '\n')) {nextIntegration.current={token:setupToken,paths:pathCompletion&&!containerConsole&&!(local&&System.IsWindows())};setIntegrationOpen(false);} }}>插入并预览</Button></ModalFooter></ModalContent></Modal>
    <Modal isOpen={paste !== undefined} onClose={() => { nextIntegration.current=undefined;setPaste(undefined); terminal.current?.focus(); }} className="app-dialog"><ModalContent><ModalHeader>确认多行粘贴</ModalHeader><ModalBody><p>换行可能立即执行命令，请核对内容。</p><pre className="paste-preview">{paste}</pre></ModalBody><ModalFooter><Button variant="light" onPress={() => { nextIntegration.current=undefined;setPaste(undefined); terminal.current?.focus(); }}>取消</Button><Button color="primary" onPress={confirmPaste}>粘贴到终端</Button></ModalFooter></ModalContent></Modal>
  </div>;
});
export default TerminalView;
