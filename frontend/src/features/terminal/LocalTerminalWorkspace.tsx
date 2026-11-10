import { createRef, forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  DropdownItem,
  DropdownMenu,
  DropdownTrigger,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from '@heroui/react';
import type { LocalShell } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import {
  CloseLocalTerminal,
  GetLocalTerminalDirectory,
  OpenLocalTerminal,
} from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import { t } from '../../i18n';
import { useMessageState } from '../../i18n/useMessageState';
import ErrorNotice from '../../components/ErrorNotice';
import Icon from '../../components/Icon';
import Modal from '../../components/Modal';
import { Dropdown } from '../../components/Popover';
import SelectControl from '../../components/SelectControl';
import Tooltip from '../../components/Tooltip';
import ResizeHandle from '../../components/layout/ResizeHandle';
import TerminalView, { type TerminalHandle } from './TerminalView';
import type { CommandAttention } from './commandAttention';
import { commandAttentionLabels } from './commandAttention';
import { localDirectoryName, localDirectoryReport } from './localTerminal';
import {
  equalPaneBoundaries,
  localGridTracks,
  localPaneCount,
  localPaneNeighbor,
  localWorkspaceLayouts,
  type LocalWorkspaceLayout,
} from './localWorkspaceLayout';

export type LocalTerminalSession = {
  id: string;
  shell: string;
  kind: string;
  directory: string;
  hostname: string;
};

type Session = LocalTerminalSession & {
  terminal: ReturnType<typeof createRef<TerminalHandle>>;
  ended?: boolean;
  attention?: CommandAttention;
};

export type LocalTerminalWorkspaceHandle = TerminalHandle & {
  newTerminal(): void;
  closeTerminal(): void;
  workspaceAction(action: string): boolean;
  sessions(): (LocalTerminalSession & { ended: boolean })[];
};

const LocalTerminalWorkspace = forwardRef<
  LocalTerminalWorkspaceHandle,
  {
    id: string;
    initial: LocalTerminalSession;
    shells: LocalShell[];
    visible: boolean;
    fontSize: number;
    onSelected(session: LocalTerminalSession): void;
    onStateChange(): void;
    onAttention(state?: CommandAttention): void;
    onActivate(): void;
    onSnippets(): void;
    onEmpty(): void;
  }
>(function LocalTerminalWorkspace(
  {
    id,
    initial,
    shells,
    visible,
    fontSize,
    onSelected,
    onStateChange,
    onAttention,
    onActivate,
    onSnippets,
    onEmpty,
  },
  ref,
) {
  useTranslation();
  const [sessions, setSessions] = useState<Session[]>(() => [
    { ...initial, terminal: createRef<TerminalHandle>() },
  ]);
  const latest = useRef(sessions);
  latest.current = sessions;
  const callbacks = useRef({ onSelected, onStateChange, onAttention, onActivate, onEmpty });
  callbacks.current = { onSelected, onStateChange, onAttention, onActivate, onEmpty };
  const [panes, setPanes] = useState([initial.id]);
  const [active, setActive] = useState(initial.id);
  const [layout, setLayout] = useState<LocalWorkspaceLayout>('single');
  const [columns, setColumns] = useState<number[]>([]);
  const [rows, setRows] = useState<number[]>([]);
  const [maximized, setMaximized] = useState(false);
  const [busy, setBusy] = useState(false);
  const opening = useRef(false);
  const disposed = useRef(false);
  const [error, setError] = useMessageState('');
  const [closing, setClosing] = useState('');
  const [toolbar, setToolbar] = useState<HTMLDivElement | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const drag = useRef('');
  const focusFrame = useRef(0);
  const [dropTarget, setDropTarget] = useState('');
  const count = localPaneCount(layout);
  const dimensions = localWorkspaceLayouts[layout];
  const current = sessions.find((session) => session.id === active) ?? sessions[0];

  useEffect(() => {
    disposed.current = false;
    return () => {
      disposed.current = true;
      cancelAnimationFrame(focusFrame.current);
    };
  }, []);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height }),
    );
    observer.observe(grid.current!);
    return () => observer.disconnect();
  }, []);

  function select(terminal: string, focus = true) {
    const session = latest.current.find((value) => value.id === terminal);
    if (!session) return;
    setActive(terminal);
    callbacks.current.onSelected(session);
    cancelAnimationFrame(focusFrame.current);
    if (focus) {
      const previous = document.activeElement;
      focusFrame.current = requestAnimationFrame(() => {
        if (!disposed.current && document.activeElement === previous)
          session.terminal.current?.focus();
      });
    }
  }

  function attention(terminal: string, value?: CommandAttention) {
    const next = latest.current.map((session) =>
      session.id === terminal ? { ...session, attention: value } : session,
    );
    latest.current = next;
    setSessions(next);
    const states = next.map((session) => session.attention);
    callbacks.current.onAttention(
      states.includes('failed')
        ? 'failed'
        : states.includes('completed')
          ? 'completed'
          : states.includes('running')
            ? 'running'
            : undefined,
    );
  }

  async function createSession(kind: string, source: Session): Promise<Session | undefined> {
    let directory = source.kind === kind && source.directory !== '~' ? source.directory : '';
    if (source.kind === kind && kind !== 'wsl' && !source.terminal.current?.ended()) {
      directory = (await GetLocalTerminalDirectory(source.id)) || directory;
    }
    if (disposed.current) return;
    const opened = await OpenLocalTerminal(kind, directory, 100, 30);
    if (disposed.current) {
      await CloseLocalTerminal(opened.id);
      return;
    }
    const session: Session = {
      id: opened.id,
      shell: opened.name,
      kind,
      directory: opened.directory,
      hostname: opened.hostname,
      terminal: createRef<TerminalHandle>(),
    };
    latest.current = [...latest.current, session];
    setSessions(latest.current);
    return session;
  }

  async function openTerminal(kind = current.kind, position = panes.indexOf(active)) {
    if (opening.current) return;
    opening.current = true;
    setBusy(true);
    setError('');
    try {
      const session = await createSession(kind, current);
      if (!session) return;
      setPanes((previous) => {
        const next = [...previous];
        next[Math.max(0, position)] = session.id;
        return next;
      });
      select(session.id);
    } catch (error) {
      if (!disposed.current) setError(error);
    } finally {
      opening.current = false;
      if (!disposed.current) setBusy(false);
    }
  }

  async function changeLayout(nextLayout: LocalWorkspaceLayout) {
    if (opening.current) return;
    opening.current = true;
    setBusy(true);
    setError('');
    const nextCount = localPaneCount(nextLayout);
    const next = [
      ...panes,
      ...sessions.filter((session) => !panes.includes(session.id)).map((session) => session.id),
    ].slice(0, nextCount);
    if (!next.includes(active) && next.length) next[next.length - 1] = active;
    setLayout(nextLayout);
    setColumns(equalPaneBoundaries(localWorkspaceLayouts[nextLayout].columns));
    setRows(equalPaneBoundaries(localWorkspaceLayouts[nextLayout].rows));
    setMaximized(false);
    setPanes(next);
    try {
      while (next.length < nextCount) {
        const session = await createSession(current.kind, current);
        if (!session) return;
        next.push(session.id);
        setPanes([...next]);
      }
    } catch (error) {
      if (!disposed.current) setError(error);
    } finally {
      opening.current = false;
      if (!disposed.current) setBusy(false);
    }
  }

  function remove(terminal: string) {
    const remaining = latest.current.filter((session) => session.id !== terminal);
    latest.current = remaining;
    setSessions(remaining);
    setClosing('');
    if (!remaining.length) {
      callbacks.current.onEmpty();
      return;
    }
    const next = panes.filter((value) => value !== terminal);
    const replacement = remaining.find((session) => !next.includes(session.id));
    if (replacement && next.length < count) next.push(replacement.id);
    setPanes(next);
    if (active === terminal) select(next[0] ?? remaining[0].id);
    callbacks.current.onStateChange();
  }

  function closeTerminal(terminal = active) {
    if (opening.current) return;
    const session = latest.current.find((value) => value.id === terminal);
    if (!session) return;
    if (session.terminal.current?.ended()) remove(terminal);
    else setClosing(terminal);
  }

  function exchange(first: string, second: string) {
    if (opening.current || first === second) return;
    setPanes((previous) =>
      previous.map((terminal) =>
        terminal === first ? second : terminal === second ? first : terminal,
      ),
    );
  }

  function moveFocus(direction: string) {
    const index = panes.indexOf(active);
    const target = localPaneNeighbor(layout, index, direction);
    if (panes[target]) select(panes[target]);
  }

  useImperativeHandle(ref, () => ({
    ended: () => latest.current.every((session) => session.terminal.current?.ended()),
    action: (action) => current.terminal.current?.action(action),
    insert: (text) => current.terminal.current?.insert(text) ?? false,
    focus: () => current.terminal.current?.focus(),
    newTerminal: () => {
      void openTerminal();
    },
    closeTerminal,
    sessions: () =>
      latest.current.map((session) => ({
        ...session,
        ended: session.terminal.current?.ended() ?? false,
      })),
    workspaceAction(action) {
      if (action === 'switchPane') {
        select(panes[(panes.indexOf(active) + 1) % panes.length]);
        return true;
      }
      if (action.startsWith('focusTerminal')) {
        moveFocus(action.slice('focusTerminal'.length));
        return true;
      }
      if (action === 'closeContent') {
        closeTerminal();
        return true;
      }
      if (action === 'newTerminal') {
        void openTerminal();
        return true;
      }
      return false;
    },
  }));

  const closingSession = sessions.find((session) => session.id === closing);
  return (
    <div className="local-workspace">
      <div className="local-workspace-toolbar">
        <SelectControl
          aria-label={t('terminal:workspaceLayout')}
          value={layout}
          disabled={busy}
          onChange={(event) => {
            void changeLayout(event.target.value as LocalWorkspaceLayout);
          }}
        >
          {(Object.keys(localWorkspaceLayouts) as LocalWorkspaceLayout[]).map((value) => (
            <option key={value} value={value}>
              {t(`terminal:layout_${value}`)}
            </option>
          ))}
        </SelectControl>
        <Tooltip content={t('terminal:newTerminalInWorkspace')}>
          <button
            className="icon-button"
            aria-label={t('terminal:newTerminalInWorkspace')}
            disabled={busy}
            onClick={() => {
              void openTerminal();
            }}
          >
            <Icon name="plus" width="14" />
          </button>
        </Tooltip>
        <Dropdown>
          <DropdownTrigger>
            <button
              className="icon-button"
              aria-label={t('common:localTerminalOptions')}
              disabled={busy}
            >
              <Icon name="chevron" width="12" style={{ transform: 'rotate(90deg)' }} />
            </button>
          </DropdownTrigger>
          <DropdownMenu
            aria-label={t('common:localTerminalOptions')}
            onAction={(kind) => {
              void openTerminal(String(kind));
            }}
          >
            {shells.map((shell) => (
              <DropdownItem key={shell.id}>{shell.name}</DropdownItem>
            ))}
          </DropdownMenu>
        </Dropdown>
        <Dropdown>
          <DropdownTrigger>
            <button className="session-tool" aria-label={t('terminal:workspaceTerminals')}>
              {t('terminal:terminalCount', { count: sessions.length })}
              <Icon name="chevron" width="12" style={{ transform: 'rotate(90deg)' }} />
            </button>
          </DropdownTrigger>
          <DropdownMenu
            aria-label={t('terminal:workspaceTerminals')}
            selectionMode="single"
            selectedKeys={[active]}
            onAction={(key) => {
              const terminal = String(key);
              if (!panes.includes(terminal))
                setPanes((previous) =>
                  previous.map((value) => (value === active ? terminal : value)),
                );
              select(terminal);
            }}
          >
            {sessions.map((session) => (
              <DropdownItem
                key={session.id}
                textValue={`${session.shell} ${session.directory}`}
                description={session.directory}
              >
                {session.shell} · {localDirectoryName(session.directory)}
                {session.ended ? ` · ${t('terminal:sessionExited')}` : ''}
              </DropdownItem>
            ))}
          </DropdownMenu>
        </Dropdown>
        <div className="local-terminal-tools" ref={setToolbar} />
        <Tooltip content={t(maximized ? 'terminal:restorePanes' : 'terminal:maximizePane')}>
          <button
            className="icon-button"
            aria-label={t(maximized ? 'terminal:restorePanes' : 'terminal:maximizePane')}
            aria-pressed={maximized}
            disabled={count === 1}
            onClick={() => setMaximized((value) => !value)}
          >
            <Icon name="focus" width="14" />
          </button>
        </Tooltip>
      </div>
      <ErrorNotice message={error} onDismiss={() => setError('')} />
      <div
        ref={grid}
        className="local-terminal-grid"
        style={{
          gridTemplateColumns: maximized ? 'minmax(0,1fr)' : localGridTracks(columns),
          gridTemplateRows: maximized ? 'minmax(0,1fr)' : localGridTracks(rows),
        }}
      >
        {sessions.map((session) => {
          const index = panes.indexOf(session.id);
          const shown = index >= 0 && (!maximized || session.id === active);
          return (
            <section
              key={session.id}
              data-terminal-id={session.id}
              className={`local-terminal-pane ${active === session.id ? 'focused-pane' : ''} ${dropTarget === session.id ? 'pane-drop-target' : ''}`}
              aria-label={`${session.shell} · ${session.directory}`}
              hidden={!shown}
              style={{
                gridColumn: maximized ? 1 : (index % dimensions.columns) * 2 + 1,
                gridRow: maximized ? 1 : Math.floor(index / dimensions.columns) * 2 + 1,
              }}
              onFocusCapture={() => {
                if (active !== session.id) select(session.id, false);
              }}
              onDragOver={(event) => {
                if (!drag.current || drag.current === session.id) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                setDropTarget(session.id);
              }}
              onDragLeave={() => setDropTarget('')}
              onDrop={(event) => {
                event.preventDefault();
                if (drag.current) exchange(drag.current, session.id);
                drag.current = '';
                setDropTarget('');
              }}
            >
              <div className="local-terminal-pane-header">
                <button
                  className="local-terminal-pane-title"
                  draggable={!busy}
                  aria-label={t('terminal:moveTerminal', {
                    name: localDirectoryName(session.directory),
                  })}
                  title={session.directory}
                  onClick={() => select(session.id)}
                  onDragStart={(event) => {
                    drag.current = session.id;
                    event.dataTransfer.setData(
                      'application/x-termquay-terminal-pane',
                      `${id}:${session.id}`,
                    );
                    event.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragEnd={() => {
                    drag.current = '';
                    setDropTarget('');
                  }}
                  onKeyDown={(event) => {
                    if (!event.key.startsWith('Arrow')) return;
                    const target = panes[localPaneNeighbor(layout, index, event.key.slice(5))];
                    if (!target || target === session.id) return;
                    event.preventDefault();
                    if (event.shiftKey) exchange(session.id, target);
                    else select(target);
                  }}
                >
                  <Icon name="terminal" width="13" />
                  <span>{localDirectoryName(session.directory)}</span>
                  {session.attention && (
                    <span
                      className={`terminal-attention ${session.attention}`}
                      aria-label={commandAttentionLabels[session.attention]}
                      title={commandAttentionLabels[session.attention]}
                    />
                  )}
                  {session.ended && <span>{t('terminal:sessionExited')}</span>}
                </button>
                <button
                  className="icon-button"
                  aria-label={t('terminal:closePane', {
                    name: localDirectoryName(session.directory),
                  })}
                  disabled={busy}
                  onClick={() => closeTerminal(session.id)}
                >
                  <Icon name="close" width="12" />
                </button>
              </div>
              <TerminalView
                local
                id={session.id}
                workspace={session.id}
                ref={session.terminal}
                visible={visible && shown}
                focusOnShow={active === session.id}
                fontSize={fontSize}
                toolbarHost={toolbar}
                showTools={active === session.id}
                onSnippets={onSnippets}
                onDirectory={(path, host) => {
                  const directory = localDirectoryReport(
                    path,
                    host,
                    session.hostname,
                    session.kind,
                  );
                  if (!directory || directory === session.directory) return;
                  const next = { ...session, directory };
                  latest.current = latest.current.map((value) =>
                    value.id === session.id ? { ...value, directory } : value,
                  );
                  setSessions(latest.current);
                  if (active === session.id) callbacks.current.onSelected(next);
                }}
                onAttention={(value) => attention(session.id, value)}
                onActivate={() => {
                  if (!panes.includes(session.id))
                    setPanes((previous) =>
                      previous.map((value) => (value === active ? session.id : value)),
                    );
                  select(session.id);
                  callbacks.current.onActivate();
                }}
                onConnectionChange={() => {
                  latest.current = latest.current.map((value) =>
                    value.id === session.id
                      ? { ...value, ended: session.terminal.current?.ended() }
                      : value,
                  );
                  setSessions(latest.current);
                  callbacks.current.onStateChange();
                }}
              />
            </section>
          );
        })}
        {Array.from(
          { length: count },
          (_, index) =>
            !panes[index] &&
            !maximized && (
              <div
                key={`empty-${index}`}
                className="local-terminal-empty"
                style={{
                  gridColumn: (index % dimensions.columns) * 2 + 1,
                  gridRow: Math.floor(index / dimensions.columns) * 2 + 1,
                }}
              >
                <button
                  className="icon-button"
                  aria-label={t('terminal:newTerminalInWorkspace')}
                  disabled={busy}
                  onClick={() => {
                    void openTerminal(current.kind, index);
                  }}
                >
                  <Icon name="plus" />
                </button>
              </div>
            ),
        )}
        {!maximized &&
          columns.map((value, index) => (
            <div
              key={`column-${index}`}
              className="local-pane-separator"
              style={{ gridColumn: (index + 1) * 2, gridRow: '1 / -1' }}
              onDoubleClick={() => setColumns(equalPaneBoundaries(dimensions.columns))}
            >
              <ResizeHandle
                label={t('terminal:columnDivider', { index: index + 1 })}
                value={value}
                min={(columns[index - 1] ?? 0) + 10}
                max={(columns[index + 1] ?? 100) - 10}
                pixelsPerUnit={Math.max(1, size.width / 100)}
                onChange={(next) =>
                  setColumns((previous) =>
                    previous.map((value, position) => (position === index ? next : value)),
                  )
                }
              />
            </div>
          ))}
        {!maximized &&
          rows.map((value, index) => (
            <div
              key={`row-${index}`}
              className="local-pane-separator horizontal"
              style={{ gridColumn: '1 / -1', gridRow: (index + 1) * 2 }}
              onDoubleClick={() => setRows(equalPaneBoundaries(dimensions.rows))}
            >
              <ResizeHandle
                horizontal
                label={t('terminal:rowDivider', { index: index + 1 })}
                value={value}
                min={(rows[index - 1] ?? 0) + 10}
                max={(rows[index + 1] ?? 100) - 10}
                pixelsPerUnit={Math.max(1, size.height / 100)}
                onChange={(next) =>
                  setRows((previous) =>
                    previous.map((value, position) => (position === index ? next : value)),
                  )
                }
              />
            </div>
          ))}
      </div>
      <Modal isOpen={!!closingSession} onClose={() => setClosing('')} className="app-dialog">
        <ModalContent>
          <ModalHeader>{t('workspaces:confirmCloseLocalTerminals')}</ModalHeader>
          <ModalBody>
            <p>{t('workspaces:closingLocalTerminalsEndsSessions')}</p>
            <ul className="terminal-close-list">
              <li>
                <strong>{closingSession?.shell}</strong>
                <span>{closingSession?.directory}</span>
              </li>
            </ul>
          </ModalBody>
          <ModalFooter>
            <Button
              variant="light"
              onPress={() => {
                setClosing('');
                current.terminal.current?.focus();
              }}
            >
              {t('common:cancel')}
            </Button>
            <Button color="danger" onPress={() => remove(closing)}>
              {t('workspaces:closeTerminal')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
});

export default LocalTerminalWorkspace;
