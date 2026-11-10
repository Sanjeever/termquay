import Modal from '../../components/Modal';
import { useTranslation } from 'react-i18next';
import { t as translate, currentLocale } from '../../i18n/index.ts';
import { message as uiMessage } from '../../i18n/messages.ts';
import { useMessageState } from '../../i18n/useMessageState.ts';

import Tooltip from '../../components/Tooltip';
import { errorMessage, eventError } from '../../lib/errors.ts';
import {
  forwardRef,
  lazy,
  Suspense,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Stream, Events, Browser, System } from '@wailsio/runtime';
import {
  Button,
  DropdownTrigger,
  DropdownMenu,
  DropdownItem,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
} from '@heroui/react';
import { Dropdown } from '../../components/Popover';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Unicode11Addon } from '@xterm/addon-unicode11';
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
import {
  ExportTerminalBuffer,
  StartTerminalLog,
  StartTerminalRecording,
  PauseTerminalLog,
  FinishTerminalLog,
  OpenTerminalLogDirectory,
  GetTerminalLogStatus,
} from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import {
  EnableCommandNotification,
  NotifyCommandFinished,
} from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { TerminalLogStatus } from '../../../bindings/github.com/Sanjeever/termquay/internal/ssh/models';
import Icon from '../../components/Icon';
import ErrorNotice from '../../components/ErrorNotice';
import type { Reference } from '../../../bindings/github.com/Sanjeever/termquay/internal/ai/models';
import { useAppearance } from '../settings/AppearanceProvider';
import { monospaceFont, terminalTheme } from '../settings/appearance';
import {
  CloseTerminal,
  ResizeTerminal,
} from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import {
  CloseLocalTerminal,
  ResizeLocalTerminal,
} from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import {
  CloseContainerTerminal,
  ResizeContainerTerminal,
} from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import '@xterm/xterm/css/xterm.css';

const CommandIndexDialog = lazy(() => import('./CommandIndexDialog'));
const RecordingPlayer = lazy(() => import('./RecordingPlayer'));

export type TerminalAction =
  | 'find'
  | 'terminalCompletion'
  | 'commandHelp'
  | 'copy'
  | 'paste'
  | 'selectAll'
  | 'clear'
  | 'zoomIn'
  | 'zoomOut'
  | 'zoomReset';
export type TerminalHandle = {
  ended(): boolean;
  action(action: TerminalAction): void;
  insert(text: string): boolean;
};
const TerminalView = forwardRef<
  TerminalHandle,
  {
    id: string;
    workspace: string;
    host?: string;
    local?: boolean;
    container?: boolean;
    visible: boolean;
    fontSize: number;
    demoOutput?: string;
    focusOnShow?: boolean;
    tmuxSession?: string;
    tmuxAttached?: boolean;
    tmuxAvailable?: boolean;
    onTmuxAttach?(name: string): Promise<boolean>;
    onTmuxUnbind?(): void;
    onConnectionChange?(): void;
    onAttention?(state?: CommandAttention): void;
    onActivate?(): void;
    onAIReference?(reference: Reference): void;
    onSnippets(): void;
    onDirectory?(path: string, host: string): void;
    onFile?(path: string, line: number): void;
  }
>(function TerminalView(
  {
    id,
    workspace,
    host = 'localhost',
    local = false,
    container: containerConsole = false,
    visible,
    fontSize,
    demoOutput,
    focusOnShow = true,
    tmuxSession,
    tmuxAttached = false,
    tmuxAvailable = false,
    onTmuxAttach,
    onTmuxUnbind,
    onConnectionChange,
    onAttention,
    onActivate,
    onAIReference,
    onSnippets,
    onDirectory,
    onFile,
  },
  ref,
) {
  useTranslation();
  const locale = currentLocale();
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<{ source: string; message: unknown }>();
  const [streamError, setStreamError] = useMessageState('');
  const [logError, setLogError] = useMessageState('');
  const [logErrorDismissed, setLogErrorDismissed] = useState(false);
  function reportError(source: string, error: unknown) {
    setError({ source, message: error });
  }
  function clearError(source: string) {
    setError((previous) => (previous?.source === source ? undefined : previous));
  }
  const [connected, setConnected] = useState<boolean | null>(null);
  const terminal = useRef<Terminal>();
  useLayoutEffect(() => {
    Terminal.strings.promptLabel = translate('terminal:terminalInput');
    Terminal.strings.tooMuchOutput = translate('terminal:tooMuchOutput');
    terminal.current?.textarea?.setAttribute('aria-label', Terminal.strings.promptLabel);
  }, [locale]);
  const canAI =
    !!onAIReference && !!connected && !local && !containerConsole && demoOutput === undefined;
  const [hasAISelection, setHasAISelection] = useState(false);
  const [aiContext, setAIContext] = useState<{ x: number; y: number; reference: Reference }>();
  useEffect(() => {
    setAIContext(undefined);
    const term = terminal.current;
    if (!canAI || !term) {
      setHasAISelection(false);
      return;
    }
    setHasAISelection(term.hasSelection());
    const selection = term.onSelectionChange(() => setHasAISelection(term.hasSelection()));
    return () => selection.dispose();
  }, [canAI, id, workspace]);
  useEffect(() => {
    if (!visible) setAIContext(undefined);
  }, [visible]);
  function aiReference() {
    const text = terminal.current?.getSelection();
    if (canAI && text) onAIReference?.({ workspace, terminal: id, text });
  }
  const { appearance, dark } = useAppearance();
  const fontFamily = monospaceFont(appearance);
  const colors = terminalTheme(appearance.terminalPalette, dark);
  const requestFit = useRef<() => void>();
  const search = useRef<SearchAddon>();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [paste, setPaste] = useState<string>();
  const [locked, setLocked] = useState(false);
  const inputLocked = useRef(false);
  function toggleInputLock() {
    inputLocked.current = !inputLocked.current;
    setLocked(inputLocked.current);
  }
  useEffect(() => {
    if (terminal.current)
      terminal.current.options.disableStdin =
        locked || connected !== true || demoOutput !== undefined;
    if (locked) {
      complete.current.dismiss();
      setPaste(undefined);
      setIntegrationOpen(false);
      nextIntegration.current = undefined;
    }
  }, [locked, connected, id, demoOutput]);
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
  const [help, setHelp] = useState<{ command?: string }>();
  const [pathCompletion, setPathCompletion] = useState(false);
  const [setupToken, setSetupToken] = useState(() =>
    Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join(''),
  );
  const nextIntegration = useRef<{ token: string; paths: boolean }>();
  const [tmuxOpen, setTmuxOpen] = useState(false);
  const [commandIndexOpen, setCommandIndexOpen] = useState(false);
  const [commandEntries, setCommandEntries] = useState<CommandIndexEntry[]>([]);
  const commandToken = useRef('');
  const [logConfirm, setLogConfirm] = useState(false);
  const [log, setLog] = useState<TerminalLogStatus>();
  const [logFormat, setLogFormat] = useState('asciicast');
  const [playback, setPlayback] = useState<'file' | 'current'>();
  const [logBusy, setLogBusy] = useState(false);
  const [recordingStarted, setRecordingStarted] = useState(0);
  const [recordingElapsed, setRecordingElapsed] = useState(0);
  useEffect(() => {
    if (!recordingStarted || !log?.recording || !connected || !visible) return;
    const update = () => setRecordingElapsed(Math.floor((Date.now() - recordingStarted) / 1000));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [recordingStarted, log?.recording, connected, visible]);
  async function startLog(format = logFormat) {
    if (logBusy) return;
    setLogBusy(true);
    clearError('log');
    setLogErrorDismissed(false);
    try {
      const value = await (format === 'asciicast'
        ? StartTerminalRecording(id)
        : StartTerminalLog(id));
      if (value.directory) {
        if (!log?.directory || log.finished || value.directory !== log.directory) {
          setRecordingStarted(Date.now());
          setRecordingElapsed(0);
        }
        setLog(value);
        setLogError('');
        setLogConfirm(false);
      }
    } catch (e) {
      reportError('log', e);
    } finally {
      setLogBusy(false);
    }
  }
  async function finishLog() {
    if (logBusy) return;
    setLogBusy(true);
    clearError('log');
    try {
      const value = await FinishTerminalLog(id);
      setLog(value);
      setLogError(
        eventError(value)
          ? uiMessage('terminal:recordingStopped', { value1: eventError(value) })
          : '',
      );
      setLogErrorDismissed(false);
    } catch (e) {
      reportError('log', e);
    } finally {
      setLogBusy(false);
    }
  }
  const [keywordOpen, setKeywordOpen] = useState(false);
  const [keyword, setKeyword] = useState('');
  async function exportBuffer() {
    clearError('export');
    try {
      const buffer = terminal.current?.buffer.active;
      if (!buffer) return;
      const lines: string[] = [];
      for (let y = 0; y < buffer.length; y++)
        lines.push(buffer.getLine(y)?.translateToString(true) || '');
      await ExportTerminalBuffer(lines.join('\n'));
      clearError('export');
    } catch (e) {
      reportError('export', e);
    }
  }
  async function pauseLog() {
    if (logBusy) return;
    setLogBusy(true);
    clearError('log');
    try {
      const value = await PauseTerminalLog(id);
      setLog(value);
      setLogError(
        eventError(value)
          ? uiMessage('terminal:recordingStopped', { value1: eventError(value) })
          : '',
      );
      setLogErrorDismissed(false);
      clearError('log');
    } catch (e) {
      reportError('log', e);
    } finally {
      setLogBusy(false);
    }
  }
  useEffect(() => {
    if (!log?.recording || !connected) return;
    let ended = false;
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const value = await GetTerminalLogStatus(id);
        if (!ended) {
          setLog(value);
          setLogError(
            eventError(value)
              ? uiMessage('terminal:logRecordingStopped', { value1: eventError(value) })
              : '',
          );
          if (!value.error) setLogErrorDismissed(false);
        }
      } catch (e) {
        if (!ended) setLogError(e);
      } finally {
        if (!ended) timer = setTimeout(load, 2000);
      }
    }
    timer = setTimeout(load, 2000);
    return () => {
      ended = true;
      clearTimeout(timer);
    };
  }, [id, log?.recording, connected, setLogError]);
  const [shell, setShell] = useState<'bash' | 'zsh'>(local && System.IsMac() ? 'zsh' : 'bash');
  const shellSetup = useMemo(
    () => shellCompletionSetup(shell, host, setupToken),
    [shell, host, setupToken],
  );
  const integration = useRef<ReturnType<typeof addShellIntegration>>();
  const callbacks = useRef({ onDirectory, onFile, onAttention, onActivate });
  callbacks.current = { onDirectory, onFile, onAttention, onActivate };
  const shown = useRef(visible);
  shown.current = visible;
  const appFocused = useRef(document.hasFocus());
  const focusRequested = useRef(focusOnShow);
  focusRequested.current = focusOnShow;
  const inputStream = useRef<ReturnType<typeof Stream>>();
  const completion = useTerminalCompletion({
    id,
    workspace,
    visible,
    terminal,
    send: sendFrame,
    fail: (message) => reportError('completion', message),
    help: () => setHelp({}),
  });
  const complete = useRef(completion);
  complete.current = completion;
  const stateCallback = useRef(onConnectionChange);
  stateCallback.current = onConnectionChange;
  async function toggleReminder() {
    if (reminderCommand.current !== undefined) {
      reminderCommand.current = undefined;
      setReminder(false);
      return;
    }
    const term = terminal.current;
    const command = currentCommand.current;
    setArmingReminder(true);
    clearError('notification');
    try {
      await EnableCommandNotification();
      if (terminal.current === term && running.current && currentCommand.current === command) {
        reminderCommand.current = command;
        setReminder(true);
      }
    } catch (e) {
      if (terminal.current === term) reportError('notification', e);
    } finally {
      if (terminal.current === term) setArmingReminder(false);
    }
  }
  useEffect(() => {
    if (demoOutput !== undefined) return;
    const clearAttention = () => {
      appFocused.current = true;
      if (shown.current && !running.current) callbacks.current.onAttention?.();
    };
    const off = [
      Events.On(Events.Types.Common.WindowFocus, clearAttention),
      Events.On(Events.Types.Common.WindowLostFocus, () => {
        appFocused.current = false;
      }),
      Events.On('terminal:notification-activated', (event) => {
        if (event.data === id) callbacks.current.onActivate?.();
      }),
    ];
    return () => off.forEach((dispose) => dispose());
  }, [id, demoOutput]);
  useEffect(() => {
    if (visible && appFocused.current && !running.current) callbacks.current.onAttention?.();
  }, [visible]);
  function sendFrame(data: string): boolean {
    if (inputLocked.current) {
      reportError('input', translate('terminal:terminalInputLocked'));
      return false;
    }
    const stream = inputStream.current,
      bytes = new TextEncoder().encode(data);
    if (!stream || stream.readyState !== stream.OPEN) {
      reportError('completion', translate('terminal:terminalDisconnected'));
      return false;
    }
    if (stream.bufferedAmount + bytes.length + Math.ceil(bytes.length / 32768) > 256 * 1024) {
      reportError('completion', translate('terminal:inputQueueFullWaitForTheRemoteHost'));
      return false;
    }
    for (let offset = 0; offset < bytes.length; offset += 32768) {
      const chunk = bytes.subarray(offset, offset + 32768);
      const frame = new Uint8Array(chunk.length + 1);
      frame.set(chunk, 1);
      stream.send(frame);
    }
    return true;
  }
  function openIntegration() {
    completion.dismiss();
    setPathCompletion(false);
    setSetupToken(
      Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
        byte.toString(16).padStart(2, '0'),
      ).join(''),
    );
    setIntegrationOpen(true);
  }
  function confirmPaste() {
    if (inputLocked.current) return;
    if (nextIntegration.current) {
      clearError('completion');
      commandToken.current = nextIntegration.current.token;
      completion.activate(
        nextIntegration.current.token,
        nextIntegration.current.paths && !containerConsole,
      );
      nextIntegration.current = undefined;
    }
    terminal.current?.paste(paste || '');
    setPaste(undefined);
    terminal.current?.focus();
  }
  function insert(text: string): boolean {
    if (inputLocked.current) {
      reportError('input', translate('terminal:terminalInputLocked'));
      return false;
    }
    if (demoOutput !== undefined) {
      reportError('input', translate('terminal:demoTerminalsDoNotExecuteCommands'));
      return false;
    }
    const size = new TextEncoder().encode(text).length;
    if (size > 256 * 1024 - 16) {
      reportError('input', translate('terminal:pastedContentExceedsInputQueueLimit256KiB'));
      return false;
    }
    const stream = inputStream.current;
    if (!stream || stream.readyState !== stream.OPEN) {
      reportError('input', translate('terminal:terminalDisconnected'));
      return false;
    }
    if (stream.bufferedAmount + size + Math.ceil(size / 32768) + 16 > 256 * 1024) {
      reportError('input', translate('terminal:inputQueueFullWaitForTheRemoteHost'));
      return false;
    }
    clearError('input');
    completion.dismiss();
    if (/[\r\n]/.test(text)) setPaste(text);
    else terminal.current?.paste(text);
    return true;
  }
  function action(name: TerminalAction) {
    const term = terminal.current;
    if (!term) return;
    if (name === 'find') {
      setSearchQuery(term.getSelection());
      setSearchOpen(true);
    }
    if (name === 'terminalCompletion') {
      clearError('completion');
      term.focus();
      completion.request();
      return;
    }
    if (name === 'commandHelp') {
      const command = completion.view?.context.command?.name;
      completion.dismiss();
      setHelp({ command });
      return;
    }
    if (name === 'copy')
      navigator.clipboard
        .writeText(term.getSelection())
        .then(() => clearError('clipboard'))
        .catch((e) => reportError('clipboard', e));
    if (name === 'paste' && demoOutput === undefined)
      navigator.clipboard
        .readText()
        .then((value) => {
          clearError('clipboard');
          insert(value);
        })
        .catch((e) => reportError('clipboard', e));
    if (name === 'selectAll') term.selectAll();
    if (name === 'clear') term.clear();
    if (name === 'zoomIn') setZoom((v) => Math.min(36 - fontSize, v + 1));
    if (name === 'zoomOut') setZoom((v) => Math.max(9 - fontSize, v - 1));
    if (name === 'zoomReset') setZoom(0);
    if (name !== 'find' && name !== 'paste') term.focus();
  }
  useImperativeHandle(ref, () => ({
    action,
    insert,
    ended: () =>
      !!inputStream.current && inputStream.current.readyState === inputStream.current.CLOSED,
  }));
  /* oxlint-disable react/exhaustive-deps -- Terminal identity owns the PTY and xterm instance; appearance and size are updated by separate effects. */
  useEffect(() => {
    const term = new Terminal({
      fontFamily: monospaceFont(appearance),
      fontSize,
      lineHeight: 1.3,
      scrollback: 5000,
      cursorBlink: demoOutput === undefined,
      disableStdin: demoOutput !== undefined,
      allowProposedApi: true,
      theme: colors,
    });
    term.loadAddon(new Unicode11Addon());
    term.unicode.activeVersion = '11';
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container.current!);
    const finder = new SearchAddon({ highlightLimit: searchHighlightLimit });
    term.loadAddon(finder);
    search.current = finder;
    term.loadAddon(
      new WebLinksAddon((event, uri) => {
        if (demoOutput !== undefined || !(event.ctrlKey || event.metaKey)) return;
        const url = new URL(uri);
        if (url.protocol === 'http:' || url.protocol === 'https:')
          Browser.OpenURL(url)
            .then(() => clearError('link'))
            .catch((e) => reportError('link', e));
      }),
    );
    terminal.current = term;
    setCommandEntries([]);
    commandToken.current = '';
    integration.current = addShellIntegration(
      term,
      (path, host) => {
        setCwd(path);
        callbacks.current.onDirectory?.(path, host);
      },
      setExitCode,
      (path, line) => callbacks.current.onFile?.(path, line),
      (kind) => complete.current.command(kind),
      (data) => {
        const command = parseRecordedCommand(data, commandToken.current);
        if (command !== undefined) integration.current?.recordCommand(command);
        else complete.current.receive(data);
      },
      (entries) => {
        setCommandEntries(entries);
        const latest = entries[entries.length - 1];
        if (!latest || demoOutput !== undefined) return;
        if (latest.duration === undefined) {
          currentCommand.current = latest.id;
          running.current = true;
          setRunningCommand(true);
          callbacks.current.onAttention?.('running');
        } else if (running.current && currentCommand.current === latest.id) {
          running.current = false;
          setRunningCommand(false);
          const failed = latest.exitCode !== undefined && latest.exitCode !== '0';
          callbacks.current.onAttention?.(
            shown.current && appFocused.current ? undefined : failed ? 'failed' : 'completed',
          );
          if (reminderCommand.current === latest.id) {
            reminderCommand.current = undefined;
            setReminder(false);
            NotifyCommandFinished(id, failed).catch((e) => {
              if (terminal.current === term) reportError('notification', e);
            });
          }
        }
      },
    );
    term.attachCustomKeyEventHandler((event) => complete.current.key(event));
    const bufferChange = term.buffer.onBufferChange(() => complete.current.invalidate());
    const textarea = term.textarea,
      blur = () => complete.current.dismiss();
    textarea?.addEventListener('blur', blur);
    let fitFrame = 0;
    const fitVisible = () => {
      if (fitFrame) return;
      fitFrame = requestAnimationFrame(() => {
        fitFrame = 0;
        if (!shown.current || !container.current?.clientWidth || !container.current.clientHeight)
          return;
        const size = fit.proposeDimensions();
        if (size && (size.cols !== term.cols || size.rows !== term.rows)) fit.fit();
      });
    };
    requestFit.current = fitVisible;
    if (demoOutput !== undefined) {
      if (shown.current && container.current?.clientWidth) fit.fit();
      term.write(demoOutput);
      setConnected(true);
      if (shown.current && focusRequested.current) term.focus();
      const observer = new ResizeObserver(fitVisible);
      observer.observe(container.current!);
      return () => {
        observer.disconnect();
        bufferChange.dispose();
        textarea?.removeEventListener('blur', blur);
        cancelAnimationFrame(fitFrame);
        requestFit.current = undefined;
        integration.current?.dispose();
        integration.current = undefined;
        term.dispose();
        terminal.current = undefined;
        search.current = undefined;
      };
    }
    const stream = Stream(
      containerConsole ? 'container-terminal' : local ? 'local-terminal' : 'terminal',
    );
    inputStream.current = stream;
    let disposed = false;
    const fail = (e: unknown) => {
      if (!disposed) reportError('resize', e);
    };
    stream.onopen = () => {
      stream.send(new TextEncoder().encode(id));
      setConnected(true);
      setStreamError('');
      stateCallback.current?.();
      fitVisible();
      if (
        shown.current &&
        focusRequested.current &&
        !document.querySelector('[role=dialog][data-open=true]')
      )
        term.focus();
    };
    stream.onmessage = (event) => {
      const bytes = new Uint8Array(event.data);
      term.write(bytes, () => {
        if (stream.readyState !== stream.OPEN) return;
        const ack = new Uint8Array(5);
        ack[0] = 1;
        new DataView(ack.buffer).setUint32(1, bytes.length);
        stream.send(ack);
      });
    };
    stream.onclose = () => {
      if (!disposed) {
        running.current = false;
        reminderCommand.current = undefined;
        setRunningCommand(false);
        setReminder(false);
        callbacks.current.onAttention?.();
        complete.current.invalidate();
        setConnected(false);
        setLog((previous) =>
          previous ? { ...previous, recording: false, finished: true } : previous,
        );
        term.options.disableStdin = true;
        stateCallback.current?.();
      }
    };
    stream.onerror = () => {
      if (!disposed) setStreamError(uiMessage('terminal:terminalDataStreamInterrupted'));
    };
    const input = term.onData((data) => {
      if (inputLocked.current) return;
      complete.current.input(data);
      const bytes = new TextEncoder().encode(data);
      if (stream.readyState !== stream.OPEN) return;
      if (stream.bufferedAmount + bytes.length + Math.ceil(bytes.length / 32768) > 256 * 1024) {
        if (!disposed)
          reportError('input', translate('terminal:inputQueueFullWaitForTheRemoteHost'));
        return;
      }
      clearError('input');
      for (let offset = 0; offset < bytes.length; offset += 32768) {
        const chunk = bytes.subarray(offset, offset + 32768);
        const frame = new Uint8Array(chunk.length + 1);
        frame.set(chunk, 1);
        stream.send(frame);
      }
    });
    const resize = term.onResize(({ cols, rows }) => {
      if (stream.readyState === stream.OPEN)
        (containerConsole
          ? ResizeContainerTerminal(id, cols, rows)
          : local
            ? ResizeLocalTerminal(id, cols, rows)
            : ResizeTerminal(id, cols, rows)
        )
          .then(() => {
            if (!disposed) clearError('resize');
          })
          .catch(fail);
    });
    const observer = new ResizeObserver(fitVisible);
    observer.observe(container.current!);
    const unsubscribe = Events.On('terminal:error', (event) => {
      const data = event.data as { id: string; error: string };
      if (data.id === id && !disposed) setStreamError(eventError(data));
    });
    return () => {
      disposed = true;
      bufferChange.dispose();
      textarea?.removeEventListener('blur', blur);
      integration.current?.dispose();
      integration.current = undefined;
      observer.disconnect();
      cancelAnimationFrame(fitFrame);
      requestFit.current = undefined;
      unsubscribe();
      input.dispose();
      resize.dispose();
      stream.close();
      term.dispose();
      terminal.current = undefined;
      search.current = undefined;
      inputStream.current = undefined;
      (containerConsole
        ? CloseContainerTerminal(id)
        : local
          ? CloseLocalTerminal(id)
          : CloseTerminal(id)
      ).catch(() => {});
    };
  }, [id, demoOutput, setStreamError]);
  /* oxlint-enable react/exhaustive-deps */
  useEffect(() => {
    const term = terminal.current;
    if (!term || !visible || appearance.terminalRenderer !== 'webgl') return;
    let ended = false;
    let addon: import('@xterm/addon-webgl').WebglAddon | undefined;
    let loss: { dispose(): void } | undefined;
    const release = () => {
      loss?.dispose();
      loss = undefined;
      addon?.dispose();
      addon = undefined;
    };
    clearError('renderer');
    void import('@xterm/addon-webgl')
      .then(({ WebglAddon }) => {
        if (ended) return;
        addon = new WebglAddon();
        loss = addon.onContextLoss(() => {
          release();
          reportError('renderer', translate('terminal:webGLContextLostBasicRendererRestored'));
        });
        term.loadAddon(addon);
      })
      .catch((error) => {
        release();
        if (!ended)
          reportError(
            'renderer',
            uiMessage('terminal:webGLUnavailableUsingBasicRenderer', { value1: error }),
          );
      });
    return () => {
      ended = true;
      release();
    };
  }, [id, demoOutput, visible, appearance.terminalRenderer]);
  useEffect(() => {
    if (terminal.current)
      terminal.current.options.theme = terminalTheme(appearance.terminalPalette, dark);
  }, [id, dark, appearance.terminalPalette]);
  useEffect(() => {
    if (terminal.current && visible && appearance.terminalLogHighlight)
      return addLogHighlights(terminal.current, terminalTheme(appearance.terminalPalette, dark))
        .dispose;
  }, [id, visible, appearance.terminalLogHighlight, appearance.terminalPalette, dark]);
  useEffect(() => {
    if (terminal.current && visible && keyword)
      return addLogHighlights(
        terminal.current,
        terminalTheme(appearance.terminalPalette, dark),
        keyword,
      ).dispose;
  }, [id, visible, keyword, appearance.terminalPalette, dark]);
  useEffect(() => {
    const term = terminal.current;
    if (!term) return;
    const family = fontFamily;
    if (term.options.fontFamily !== family) {
      term.options.fontFamily = family;
      requestFit.current?.();
    }
  }, [id, fontFamily]);
  useEffect(() => {
    const term = terminal.current;
    if (!term) return;
    const size = Math.max(9, Math.min(36, fontSize + zoom));
    if (term.options.fontSize !== size) {
      term.options.fontSize = size;
      requestFit.current?.();
    }
  }, [id, fontSize, zoom]);
  useLayoutEffect(() => {
    if (visible) {
      requestFit.current?.();
      if (focusRequested.current && !document.activeElement?.closest('[role=tablist]'))
        terminal.current?.focus();
    }
  }, [id, visible]);
  function closeSearch() {
    setSearchOpen(false);
    search.current?.clearDecorations();
    terminal.current?.focus();
  }
  return (
    <div
      className="terminal-view"
      onPasteCapture={(e) => {
        if (!(e.target as HTMLElement).closest('.xterm')) return;
        e.preventDefault();
        e.stopPropagation();
        insert(e.clipboardData.getData('text/plain'));
      }}
    >
      <div className="terminal-tools">
        {demoOutput === undefined && (
          <button className="session-tool" aria-pressed={locked} onClick={toggleInputLock}>
            {locked ? translate('terminal:inputLockedUnlock') : translate('terminal:lockInput')}
          </button>
        )}
        {!containerConsole && (
          <Tooltip content={translate('terminal:commandSnippets')}>
            <button
              className="icon-button"
              aria-label={translate('terminal:commandSnippets')}
              disabled={demoOutput !== undefined || locked}
              onClick={onSnippets}
            >
              <Icon name="list" width="14" />
            </button>
          </Tooltip>
        )}
        <Tooltip content={translate('terminal:findInTerminal')}>
          <button
            className="icon-button"
            aria-label={translate('terminal:findInTerminal')}
            onClick={() => action('find')}
          >
            <Icon name="search" width="14" />
          </button>
        </Tooltip>
        <Dropdown>
          <DropdownTrigger>
            <Tooltip content={translate('terminal:terminalActions')}>
              <button className="icon-button" aria-label={translate('terminal:terminalActions')}>
                <Icon name="more" width="14" />
              </button>
            </Tooltip>
          </DropdownTrigger>
          <DropdownMenu
            aria-label={translate('terminal:terminalActions')}
            disabledKeys={
              demoOutput !== undefined
                ? ['paste', 'export', 'log', 'outputLog', 'tmux', 'integration']
                : []
            }
            onAction={(key) => {
              if (
                demoOutput !== undefined &&
                ['paste', 'export', 'log', 'outputLog', 'tmux', 'integration'].includes(String(key))
              )
                return;
              if (key === 'keyword') setKeywordOpen((value) => !value);
              else if (key === 'export') void exportBuffer();
              else if (key === 'tmux') setTmuxOpen(true);
              else if (key === 'integration') openIntegration();
              else if (key === 'previousCommand') integration.current?.previous();
              else if (key === 'commandOutput') integration.current?.selectOutput();
              else action(key as TerminalAction);
            }}
          >
            <DropdownItem key="copy">{translate('terminal:copy')}</DropdownItem>
            <DropdownItem key="paste">{translate('terminal:paste')}</DropdownItem>
            <DropdownItem key="selectAll">{translate('terminal:selectAll')}</DropdownItem>
            <DropdownItem key="find" showDivider>
              {translate('terminal:find')}
            </DropdownItem>
            <DropdownItem key="clear">{translate('terminal:clearDisplay')}</DropdownItem>
            <DropdownItem key="zoomIn">{translate('terminal:increaseFontSize')}</DropdownItem>
            <DropdownItem key="zoomOut">{translate('terminal:decreaseFontSize')}</DropdownItem>
            <DropdownItem key="zoomReset" showDivider>
              {translate('terminal:resetFontSize')}
            </DropdownItem>
            {canAI ? (
              <DropdownItem key="aiReference" isDisabled={!hasAISelection} onPress={aiReference}>
                {translate('terminal:attachToAIConversation')}
              </DropdownItem>
            ) : null}
            <DropdownItem key="previousCommand">
              {translate('terminal:jumpToPreviousCommand')}
            </DropdownItem>
            <DropdownItem key="commandOutput">
              {translate('terminal:selectLastCommandOutput')}
            </DropdownItem>
            <DropdownItem key="integration" isDisabled={!connected}>
              {translate('terminal:enableCurrentShellIntegration2')}
            </DropdownItem>
            <DropdownItem key="commandIndex" onPress={() => setCommandIndexOpen(true)}>
              {translate('terminal:commandsInThisSession2')}
            </DropdownItem>
            <DropdownItem
              key="reminder"
              isDisabled={
                !connected || !runningCommand || armingReminder || demoOutput !== undefined
              }
              onPress={() => void toggleReminder()}
              endContent={reminder ? '✓' : null}
            >
              {translate('terminal:notifyOnCompletion')}
            </DropdownItem>
            <DropdownItem
              key="terminalCompletion"
              isDisabled={!connected || demoOutput !== undefined}
            >
              {translate('terminal:commandCompletion')}
            </DropdownItem>
            <DropdownItem key="commandHelp">
              {translate('terminal:pOSIXCommandReference2')}
            </DropdownItem>
            <DropdownItem
              key="tmux"
              className={local || containerConsole ? 'hidden' : ''}
              isDisabled={local || containerConsole || !connected}
            >
              {translate('terminal:tmuxSessions')}
            </DropdownItem>
            <DropdownItem key="keyword" showDivider>
              {translate('terminal:temporaryKeywordHighlighting')}
            </DropdownItem>
            <DropdownItem key="export">
              {translate('terminal:exportCurrentTerminalContent')}
            </DropdownItem>
            <DropdownItem
              key="log"
              className={local || containerConsole ? 'hidden' : ''}
              isDisabled={
                local ||
                containerConsole ||
                !connected ||
                logBusy ||
                (!!log?.directory && !log.finished)
              }
              onPress={() => {
                setLogFormat('asciicast');
                setLogConfirm(true);
              }}
            >
              {translate('terminal:startRecording')}
            </DropdownItem>
            <DropdownItem
              key="outputLog"
              className={local || containerConsole ? 'hidden' : ''}
              isDisabled={
                local ||
                containerConsole ||
                !connected ||
                logBusy ||
                (!!log?.directory && !log.finished)
              }
              onPress={() => {
                setLogFormat('ansi');
                setLogConfirm(true);
              }}
            >
              {translate('terminal:saveOutputLog')}
            </DropdownItem>
            <DropdownItem
              key="playback"
              isDisabled={demoOutput !== undefined}
              onPress={() => setPlayback('file')}
            >
              {translate('terminal:openTerminalRecording')}
            </DropdownItem>
          </DropdownMenu>
        </Dropdown>
      </div>
      {searchOpen && search.current && (
        <TerminalSearch addon={search.current} initialQuery={searchQuery} onClose={closeSearch} />
      )}
      {playback && (
        <Suspense fallback={<div role="status">{translate('terminal:loadingPlayback')}</div>}>
          <RecordingPlayer
            terminal={playback === 'current' ? id : undefined}
            onClose={() => setPlayback(undefined)}
          />
        </Suspense>
      )}
      {commandIndexOpen && (
        <Suspense
          fallback={<div role="status">{translate('terminal:loadingThisSessionSCommands')}</div>}
        >
          <CommandIndexDialog
            entries={commandEntries}
            enabled={completion.enabled}
            pending={!!commandToken.current}
            canEnable={!!connected && !locked && demoOutput === undefined}
            onEnable={() => {
              setCommandIndexOpen(false);
              openIntegration();
            }}
            onGoTo={(id) => integration.current?.goTo(id) || false}
            onOutput={(id) => {
              if (!integration.current) throw uiMessage('terminal:terminalClosed');
              return integration.current.outputText(id);
            }}
            onClose={() => setCommandIndexOpen(false)}
          />
        </Suspense>
      )}
      {keywordOpen && (
        <div className="terminal-search">
          <input
            aria-label={translate('terminal:temporaryHighlightKeywords')}
            placeholder={translate('terminal:highlightKeywords')}
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            maxLength={128}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
                setKeyword('');
                setKeywordOpen(false);
                terminal.current?.focus();
              }
            }}
          />
          <button
            className="icon-button"
            aria-label={translate('terminal:clearTemporaryHighlighting')}
            onClick={() => {
              setKeyword('');
              setKeywordOpen(false);
            }}
          >
            <Icon name="close" width="14" />
          </button>
        </div>
      )}
      {tmuxSession && (
        <div className="terminal-tmux">
          <span>tmux · {tmuxSession}</span>
          {(!tmuxAttached || connected === false) && (
            <Button
              size="sm"
              variant="light"
              isDisabled={!tmuxAvailable}
              onPress={() => {
                void onTmuxAttach?.(tmuxSession);
              }}
            >
              {translate('terminal:reattach')}
            </Button>
          )}
          <Button size="sm" variant="light" onPress={onTmuxUnbind}>
            {translate('terminal:unbind')}
          </Button>
        </div>
      )}
      {tmuxOpen && (
        <TmuxDialog
          workspace={workspace}
          onInsert={insert}
          onAttach={onTmuxAttach}
          onClose={() => setTmuxOpen(false)}
        />
      )}
      <div
        className="terminal-canvas"
        ref={container}
        style={{ background: colors.background }}
        onContextMenu={(event) => {
          const text = terminal.current?.getSelection();
          if (!canAI || !text) return;
          event.preventDefault();
          setAIContext({
            x: event.clientX,
            y: event.clientY,
            reference: { workspace, terminal: id, text },
          });
        }}
        onKeyDownCapture={(event) => {
          if (!canAI || !(event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')))
            return;
          const text = terminal.current?.getSelection();
          if (!text) return;
          event.preventDefault();
          event.stopPropagation();
          const rect = event.currentTarget.getBoundingClientRect();
          setAIContext({
            x: rect.left + 40,
            y: rect.top + 40,
            reference: { workspace, terminal: id, text },
          });
        }}
      />
      {canAI && (
        <Dropdown
          isOpen={!!aiContext}
          onOpenChange={(open) => {
            if (!open) setAIContext(undefined);
          }}
          placement="bottom-start"
        >
          <DropdownTrigger>
            <button
              type="button"
              tabIndex={-1}
              aria-hidden={!aiContext}
              aria-label={translate('terminal:terminalSelectionMenu')}
              className="terminal-context-trigger"
              style={{ left: aiContext?.x || 0, top: aiContext?.y || 0 }}
            />
          </DropdownTrigger>
          <DropdownMenu
            aria-label={translate('terminal:terminalSelectionActions')}
            disabledKeys={locked ? ['paste'] : []}
            onAction={(key) => {
              const snapshot = aiContext;
              setAIContext(undefined);
              if (key === 'ai' && snapshot) onAIReference?.(snapshot.reference);
              else if (key === 'copy' && snapshot)
                navigator.clipboard
                  .writeText(snapshot.reference.text)
                  .catch((e) => reportError('clipboard', e));
              else if (key === 'paste') action('paste');
            }}
          >
            <DropdownItem key="copy">{translate('terminal:copy')}</DropdownItem>
            <DropdownItem key="paste">{translate('terminal:paste')}</DropdownItem>
            <DropdownItem key="ai" showDivider>
              {translate('terminal:attachToAIConversation')}
            </DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )}
      <TerminalCompletion
        completion={completion}
        onHelp={(command) => {
          completion.dismiss();
          setHelp({ command });
        }}
      />
      {help && (
        <CommandHelpDialog
          initial={help.command}
          enabled={completion.enabled}
          onEnable={() => {
            setHelp(undefined);
            openIntegration();
          }}
          onClose={() => {
            setHelp(undefined);
            terminal.current?.focus();
          }}
        />
      )}
      {log?.directory && (
        <div className="session-status terminal-recording-status" role="status">
          <span className={log.recording ? 'recording-indicator' : ''}>
            {errorMessage(eventError(log))
              ? translate('terminal:recordingStoppedUnexpectedly')
              : !connected
                ? translate('terminal:recordingFinished')
                : log.finished
                  ? translate('terminal:saved2', {
                      value1:
                        log.format === 'asciicast'
                          ? translate('terminal:recordingNoun')
                          : translate('connections:logs'),
                    })
                  : log.recording
                    ? log.format === 'asciicast'
                      ? translate('terminal:recording')
                      : translate('terminal:logging')
                    : translate('terminal:paused')}
          </span>
          {log.format === 'asciicast' && !log.finished && (
            <span className="recording-duration" aria-hidden="true">
              {Math.floor(recordingElapsed / 60)
                .toString()
                .padStart(2, '0')}
              :{(recordingElapsed % 60).toString().padStart(2, '0')}
            </span>
          )}
          <Tooltip content={log.file || log.directory}>
            <span className="recording-file file-path">
              {log.format === 'asciicast' ? 'session.cast' : translate('terminal:aNSIOutputLog')}
            </span>
          </Tooltip>
          <div className="status-spacer" />
          {connected && !log.finished && (
            <>
              {log.recording ? (
                <button className="session-tool" disabled={logBusy} onClick={() => void pauseLog()}>
                  {translate('terminal:pause')}
                </button>
              ) : (
                <button
                  className="session-tool"
                  disabled={logBusy || !!errorMessage(eventError(log))}
                  onClick={() => void startLog(log.format === 'asciicast' ? 'asciicast' : 'ansi')}
                >
                  {translate('terminal:resume')}
                </button>
              )}
              <button className="session-tool" disabled={logBusy} onClick={() => void finishLog()}>
                {log.format === 'asciicast'
                  ? translate('terminal:finishRecording')
                  : translate('terminal:finishLogging')}
              </button>
            </>
          )}
          {!log.recording && log.format === 'asciicast' && (
            <button
              className="session-tool"
              disabled={logBusy}
              onClick={() => setPlayback(connected ? 'current' : 'file')}
            >
              {connected ? translate('terminal:play') : translate('terminal:openRecording')}
            </button>
          )}
          {connected ? (
            <button
              className="session-tool"
              onClick={() => {
                OpenTerminalLogDirectory(id)
                  .then(() => clearError('log'))
                  .catch((e) => reportError('log', e));
              }}
            >
              {translate('terminal:showInFolder')}
            </button>
          ) : (
            <button
              className="session-tool"
              onClick={() => {
                navigator.clipboard
                  .writeText(log.file || log.directory)
                  .then(() => clearError('clipboard'))
                  .catch((e) => reportError('clipboard', e));
              }}
            >
              {translate('terminal:copySaveLocation')}
            </button>
          )}
          {logError && (
            <button className="session-tool error" onClick={() => setLogErrorDismissed(false)}>
              {translate('terminal:viewError')}
            </button>
          )}
        </div>
      )}
      <Modal
        isOpen={logConfirm}
        onClose={() => {
          if (!logBusy) {
            setLogConfirm(false);
            clearError('log');
          }
        }}
        isDismissable={!logBusy}
        isKeyboardDismissDisabled={logBusy}
        className="app-dialog"
      >
        <ModalContent>
          <ModalHeader>
            {logFormat === 'asciicast'
              ? translate('terminal:startTerminalRecording')
              : translate('terminal:saveOutputLog2')}
          </ModalHeader>
          <ModalBody>
            <p>
              {logFormat === 'asciicast'
                ? translate('terminal:recordTerminalOutputFromNowOnForLocal')
                : translate('terminal:saveRawANSIOutputFromNowOnFor')}
            </p>
            <div className="recording-destination">
              <span className="muted">{translate('terminal:saveLocally')}</span>
              <span>
                {logFormat === 'asciicast'
                  ? translate('terminal:selectedFolderSeparateRecordingDirectorySessionCast')
                  : translate('terminal:selectedFolderSeparateSessionDirectoryAnsi')}
              </span>
            </div>
            <p className="muted">
              {translate('terminal:outputMayContainPasswordsTokensOrOtherSensitive')}
            </p>
            <details>
              <summary>{translate('terminal:recordingLimits')}</summary>
              <p className="muted">
                {logFormat === 'asciicast'
                  ? translate('terminal:stopsAt16MiBOr100000EventsAnd')
                  : translate('terminal:keepsUpToThree8MiBLogSegments')}
              </p>
            </details>
            <ErrorNotice
              message={error?.source === 'log' ? errorMessage(error.message) : ''}
              onDismiss={() => clearError('log')}
            />
          </ModalBody>
          <ModalFooter>
            <Button
              variant="light"
              isDisabled={logBusy}
              onPress={() => {
                setLogConfirm(false);
                clearError('log');
              }}
            >
              {translate('terminal:cancel')}
            </Button>
            <Button color="primary" isLoading={logBusy} onPress={() => void startLog()}>
              {logFormat === 'asciicast'
                ? translate('terminal:selectLocationAndStartRecording')
                : translate('terminal:selectLocationAndStartLogging')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
      <ErrorNotice
        message={logConfirm && error?.source === 'log' ? '' : errorMessage(error?.message || '')}
        onDismiss={() => setError(undefined)}
      />
      {logError && !logErrorDismissed && (
        <ErrorNotice message={logError} onDismiss={() => setLogErrorDismissed(true)} />
      )}
      {(connected !== true || cwd || (exitCode && exitCode !== '0') || streamError) && (
        <div className="session-status">
          {connected !== true && (
            <span role="status">
              {connected === null
                ? translate('terminal:connecting')
                : translate('terminal:disconnected')}
            </span>
          )}
          {cwd && (
            <Tooltip content={cwd}>
              <span className="file-path">{cwd}</span>
            </Tooltip>
          )}
          {exitCode && exitCode !== '0' && (
            <span className="error">
              {translate('terminal:exitCode3')}
              {exitCode}
            </span>
          )}
          {streamError && (
            <details className="error">
              <summary>{translate('terminal:terminalConnectionError')}</summary>
              {errorMessage(streamError)}
            </details>
          )}
        </div>
      )}
      <Modal
        isOpen={integrationOpen}
        onClose={() => setIntegrationOpen(false)}
        className="app-dialog"
      >
        <ModalContent>
          <ModalHeader>{translate('terminal:currentShellIntegration')}</ModalHeader>
          <ModalBody>
            <label className="form-field">
              Shell
              <SelectControl
                value={shell}
                onChange={(event) => setShell(event.target.value as 'bash' | 'zsh')}
              >
                <option value="bash">Bash 4.4+</option>
                <option value="zsh">Zsh</option>
              </SelectControl>
            </label>
            <p className="muted">{translate('terminal:executeAtTheCurrentShellPromptItExpires')}</p>
            {!containerConsole && (
              <label className="terminal-path-confirm">
                <input
                  type="checkbox"
                  checked={pathCompletion}
                  disabled={local && System.IsWindows()}
                  onChange={(event) => setPathCompletion(event.target.checked)}
                />
                {translate('terminal:confirmThisShellUsesTheSameFilesystemAs')}
              </label>
            )}
            <pre className="paste-preview">{shellSetup}</pre>
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={() => setIntegrationOpen(false)}>
              {translate('terminal:cancel')}
            </Button>
            <Button
              color="primary"
              onPress={() => {
                if (insert(shellSetup + '\n')) {
                  nextIntegration.current = {
                    token: setupToken,
                    paths: pathCompletion && !containerConsole && !(local && System.IsWindows()),
                  };
                  setIntegrationOpen(false);
                }
              }}
            >
              {translate('terminal:insertAndPreview')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
      <Modal
        isOpen={paste !== undefined}
        onClose={() => {
          nextIntegration.current = undefined;
          setPaste(undefined);
          terminal.current?.focus();
        }}
        className="app-dialog"
      >
        <ModalContent>
          <ModalHeader>{translate('terminal:confirmMultilinePaste')}</ModalHeader>
          <ModalBody>
            <p>{translate('terminal:newlinesMayExecuteCommandsImmediatelyReviewTheContents')}</p>
            <pre className="paste-preview">{paste}</pre>
          </ModalBody>
          <ModalFooter>
            <Button
              variant="light"
              onPress={() => {
                nextIntegration.current = undefined;
                setPaste(undefined);
                terminal.current?.focus();
              }}
            >
              {translate('terminal:cancel')}
            </Button>
            <Button color="primary" onPress={confirmPaste}>
              {translate('terminal:pasteIntoTerminal')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
});
export default TerminalView;
