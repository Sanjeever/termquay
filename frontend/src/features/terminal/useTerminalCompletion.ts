import { message as uiMessage } from '../../i18n/messages.ts';

import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { Terminal } from '@xterm/xterm';
import { CompleteTerminalPath } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';

import {
  commandContext,
  pathCandidates,
  type CommandCandidate,
  type CompletionContext,
} from './terminalCompletion';
import {
  completionEdit,
  completionRequest,
  parseCompletionMessage,
  type ShellSnapshot,
} from './shellCompletionProtocol';

export type CompletionView = {
  snapshot: ShellSnapshot;
  context: CompletionContext;
  candidates: CommandCandidate[];
  selected: number;
  loading: boolean;
  truncated: boolean;
  error: unknown;
};
type Options = {
  id: string;
  workspace: string;
  visible: boolean;
  terminal: MutableRefObject<Terminal | undefined>;
  send(frame: string): boolean;
  fail(message: unknown): void;
  help(): void;
};

export default function useTerminalCompletion(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const [view, setView] = useState<CompletionView>();
  const popup = useRef<CompletionView>();
  const [enabled, setEnabled] = useState(false);
  const configuration = useRef<{ token: string; paths: boolean }>();
  const editing = useRef(false),
    prompt = useRef(false),
    requested = useRef(false);
  const applying = useRef<number>();
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const read = useRef<ReturnType<typeof CompleteTerminalPath>>();
  const version = useRef(0);
  const cache = useRef(
    new Map<
      string,
      { expires: number; entries: { name: string; directory: boolean }[]; truncated: boolean }
    >(),
  );
  function publish(value?: CompletionView) {
    popup.current = value;
    setView(value);
  }
  function dismiss() {
    version.current++;
    requested.current = false;
    if (applying.current === undefined) {
      clearTimeout(timer.current);
      timer.current = undefined;
    }
    read.current?.cancel();
    read.current = undefined;
    publish();
  }
  function reset() {
    applying.current = undefined;
    dismiss();
  }
  function activate(token: string, paths: boolean) {
    reset();
    configuration.current = { token, paths };
    editing.current = prompt.current = false;
    cache.current.clear();
    setEnabled(false);
  }
  function command(kind: string) {
    if (kind === 'A' || kind === 'C' || kind === 'D') {
      editing.current = false;
      if (kind === 'C') prompt.current = false;
      reset();
    }
    if (kind === 'B' && prompt.current) {
      editing.current = true;
      prompt.current = false;
      setEnabled(true);
    }
  }
  function input(data: string) {
    if (data === '\r' || data === '\n' || data === '\x03' || data === '\x04') {
      editing.current = false;
      reset();
    } else dismiss();
  }
  function request() {
    const { terminal, send, fail, help } = latest.current;
    if (!configuration.current) {
      help();
      return;
    }
    if (!editing.current || terminal.current?.buffer.active.type !== 'normal') {
      fail(uiMessage('terminal:triggerCompletionAtTheShellCommandPrompt'));
      return;
    }
    dismiss();
    requested.current = true;
    if (!send(completionRequest)) {
      dismiss();
      return;
    }
    timer.current = setTimeout(() => {
      reset();
      fail(uiMessage('terminal:shellDidNotReturnCompletionStateCheckThis'));
    }, 1500);
  }
  function receive(data: string) {
    const config = configuration.current;
    if (!config) return;
    const message = parseCompletionMessage(data, config.token);
    if (!message) return;
    if (message.kind === 'prompt') {
      reset();
      prompt.current = true;
      editing.current = false;
      return;
    }
    if (message.kind === 'error') {
      const wasApplying = applying.current !== undefined;
      reset();
      if (wasApplying) editing.current = true;
      latest.current.fail(message.messageCode ? uiMessage(message.messageCode) : message.message);
      return;
    }
    if (message.kind === 'applied') {
      if (applying.current === message.sequence) {
        reset();
        editing.current = true;
      }
      return;
    }
    if (!requested.current || !editing.current || !latest.current.visible) return;
    clearTimeout(timer.current);
    timer.current = undefined;
    requested.current = false;
    const snapshot = message.snapshot,
      context = commandContext(snapshot),
      current = ++version.current;
    const initial: CompletionView = {
      snapshot,
      context,
      candidates: context.candidates,
      selected: 0,
      loading: !!context.path && config.paths,
      truncated: false,
      error: context.unsupported || '',
    };
    if (context.path && !config.paths)
      initial.error = uiMessage('terminal:filesystemNotConfirmedForPathCompletionEnableIt');
    publish(initial);
    if (!context.path || !config.paths) return;
    const path = context.path;
    const key = JSON.stringify([path.directory, path.prefix, context.argument?.kind]);
    const update = (entries: { name: string; directory: boolean }[], truncated: boolean) => {
      if (version.current !== current) return;
      publish({
        ...initial,
        loading: false,
        truncated,
        candidates: [...initial.candidates, ...pathCandidates(context, entries)].slice(0, 64),
      });
    };
    const saved = cache.current.get(key);
    if (saved && saved.expires > Date.now()) {
      update(saved.entries, saved.truncated);
      return;
    }
    const pending = CompleteTerminalPath(
      latest.current.workspace,
      latest.current.id,
      path.directory,
      path.prefix,
      context.argument?.kind === 'directory',
    );
    read.current = pending;
    void pending
      .then((result) => {
        if (version.current !== current) return;
        if (cache.current.size >= 8) cache.current.delete(cache.current.keys().next().value!);
        cache.current.set(key, {
          expires: Date.now() + 3000,
          entries: result.entries!,
          truncated: result.truncated,
        });
        update(result.entries!, result.truncated);
      })
      .catch((error) => {
        if (version.current === current) publish({ ...initial, loading: false, error });
      })
      .finally(() => {
        if (read.current === pending) read.current = undefined;
      });
  }
  function accept(index = popup.current?.selected || 0) {
    const current = popup.current,
      config = configuration.current;
    if (
      !current ||
      !config ||
      !editing.current ||
      latest.current.terminal.current?.buffer.active.type !== 'normal'
    ) {
      dismiss();
      return;
    }
    const candidate = current.candidates[index];
    if (!candidate) return;
    try {
      const frame = completionEdit(
        config.token,
        current.snapshot,
        current.context.from,
        current.context.to,
        candidate.text,
      );
      reset();
      editing.current = false;
      applying.current = current.snapshot.sequence;
      if (!latest.current.send(frame)) {
        applying.current = undefined;
        editing.current = true;
        return;
      }
      timer.current = setTimeout(() => {
        reset();
        latest.current.fail(
          uiMessage('terminal:shellDidNotConfirmCompletionWritebackReenableIntegration'),
        );
      }, 1500);
    } catch (error) {
      reset();
      latest.current.fail(error);
    }
  }
  function key(event: KeyboardEvent) {
    if (event.type !== 'keydown') return true;
    if (event.isComposing) {
      dismiss();
      return true;
    }
    const current = popup.current;
    if (!current && !requested.current) return true;
    if (event.key === 'Escape') {
      event.preventDefault();
      dismiss();
      return false;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      accept();
      return false;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (current?.candidates.length)
        publish({
          ...current,
          selected:
            (current.selected + (event.key === 'ArrowDown' ? 1 : -1) + current.candidates.length) %
            current.candidates.length,
        });
      return false;
    }
    if (!['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) dismiss();
    return true;
  }
  useEffect(() => {
    if (!options.visible) dismiss();
  }, [options.visible]);
  useEffect(() => {
    if (!view) return;
    const outside = (event: PointerEvent) => {
      if (!(event.target as Element).closest('.terminal-completion')) dismiss();
    };
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('blur', dismiss);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('blur', dismiss);
    };
  }, [!!view]);
  useEffect(
    () => () => {
      version.current++;
      clearTimeout(timer.current);
      read.current?.cancel();
    },
    [options.id],
  );
  return {
    view,
    enabled,
    activate,
    command,
    input,
    request,
    receive,
    accept,
    key,
    dismiss,
    invalidate() {
      editing.current = prompt.current = false;
      reset();
    },
    anchor() {
      const terminal = latest.current.terminal.current,
        screen = terminal?.element?.querySelector('.xterm-screen');
      if (!terminal || !screen) return null;
      const rect = screen.getBoundingClientRect(),
        buffer = terminal.buffer.active,
        rowHeight = rect.height / terminal.rows;
      return {
        x: rect.left + (buffer.cursorX * rect.width) / terminal.cols,
        y:
          rect.top +
          Math.max(
            0,
            Math.min(terminal.rows - 1, buffer.baseY + buffer.cursorY - buffer.viewportY),
          ) *
            rowHeight,
        rowHeight,
      };
    },
    select(index: number) {
      if (popup.current) publish({ ...popup.current, selected: index });
    },
  };
}
