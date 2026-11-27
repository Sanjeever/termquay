import Modal from '../../components/Modal';
import { useTranslation } from 'react-i18next';
import { connectionStateLabel } from '../../i18n/connectionState';
import { t as translate } from '../../i18n/index.ts';
import { message as uiMessage } from '../../i18n/messages.ts';
import { useMessageState } from '../../i18n/useMessageState.ts';

import Tooltip from '../../components/Tooltip';
import { errorCode, errorMessage, eventError } from '../../lib/errors.ts';
import {
  forwardRef,
  lazy,
  Suspense,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import {
  Button,
  DropdownTrigger,
  DropdownMenu,
  DropdownItem,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from '@heroui/react';
import { Dropdown } from '../../components/Popover';
import { Stream } from '@wailsio/runtime';
import {
  ReadRemoteFileEncoded,
  DownloadFileDraft,
  StartDownload,
  CreateTerminal,
  CloseTerminal,
  WorkspaceRecoveryDrafts,
  CloseWorkspace,
  RegisterWorkspaceView,
  ReleaseWorkspaceView,
  SetWorkspaceDirty,
} from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import SelectControl from '../../components/SelectControl';
import { documentFormat, formatKey, editorEncodings } from './editorFormat';
import type {
  Document,
  Entry,
} from '../../../bindings/github.com/Sanjeever/termquay/internal/files/models';
import TerminalView, { type TerminalAction, type TerminalHandle } from '../terminal/TerminalView';
import FileBrowser from './FileBrowser';
import MonitorPanel from '../monitor/MonitorPanel';
import Icon from '../../components/Icon';
import ErrorNotice from '../../components/ErrorNotice';
import ResizeHandle from '../../components/layout/ResizeHandle';
import WorkspaceToolRail from '../../components/layout/WorkspaceToolRail';
import type {
  RecoveryDraftInput,
  SSHLayout,
} from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import WorkspacePanes, { type PaneColumns } from './WorkspacePanes';
import TunnelPanel from '../tunnels/TunnelPanel';
import PaneTabs from './PaneTabs';
import { shortcutLabel, type Shortcuts } from '../../lib/shortcuts';
import { shellQuote } from '../terminal/shellIntegration';
import useSSHReconnect from '../connections/useSSHReconnect';
import { isImagePath, fileTabContexts } from './fileTypes';
import { ReadSudoFile } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import SudoAuthorizationDialog, { type SudoAuthorization } from './SudoAuthorizationDialog';
import useFileDrafts from './useFileDrafts';
import { CreateTmuxTerminal } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import { isDirty, savedEncoding, fileErrorAction } from './fileDrafts';
import type { CommandAttention } from '../terminal/commandAttention';
import { SetWorkspaceBrowseOnly } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import useAISettings from '../ai/useAISettings';
import { addAIReference } from '../ai/references';
import type { Reference } from '../../../bindings/github.com/Sanjeever/termquay/internal/ai/models';
import { useAppearance } from '../settings/AppearanceProvider';

const TextDocument = lazy(() => import('./TextDocument'));
const ImagePreview = lazy(() => import('./ImagePreview'));
const FileConflictView = lazy(() => import('./FileConflictView'));
const FileHistoryDialog = lazy(() => import('./FileHistoryDialog'));
const RemoteLogDialog = lazy(() => import('./RemoteLogDialog'));
const LinuxInspectionDialog = lazy(() => import('../monitor/LinuxInspectionDialog'));
const AIPanel = lazy(() => import('../ai/AIPanel'));

export type SSHWorkspaceHandle = {
  openResource(kind: string, target: string): Promise<void>;
  sudoEdit(): void;
  workspaceAction(action: 'switchPane' | 'closeContent' | 'newTerminal'): boolean;
  layout(): SSHLayout;
  hasDirty(): boolean;
  recoveryDrafts(): RecoveryDraftInput[] | null;
  insertionTarget(): string;
  insert(text: string, target: string): boolean;
  appendQuickInput(text: string, target: string): boolean;
  focus(): void;
  saveAll(): Promise<boolean>;
  prepareReconnect(): Promise<boolean>;
  showFiles(): void;
  locateDirectory(path: string): void;
  toggleMonitor(): void;
  toggleFocus(): void;
  terminalAction(action: TerminalAction): void;
};

const SSHWorkspace = forwardRef<
  SSHWorkspaceHandle,
  {
    id: string;
    sessionID: string;
    connectionID: string;
    target: string;
    environment: string;
    state: string;
    shortcuts: Shortcuts;
    initialLayout?: SSHLayout;
    visible: boolean;
    fontSize?: number;
    onDirtyChange(dirty: boolean): void;
    onState(state: string): void;
    onStateChange(): void;
    onAttention?(state?: CommandAttention): void;
    onActivate?(): void;
    onReconnect(): void;
    onAutomaticReconnect(): Promise<{ ok: boolean; retryable: boolean }>;
    automaticReconnect: boolean;
    onCancelReconnect(): void;
    onDocker?(): void;
    onTransfers?(directory: string, selected: string[]): void;
    onSnippets(draftTerminal?: string): void;
    busy: boolean;
  }
>(function SSHWorkspace(
  {
    id,
    sessionID,
    connectionID,
    target,
    environment,
    state,
    shortcuts,
    initialLayout,
    visible,
    fontSize = 14,
    onDirtyChange,
    onState,
    onStateChange,
    onAttention,
    onActivate,
    onReconnect,
    onAutomaticReconnect,
    automaticReconnect,
    onCancelReconnect,
    onDocker,
    onTransfers,
    onSnippets,
    busy,
  },
  ref,
) {
  useTranslation();
  const reconnect = useSSHReconnect(
    sessionID,
    state,
    busy,
    onAutomaticReconnect,
    automaticReconnect,
  );
  let terminalIndex = 0;
  const initialIDs = (initialLayout?.tabs || []).map((tab, index) =>
    tab.kind === 'file'
      ? tab.path
      : terminalIndex++ === 0
        ? sessionID
        : `restore-terminal-${index}`,
  );
  const [error, setError] = useMessageState('');
  const disposed = useRef(false);
  const instance = useRef(sessionID);
  instance.current = sessionID;
  const [browseOnly, setBrowseOnly] = useState(false);
  const [changingMode, setChangingMode] = useState(false);
  const {
    drafts,
    draftsRef,
    updateDrafts,
    reads,
    saves,
    save: saveFile,
    rereading,
    setRereading,
    requestReload,
    reread,
  } = useFileDrafts({ sessionID, disposed, instance, authorizeSudo, setError });
  const [downloadErrors, setDownloadErrors] = useState<Record<string, unknown>>({});
  useEffect(() => setDownloadErrors({}), [sessionID]);
  function clearDownloadError(path: string) {
    setDownloadErrors((previous) => {
      const next = { ...previous };
      delete next[path];
      return next;
    });
  }
  async function save(path: string) {
    if (browseOnly) {
      setError(uiMessage('files:theWorkspaceIsInFileBrowsingModeAllow'));
      return false;
    }
    return saveFile(path);
  }
  async function downloadDraft(path: string) {
    const draft = draftsRef.current.find((item) => item.path === path);
    if (!draft) return;
    try {
      await DownloadFileDraft({ ...draft, ...documentFormat(draft) });
      if (!disposed.current && instance.current === sessionID) clearDownloadError(path);
    } catch (error) {
      if (!disposed.current && instance.current === sessionID)
        setDownloadErrors((previous) => ({ ...previous, [path]: error }));
    }
  }
  async function toggleBrowseOnly() {
    setChangingMode(true);
    setError('');
    try {
      await SetWorkspaceBrowseOnly(sessionID, !browseOnly);
      setBrowseOnly(!browseOnly);
    } catch (e) {
      setError(e);
    } finally {
      setChangingMode(false);
    }
  }
  /* oxlint-disable react/exhaustive-deps -- Reapply the current browsing mode on reconnect; explicit mode changes already update the backend. */
  useEffect(() => {
    if (browseOnly) SetWorkspaceBrowseOnly(sessionID, true).catch((e) => setError(e));
  }, [sessionID, setError]);
  /* oxlint-enable react/exhaustive-deps */
  const [selection, setSelection] = useState<string[]>(() =>
    initialLayout
      ? [0, 1, 2, 3].map(
          (pane) =>
            initialIDs[
              pane < 2
                ? initialLayout.selected[pane]
                : (initialLayout.split_columns?.selected?.[pane - 2] ?? -1)
            ] || '',
        )
      : [sessionID, '', '', ''],
  );
  const [activePane, setActivePane] = useState(initialLayout?.active_pane || 0);
  const [paneAssignments, setPaneAssignments] = useState<Record<string, number>>(() =>
    Object.fromEntries(
      (initialLayout?.tabs || []).map((tab, index) => [initialIDs[index], tab.pane]),
    ),
  );
  const [split, setSplit] = useState(initialLayout?.split || false);
  const [splitDirection, setSplitDirection] = useState<'rows' | 'columns'>(
    initialLayout ? (initialLayout.split_direction === 'rows' ? 'rows' : 'columns') : 'rows',
  );
  const [splitColumns, setSplitColumns] = useState<PaneColumns | undefined>(() => {
    const mode = initialLayout?.split_columns?.mode;
    return mode === 'bottom' || mode === 'grid' ? mode : undefined;
  });
  const [columnRatio, setColumnRatio] = useState(initialLayout?.split_columns?.ratio ?? 50);
  const automaticSplit = useRef(!initialLayout);
  const [maximized, setMaximized] = useState(initialLayout?.maximized || false);
  const [ratio, setRatio] = useState(initialLayout?.ratio || 50);
  const [terminals, setTerminals] = useState<string[]>(
    !initialLayout || initialLayout.tabs?.some((t) => t.kind === 'terminal') ? [sessionID] : [],
  );
  const [attention, setAttention] = useState<Record<string, CommandAttention | undefined>>({});
  useEffect(() => {
    setAttention((previous) =>
      Object.keys(previous).every((id) => terminals.includes(id))
        ? previous
        : Object.fromEntries(Object.entries(previous).filter(([id]) => terminals.includes(id))),
    );
  }, [terminals]);
  const attentionCallback = useRef(onAttention);
  attentionCallback.current = onAttention;
  useEffect(() => {
    const states = terminals.map((id) => attention[id]);
    attentionCallback.current?.(
      states.includes('failed')
        ? 'failed'
        : states.includes('running')
          ? 'running'
          : states.includes('completed')
            ? 'completed'
            : undefined,
    );
  }, [attention, terminals]);
  const [tmuxBindings, setTmuxBindings] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      (initialLayout?.tabs || []).flatMap((tab, index) =>
        tab.tmux_session ? [[initialIDs[index], tab.tmux_session]] : [],
      ),
    ),
  );
  const tmuxAttached = useRef(new Set<string>());
  const tmuxRequest = useRef<ReturnType<typeof CreateTmuxTerminal>>();
  const [fileOrder, setFileOrder] = useState(
    (initialLayout?.tabs || []).filter((t) => t.kind === 'file').map((t) => t.path),
  );
  const [fileViews, setFileViews] = useState<Record<string, 'text' | 'image'>>({});
  const [markdownAnchor, setMarkdownAnchor] = useState<{
    path: string;
    hash: string;
    sequence: number;
  }>();
  const [restoring, setRestoring] = useState(!!initialLayout);
  const [restoreReady, setRestoreReady] = useState(!initialLayout);
  const [restoreEpoch, setRestoreEpoch] = useState(0);
  const [pendingErrors, setPendingErrors] = useState<
    Record<string, { message: unknown; code: string; encoding: string }>
  >({});
  const restoreApplied = useRef(!initialLayout);
  const terminalOwners = useRef(new Map([[sessionID, sessionID]]));
  const [directory, setDirectory] = useState(initialLayout?.directory || '');
  const [followDirectory, setFollowDirectory] = useState(false);
  const [directoryRequest, setDirectoryRequest] = useState<{
    path: string;
    sequence: number;
    locate?: boolean;
  }>();
  const [fileJump, setFileJump] = useState<{ path: string; line: number; sequence: number }>();
  const terminalDirectories = useRef(new Map<string, string>());
  const [directorySetups, setDirectorySetups] = useState<
    Record<string, 'waiting' | 'inserted' | 'ready'>
  >({});
  const [preparing, setPreparing] = useState(false);
  const [tunnelsOpen, setTunnelsOpen] = useState(false);
  const [tunnelsWidth, setTunnelsWidth] = useState(360);
  const [tunnelCount, setTunnelCount] = useState(0);
  const [closing, setClosing] = useState('');
  const [conflict, applyConflict] = useState('');
  const [sudoPrompt, setSudoPrompt] = useState<{
    path: string;
    encoding: string;
    operation: 'open' | 'read' | 'save';
  }>();
  const sudoAnswer = useRef<(value?: SudoAuthorization) => void>();
  const [sudoConflict, setSudoConflict] = useState<Document>();
  const [historyRequest, setHistoryRequest] = useState<{
    path: string;
    owner: string;
    validate: boolean;
  }>();
  const [resourceLog, setResourceLog] = useState('');
  const [resourceService, setResourceService] = useState('');
  async function openResource(kind: string, path: string) {
    if (state !== 'connected') throw uiMessage('files:sSHWorkspaceIsNotConnectedYet');
    if (kind === 'file') await openPath(path);
    else if (kind === 'directory') {
      showFiles();
      setDirectoryRequest((previous) => ({
        path,
        sequence: (previous?.sequence || 0) + 1,
        locate: true,
      }));
    } else if (kind === 'log') setResourceLog(path);
    else if (kind === 'service') setResourceService(path);
  }
  function authorizeSudo(path: string, encoding: string, operation: 'open' | 'read' | 'save') {
    if (sudoAnswer.current) return Promise.resolve(undefined);
    return new Promise<SudoAuthorization | undefined>((resolve) => {
      sudoAnswer.current = resolve;
      setSudoPrompt({ path, encoding, operation });
    });
  }
  function answerSudo(value?: SudoAuthorization) {
    const answer = sudoAnswer.current;
    sudoAnswer.current = undefined;
    setSudoPrompt(undefined);
    answer?.(value);
  }
  useEffect(() => {
    setSudoPrompt(undefined);
    return () => {
      sudoAnswer.current?.();
      sudoAnswer.current = undefined;
    };
  }, [sessionID]);
  async function setConflict(path: string) {
    if (!path) {
      applyConflict('');
      setSudoConflict(undefined);
      return;
    }
    const draft = draftsRef.current.find((d) => d.path === path);
    if (draft?.sudo) {
      const authorization = await authorizeSudo(path, savedEncoding(draft), 'read');
      if (!authorization || disposed.current || instance.current !== sessionID) return;
      const request = ReadSudoFile(sessionID, path, authorization.encoding, authorization.password);
      reads.current.set(path, request);
      try {
        const doc = await request;
        if (
          !disposed.current &&
          instance.current === sessionID &&
          reads.current.get(path) === request
        ) {
          setSudoConflict(doc);
          applyConflict(path);
        }
      } catch (e) {
        if (!disposed.current) setError(e);
      } finally {
        if (reads.current.get(path) === request) reads.current.delete(path);
      }
    } else {
      setSudoConflict(undefined);
      applyConflict(path);
    }
  }
  async function openSudo(path = active && !terminals.includes(active) ? active : directory + '/') {
    if (restoring || !restoreReady || state !== 'connected') return;
    const authorization = await authorizeSudo(path, 'UTF-8', 'open');
    if (!authorization || disposed.current || instance.current !== sessionID) return;
    path = authorization.path;
    if (reads.current.has(path) || saves.current.has(path)) return;
    if (!fileOrder.includes(path) && new Set([...fileOrder, ...reads.current.keys()]).size >= 64) {
      setError(uiMessage('files:openFileLimitReached64'));
      return;
    }
    const request = ReadSudoFile(sessionID, path, authorization.encoding, authorization.password);
    reads.current.set(path, request);
    try {
      const doc = await request;
      if (disposed.current || instance.current !== sessionID || reads.current.get(path) !== request)
        return;
      const existing = draftsRef.current.find((d) => d.path === path);
      const needsReview = !!existing && isDirty(existing);
      updateDrafts((previous) => [
        ...previous.filter((d) => d.path !== path),
        {
          ...doc,
          ...(needsReview ? { content: existing!.content, ...documentFormat(existing!) } : {}),
          sudo: true,
          saved: doc.content,
          savedFormat: formatKey(doc),
          needsReview,
          saving: false,
          error: needsReview ? translate('files:compareAndMergeFirst') : '',
        },
      ]);
      setFileViews((previous) => ({ ...previous, [path]: 'text' }));
      setPendingErrors((previous) => {
        const next = { ...previous };
        delete next[path];
        return next;
      });
      setFileOrder((previous) => (previous.includes(path) ? previous : [...previous, path]));
      setActive(path);
      if (needsReview) {
        setSudoConflict(doc);
        applyConflict(path);
      }
    } catch (e) {
      if (!disposed.current) setError(e);
    } finally {
      if (reads.current.get(path) === request) reads.current.delete(path);
    }
  }
  const [creating, setCreating] = useState(false);
  const [filesOpen, setFilesOpen] = useState(initialLayout?.files_open ?? false);
  const [filesWidth, setFilesWidth] = useState(
    initialLayout?.files_width ??
      Math.max(
        200,
        Math.min(
          420,
          Number(
            localStorage.getItem('termquay.layout.files-width') ||
              localStorage.getItem('termquay.layout.sidebar-width'),
          ) || 248,
        ),
      ),
  );
  const { appearance } = useAppearance();
  const compact = appearance.compactSSH;
  const [monitorOpen, setMonitorOpen] = useState(initialLayout?.monitor_open ?? false);
  const aiSettings = useAISettings();
  const aiEnabled = !!aiSettings.settings?.enabled && !aiSettings.locked;
  const [aiOpen, setAIOpen] = useState(false);
  const [aiVisited, setAIVisited] = useState(false);
  const [aiReferences, setAIReferences] = useState<Reference[]>([]);
  const aiReferencesRef = useRef(aiReferences);
  aiReferencesRef.current = aiReferences;
  useEffect(() => {
    setAIReferences([]);
    aiReferencesRef.current = [];
  }, [sessionID]);
  const [aiWidth, setAIWidth] = useState(() =>
    Math.max(300, Math.min(600, Number(localStorage.getItem('termquay.layout.ai-width')) || 380)),
  );
  const [focus, setFocus] = useState(initialLayout?.focus || false);
  const [narrow, setNarrow] = useState(window.innerWidth <= 1100);
  const [narrowPanel, setNarrowPanel] = useState<'files' | 'monitor' | 'ai' | 'tunnels' | null>(
    null,
  );
  const previousInstance = useRef(sessionID);
  const viewReady = useRef<Promise<void>>();
  const currentDirty = useRef(false);
  const center = useRef<HTMLDivElement>(null);
  const terminalHandles = useRef(new Map<string, TerminalHandle>());
  const filesToggle = useRef<HTMLButtonElement>(null);
  const monitorToggle = useRef<HTMLButtonElement>(null);
  const aiToggle = useRef<HTMLButtonElement>(null);
  const tunnelsToggle = useRef<HTMLButtonElement>(null);
  const dirtyCallback = useRef(onDirtyChange);
  dirtyCallback.current = onDirtyChange;
  const stateCallback = useRef(onState);
  stateCallback.current = onState;
  const changeCallback = useRef(onStateChange);
  changeCallback.current = onStateChange;
  useEffect(() => {
    changeCallback.current();
  }, [
    drafts,
    terminals,
    tmuxBindings,
    fileOrder,
    paneAssignments,
    selection,
    activePane,
    split,
    splitDirection,
    splitColumns,
    columnRatio,
    maximized,
    ratio,
    directory,
    filesOpen,
    filesWidth,
    monitorOpen,
    focus,
    restoreReady,
    restoring,
  ]);
  const dirty = drafts.some((d) => isDirty(d));
  currentDirty.current = dirty;
  const filesShown = !focus && (narrow ? narrowPanel === 'files' : filesOpen);
  const tunnelsShown = !focus && (narrow ? narrowPanel === 'tunnels' : tunnelsOpen);
  const aiShown = !tunnelsShown && aiEnabled && !focus && (narrow ? narrowPanel === 'ai' : aiOpen);
  const monitorShown =
    !tunnelsShown && !aiShown && !focus && (narrow ? narrowPanel === 'monitor' : monitorOpen);
  const tabIDs = [...terminals, ...fileOrder];
  const paneCount = splitColumns === 'grid' ? 4 : splitColumns === 'bottom' ? 3 : split ? 2 : 1;
  const paneFor = (path: string) => (split ? paneAssignments[path] || 0 : 0);
  const paneSelected = selection.map((path, pane) =>
    tabIDs.includes(path) && paneFor(path) === pane
      ? path
      : tabIDs.find((t) => paneFor(t) === pane) || '',
  );
  useEffect(() => {
    const live = new Set(terminals);
    for (const key of terminalOwners.current.keys())
      if (!live.has(key)) terminalOwners.current.delete(key);
    for (const key of terminalDirectories.current.keys())
      if (!live.has(key)) terminalDirectories.current.delete(key);
    setDirectorySetups((previous) =>
      Object.fromEntries(Object.entries(previous).filter(([key]) => live.has(key))),
    );
    if (!restoring)
      setPaneAssignments((previous) => {
        const ids = Object.keys(previous);
        const next = ids.filter((path) => live.has(path) || fileOrder.includes(path));
        return next.length === ids.length
          ? previous
          : Object.fromEntries(next.map((path) => [path, previous[path]]));
      });
  }, [terminals, fileOrder, restoring]);
  const active = paneSelected[activePane] || '';
  const activeTerminal =
    state === 'connected' &&
    terminals.includes(active) &&
    terminalOwners.current.get(active) === sessionID &&
    !terminalHandles.current.get(active)?.ended();
  const directoryFollowStatus = !activeTerminal ? 'inactive' : directorySetups[active] || 'waiting';
  useEffect(() => {
    const path = terminalDirectories.current.get(active);
    if (
      followDirectory &&
      path &&
      state === 'connected' &&
      terminalOwners.current.get(active) === sessionID
    )
      setDirectoryRequest((previous) => ({ path, sequence: (previous?.sequence || 0) + 1 }));
  }, [active, followDirectory, sessionID, state]);
  function terminalDirectoryStatus(terminal: string, status: 'waiting' | 'inserted') {
    terminalDirectories.current.delete(terminal);
    setDirectorySetups((previous) =>
      previous[terminal] === status ? previous : { ...previous, [terminal]: status },
    );
  }
  function terminalDirectory(terminal: string, path: string, host: string) {
    const targetHost = target
      .slice(target.lastIndexOf('@') + 1, target.lastIndexOf(':'))
      .replace(/^\[|\]$/g, '')
      .toLowerCase();
    if (host && host.replace(/^\[|\]$/g, '').toLowerCase() !== targetHost) {
      terminalDirectoryStatus(terminal, 'waiting');
      return;
    }
    if (state !== 'connected' || terminalOwners.current.get(terminal) !== sessionID) return;
    terminalDirectories.current.set(terminal, path);
    setDirectorySetups((previous) =>
      previous[terminal] === 'ready' ? previous : { ...previous, [terminal]: 'ready' },
    );
    if (followDirectory && terminal === active && directory !== path)
      setDirectoryRequest((previous) => ({ path, sequence: (previous?.sequence || 0) + 1 }));
  }
  function locateInTerminal(path: string) {
    const terminal = terminals.includes(active)
      ? active
      : terminals.find(
          (value) =>
            terminalOwners.current.get(value) === sessionID &&
            !terminalHandles.current.get(value)?.ended(),
        );
    if (!terminal) {
      setError(uiMessage('files:openAnInteractiveTerminalFirst'));
      return;
    }
    setActive(terminal);
    terminalHandles.current.get(terminal)?.insert(`cd -- ${shellQuote(path)}`);
    requestAnimationFrame(() => focusTab(terminal));
  }
  async function openTerminalFile(path: string, line: number) {
    try {
      setFileJump({ path, line, sequence: Date.now() });
      await openPath(path);
    } catch (e) {
      setError(e);
    }
  }
  const firstPopulatedPane = paneSelected.findIndex(Boolean);
  useEffect(() => {
    if (!active && firstPopulatedPane >= 0) setActivePane(firstPopulatedPane);
  }, [active, firstPopulatedPane]);
  function selectInPane(pane: number, path: string) {
    setSelection((previous) => previous.map((value, index) => (index === pane ? path : value)));
    setActivePane(pane);
  }
  function assignToPane(path: string, pane: number) {
    setPaneAssignments((previous) => ({ ...previous, [path]: pane }));
  }
  function setActive(path: string) {
    if (
      !split &&
      automaticSplit.current &&
      splitDirection === 'rows' &&
      !terminals.includes(path) &&
      terminals.length
    ) {
      setSplit(true);
      setPaneAssignments(Object.fromEntries(terminals.map((id) => [id, 1])));
      setSelection([path, terminals[0], '', '']);
      setActivePane(0);
      return;
    }
    selectInPane(paneFor(path), path);
  }
  function shown(path: string) {
    return path === paneSelected[paneFor(path)] && (!maximized || paneFor(path) === activePane);
  }
  function panePosition(pane: number, tabs = false) {
    if (splitColumns && !maximized) {
      const bottom = splitColumns === 'bottom' ? pane > 0 : pane > 1;
      const right = splitColumns === 'bottom' ? pane === 2 : pane % 2 === 1;
      return {
        gridColumn: splitColumns === 'bottom' && !bottom ? '1 / -1' : right ? 3 : 1,
        gridRow: (bottom ? 4 : 1) + (tabs ? 0 : 1),
      };
    }
    const stacked = split && !maximized && splitDirection === 'rows';
    return {
      gridColumn: maximized || pane === 0 || stacked ? 1 : 3,
      gridRow: stacked && pane === 1 ? (tabs ? 4 : 5) : tabs ? 1 : 2,
    };
  }
  function imageFile(path: string) {
    return fileViews[path] ? fileViews[path] === 'image' : isImagePath(path);
  }
  function focusTab(path = active) {
    if (document.querySelector('[role=dialog][data-open=true]')) return;
    const selector = `[data-tab-id="${CSS.escape(path)}"]`;
    Array.from(
      center.current?.querySelectorAll<HTMLElement>(
        `${selector} .terminal-search > input, ${selector} .xterm-helper-textarea, ${selector} .cm-content, ${selector} [data-image-preview], ${selector} [data-markdown-preview]`,
      ) || [],
    )
      .find((element) => element.getClientRects().length > 0)
      ?.focus();
  }
  function moveActive() {
    if (!active) return;
    const target = (paneFor(active) + 1) % Math.max(2, paneCount);
    setSplit(true);
    setMaximized(false);
    assignToPane(active, target);
    selectInPane(target, active);
    requestAnimationFrame(() => focusTab(active));
  }
  function applyColumns(mode: PaneColumns) {
    if (splitColumns === mode) return;
    const ordered = [...new Set([...paneSelected.filter(Boolean), ...tabIDs])];
    const nextPanes: Record<string, number> = {};
    const nextSelection = ['', '', '', ''];
    let terminalCount = 0;
    ordered.forEach((path, index) => {
      const pane =
        mode === 'grid'
          ? Math.min(3, index)
          : terminals.includes(path)
            ? Math.min(2, ++terminalCount)
            : 0;
      nextPanes[path] = pane;
      if (!nextSelection[pane] || path === active) nextSelection[pane] = path;
    });
    setPaneAssignments(nextPanes);
    setSelection(nextSelection);
    setActivePane(nextPanes[active] || 0);
    setSplit(true);
    setSplitDirection('rows');
    setSplitColumns(mode);
    setMaximized(false);
  }
  function applyTwoPanes(direction: 'rows' | 'columns') {
    if (!split) {
      setPaneAssignments(Object.fromEntries(terminals.map((id) => [id, 1])));
      setSelection([fileOrder[0] || '', terminals[0] || '', '', '']);
      setActivePane(fileOrder.length ? 0 : 1);
    } else if (splitColumns) {
      setPaneAssignments(
        Object.fromEntries(tabIDs.map((path) => [path, Math.min(1, paneFor(path))])),
      );
      setSelection([paneSelected[0], activePane > 0 ? active : paneSelected[1], '', '']);
      setActivePane(Math.min(1, activePane));
    }
    setSplit(true);
    setSplitDirection(direction);
    setSplitColumns(undefined);
    setMaximized(false);
  }
  async function newTerminal(
    pane = split && splitDirection === 'rows' && !splitColumns ? 1 : activePane,
    direction?: 'rows' | 'columns',
    columns?: PaneColumns,
  ) {
    if (state !== 'connected' || creating || restoring || terminals.length >= 16) return;
    setCreating(true);
    try {
      const result = await CreateTerminal(sessionID);
      if (disposed.current || instance.current !== sessionID) {
        CloseTerminal(result.id);
        return;
      }
      terminalOwners.current.set(result.id, sessionID);
      setTerminals((prev) => [...prev, result.id]);
      if (pane > 0) {
        if (direction) {
          automaticSplit.current = false;
          setSplitDirection(direction);
        }
        if (columns) setSplitColumns(columns);
        setSplit(true);
        assignToPane(result.id, pane);
      }
      selectInPane(pane, result.id);
      setMaximized(false);
    } catch (e) {
      setError(e);
    } finally {
      setCreating(false);
    }
  }
  async function attachTmux(name: string, source: string) {
    if (creating || restoring || state !== 'connected' || terminals.length >= 16) {
      setError(uiMessage('files:finishConnectingOrRestoringOrCloseExcessTerminals'));
      return false;
    }
    setCreating(true);
    setError('');
    const request = CreateTmuxTerminal(sessionID, name);
    tmuxRequest.current = request;
    try {
      const result = await request;
      if (disposed.current || instance.current !== sessionID) {
        await CloseTerminal(result.id);
        return false;
      }
      terminalOwners.current.set(result.id, sessionID);
      tmuxAttached.current.add(result.id);
      const placeholder = !!tmuxBindings[source] && !tmuxAttached.current.has(source);
      setTmuxBindings((previous) => {
        const next = { ...previous, [result.id]: name };
        delete next[source];
        return next;
      });
      setTerminals((previous) => [
        ...previous.filter((terminal) => !placeholder || terminal !== source),
        result.id,
      ]);
      const pane = paneFor(source);
      assignToPane(result.id, pane);
      selectInPane(pane, result.id);
      setMaximized(false);
      return true;
    } catch (e) {
      if (!disposed.current && instance.current === sessionID) setError(e);
      return false;
    } finally {
      if (tmuxRequest.current === request) tmuxRequest.current = undefined;
      setCreating(false);
    }
  }
  function unbindTmux(terminal: string) {
    setTmuxBindings((previous) => {
      const next = { ...previous };
      delete next[terminal];
      return next;
    });
  }
  function layout(): SSHLayout {
    if (restoring && initialLayout) return initialLayout;
    const live = terminals
      .filter(
        (t) =>
          tmuxBindings[t] ||
          (terminalOwners.current.get(t) === sessionID && !terminalHandles.current.get(t)?.ended()),
      )
      .slice(-8);
    const ordered = [...live, ...fileOrder];
    return {
      tabs: ordered.map((path) => ({
        kind: live.includes(path) ? 'terminal' : 'file',
        path: live.includes(path) ? '' : path,
        pane: paneFor(path),
        ...(live.includes(path) && tmuxBindings[path] ? { tmux_session: tmuxBindings[path] } : {}),
      })),
      selected: [ordered.indexOf(paneSelected[0]), ordered.indexOf(paneSelected[1])],
      active_pane: activePane,
      split,
      split_direction: splitDirection,
      ...(splitColumns
        ? {
            split_columns: {
              mode: splitColumns,
              ratio: columnRatio,
              selected: paneSelected.slice(2, paneCount).map((path) => ordered.indexOf(path)),
            },
          }
        : {}),
      maximized,
      ratio,
      directory,
      files_open: filesOpen,
      files_width: Math.round(filesWidth),
      monitor_open: monitorOpen,
      focus,
    };
  }

  function showFiles() {
    setFocus(false);
    if (narrow) setNarrowPanel('files');
    else setFilesOpen(true);
  }
  function toggleFiles() {
    setFocus(false);
    if (narrow) setNarrowPanel((prev) => (prev === 'files' ? null : 'files'));
    else setFilesOpen((prev) => !prev);
  }
  function toggleMonitor() {
    setFocus(false);
    setTunnelsOpen(false);
    if (aiShown || tunnelsShown) {
      setAIOpen(false);
      setMonitorOpen(true);
      if (narrow) setNarrowPanel('monitor');
    } else if (narrow) setNarrowPanel((prev) => (prev === 'monitor' ? null : 'monitor'));
    else setMonitorOpen((prev) => !prev);
  }
  function toggleAI() {
    setFocus(false);
    setTunnelsOpen(false);
    setAIVisited(true);
    if (narrow) setNarrowPanel((previous) => (previous === 'ai' ? null : 'ai'));
    else setAIOpen((previous) => !previous);
  }
  function closeAI() {
    setAIOpen(false);
    if (narrow) setNarrowPanel(null);
    aiToggle.current?.focus();
  }
  function toggleTunnels() {
    setFocus(false);
    setAIOpen(false);
    setMonitorOpen(false);
    if (narrow) setNarrowPanel((previous) => (previous === 'tunnels' ? null : 'tunnels'));
    else setTunnelsOpen((previous) => !previous);
  }
  function closeTunnels() {
    setTunnelsOpen(false);
    if (narrow) setNarrowPanel(null);
    tunnelsToggle.current?.focus();
  }
  function queueAIReference(reference: Reference) {
    try {
      const next = addAIReference(
        aiReferencesRef.current,
        {
          ...reference,
          label: translate('files:terminal', { value1: terminals.indexOf(reference.terminal) + 1 }),
        },
        sessionID,
      );
      aiReferencesRef.current = next;
      setAIReferences(next);
      setFocus(false);
      setAIVisited(true);
      setTunnelsOpen(false);
      setAIOpen(true);
      if (narrow) setNarrowPanel('ai');
    } catch (e) {
      setError(e);
    }
  }
  function focusPanelToggle(panel: 'files' | 'monitor' | 'ai' | 'tunnels' | null) {
    (panel === 'files'
      ? filesToggle
      : panel === 'ai'
        ? aiToggle
        : panel === 'tunnels'
          ? tunnelsToggle
          : monitorToggle
    ).current?.focus();
  }
  useEffect(() => {
    localStorage.setItem('termquay.layout.ai-width', String(aiWidth));
  }, [aiWidth]);
  useEffect(() => {
    localStorage.setItem('termquay.layout.files-width', String(filesWidth));
  }, [filesWidth]);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 1100px)');
    const update = () => {
      const active = document.activeElement;
      const expanded = center.current?.parentElement?.querySelector(
        '.monitor-dock-expanded:not([hidden])',
      );
      const panel = active?.closest('.file-dock')
        ? 'files'
        : active?.closest('.monitor-dock')
          ? 'monitor'
          : active?.closest('.ai-dock')
            ? 'ai'
            : active?.closest('.tunnel-dock')
              ? 'tunnels'
              : expanded
                ? 'monitor'
                : null;
      setNarrow(media.matches);
      if (media.matches) setNarrowPanel(panel);
      else {
        if (narrowPanel === 'files') setFilesOpen(true);
        if (narrowPanel === 'monitor') {
          setAIOpen(false);
          setMonitorOpen(true);
        }
        if (narrowPanel === 'ai') setAIOpen(true);
        if (narrowPanel === 'tunnels') setTunnelsOpen(true);
        setNarrowPanel(null);
      }
    };
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [narrowPanel]);

  useEffect(() => {
    disposed.current = false;
    viewReady.current = RegisterWorkspaceView(id);
    viewReady.current
      .then(() => {
        if (disposed.current) ReleaseWorkspaceView(id);
      })
      .catch((e) => {
        if (!disposed.current) setError(e);
      });
    return () => {
      disposed.current = true;
      ReleaseWorkspaceView(id).catch(() => {});
    };
  }, [id, setError]);
  /* oxlint-disable react/exhaustive-deps -- The SSH instance owns this stream and outstanding reads; draft and selection changes must not reconnect it. */
  useEffect(() => {
    let ended = false;
    const owner = Stream('workspace');
    owner.onopen = () => {
      if (ended) return;
      owner.send(new TextEncoder().encode(sessionID));
      stateCallback.current('connected');
    };
    owner.onclose = () => {
      if (!ended) stateCallback.current('disconnected');
    };
    if (previousInstance.current !== sessionID) {
      previousInstance.current = sessionID;
      terminalOwners.current.set(sessionID, sessionID);
      setTerminals((prev) => [...prev, sessionID].slice(-16));
      setActive(sessionID);
      updateDrafts((prev) =>
        prev.map((d) => ({
          ...d,
          needsReview: true,
          error: uiMessage('files:connectionUpdatedCheckingRemoteVersion'),
        })),
      );
      void (async () => {
        for (const draft of draftsRef.current) {
          if (ended) return;
          const request = ReadRemoteFileEncoded(sessionID, draft.path, savedEncoding(draft));
          reads.current.set(draft.path, request);
          try {
            const current = await request;
            if (ended) return;
            updateDrafts((prev) =>
              prev.map((d) =>
                d.path === draft.path
                  ? d.recovery
                    ? {
                        ...d,
                        saved: current.content,
                        savedFormat: formatKey(current),
                        revision: current.revision,
                        needsReview: true,
                        error: uiMessage('files:recoveredDraftCompareAndMergeFirst'),
                      }
                    : current.content === d.saved &&
                        (!d.savedFormat || formatKey(current) === d.savedFormat)
                      ? { ...d, revision: current.revision, needsReview: false, error: '' }
                      : {
                          ...d,
                          needsReview: true,
                          error: uiMessage('files:remoteContentChangedCompareAndMergeOrReload'),
                        }
                  : d,
              ),
            );
          } catch (e) {
            if (!ended)
              updateDrafts((prev) =>
                prev.map((d) =>
                  d.path === draft.path ? { ...d, needsReview: true, error: e } : d,
                ),
              );
          } finally {
            if (reads.current.get(draft.path) === request) reads.current.delete(draft.path);
          }
        }
      })();
    }
    return () => {
      ended = true;
      tmuxRequest.current?.cancel();
      for (const read of reads.current.values()) read.cancel();
      reads.current.clear();
      owner.close();
      CloseWorkspace(sessionID).catch(() => {});
    };
  }, [sessionID]);
  /* oxlint-enable react/exhaustive-deps */
  /* oxlint-disable react/exhaustive-deps -- Restore the initial layout once per SSH instance or explicit retry, without restarting when drafts change. */
  useEffect(() => {
    if (!initialLayout || restoreApplied.current) return;
    restoreApplied.current = true;
    setRestoring(true);
    let stopped = false;
    const bodyRequest = WorkspaceRecoveryDrafts(id);
    void (async () => {
      try {
        const bodies = await bodyRequest;
        if (stopped) return;
        const paths = [
          ...new Set([
            ...(initialLayout.tabs || []).filter((t) => t.kind === 'file').map((t) => t.path),
            ...(bodies || []).map((d) => d.path),
          ]),
        ];
        if (paths.length > 64) throw uiMessage('files:moreThan64RecoveryFilesReviewOrClear');
        setFileOrder(paths);
        updateDrafts((prev) => [
          ...prev,
          ...(bodies || [])
            .filter((d) => !prev.some((old) => old.path === d.path))
            .map((d) => ({
              path: d.path,
              content: d.content,
              encoding: d.encoding,
              line_ending: d.line_ending,
              bom: d.bom,
              revision: '',
              saved: '',
              saving: false,
              error: uiMessage('files:recoveredDraftCompareWithLatestRemoteContentAfter'),
              needsReview: true,
              recovery: true,
            })),
        ]);
        setFileViews((previous) => ({
          ...previous,
          ...Object.fromEntries((bodies || []).map((body) => [body.path, 'text' as const])),
        }));
        setRestoreReady(true);
        const planned = (initialLayout.tabs || [])
          .map((tab, index) => ({ tab, key: initialIDs[index] }))
          .filter((t) => t.tab.kind === 'terminal');
        if (!planned.length) await CloseTerminal(sessionID);
        if (planned[0]?.tab.tmux_session) await CloseTerminal(sessionID);
        for (let index = 1; index < planned.length; index++) {
          if (planned[index].tab.tmux_session) {
            setTerminals((previous) => [...previous, planned[index].key]);
            continue;
          }
          try {
            const result = await CreateTerminal(sessionID);
            if (stopped) {
              CloseTerminal(result.id);
              return;
            }
            terminalOwners.current.set(result.id, sessionID);
            setTerminals((prev) => [...prev, result.id]);
            const old = planned[index].key;
            assignToPane(result.id, planned[index].tab.pane);
            setSelection((prev) => prev.map((id) => (id === old ? result.id : id)));
          } catch (e) {
            if (!stopped)
              setError(uiMessage('files:someTerminalsCouldNotBeRestored', { value1: e }));
            break;
          }
        }
        for (const path of paths) {
          if (stopped) return;
          if (isImagePath(path) && !bodies?.some((body) => body.path === path)) continue;
          const encoding = draftsRef.current.find((d) => d.path === path)?.encoding || 'UTF-8';
          const request = ReadRemoteFileEncoded(sessionID, path, encoding);
          reads.current.set(path, request);
          try {
            const doc = await request;
            if (stopped || reads.current.get(path) !== request) return;
            updateDrafts((prev) => {
              const old = prev.find((d) => d.path === path);
              return old
                ? prev.map((d) =>
                    d.path === path
                      ? {
                          ...d,
                          revision: doc.revision,
                          saved: doc.content,
                          savedFormat: formatKey(doc),
                          needsReview: !!d.recovery,
                          error: d.recovery
                            ? uiMessage('files:recoveredDraftCompareAndMergeFirst')
                            : '',
                          saving: false,
                        }
                      : d,
                  )
                : [
                    ...prev,
                    {
                      ...doc,
                      saved: doc.content,
                      savedFormat: formatKey(doc),
                      error: '',
                      saving: false,
                    },
                  ];
            });
          } catch (e) {
            if (stopped || reads.current.get(path) !== request) return;
            setPendingErrors((prev) => ({
              ...prev,
              [path]: { message: e, code: errorCode(e), encoding },
            }));
            updateDrafts((prev) =>
              prev.map((d) => (d.path === path ? { ...d, error: e, needsReview: true } : d)),
            );
          } finally {
            if (reads.current.get(path) === request) reads.current.delete(path);
          }
        }
        if (!stopped) {
          setActivePane(initialLayout.active_pane);
          const first = (bodies || [])[0];
          if (first) {
            setActive(first.path);
            setConflict(first.path);
          }
        }
      } catch (e) {
        if (!stopped) setError(e);
      } finally {
        if (!stopped) setRestoring(false);
      }
    })();
    return () => {
      stopped = true;
      bodyRequest.cancel();
    };
  }, [sessionID, restoreEpoch, setError]);
  /* oxlint-enable react/exhaustive-deps */
  useEffect(() => {
    dirtyCallback.current(dirty);
    viewReady.current
      ?.then(() => {
        if (!disposed.current) return SetWorkspaceDirty(id, currentDirty.current);
      })
      .catch((e) => {
        if (!disposed.current) setError(e);
      });
  }, [dirty, id, setError]);
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (draftsRef.current.some((d) => isDirty(d))) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [draftsRef]);

  async function open(entry: Entry, view?: 'text' | 'image') {
    await openPath(entry.path, 'UTF-8', view);
  }
  async function openPath(path: string, encoding = 'UTF-8', view?: 'text' | 'image') {
    if (restoring || !restoreReady) throw uiMessage('files:waitForLocalDraftsToLoadOrRetry');
    if (!fileOrder.includes(path) && new Set([...fileOrder, ...reads.current.keys()]).size >= 64)
      throw uiMessage('files:openFileLimitReached64');
    if (view) setFileViews((previous) => ({ ...previous, [path]: view }));
    if (view === 'image' || (view !== 'text' && imageFile(path))) {
      const request = reads.current.get(path);
      reads.current.delete(path);
      request?.cancel();
      setFileOrder((previous) => (previous.includes(path) ? previous : [...previous, path]));
      setActive(path);
      if (narrow) setNarrowPanel(null);
      return true;
    }
    if (draftsRef.current.some((d) => d.path === path)) {
      setActive(path);
      if (narrow) setNarrowPanel(null);
      return true;
    }
    if (reads.current.has(path)) return;
    setFileOrder((prev) => (prev.includes(path) ? prev : [...prev, path]));
    setActive(path);
    if (narrow) setNarrowPanel(null);
    setPendingErrors((prev) => {
      const next = { ...prev };
      delete next[path];
      return next;
    });
    const request = ReadRemoteFileEncoded(sessionID, path, encoding);
    reads.current.set(path, request);
    try {
      const doc = await request;
      if (disposed.current || instance.current !== sessionID || reads.current.get(path) !== request)
        return false;
      updateDrafts((prev) => [
        ...prev,
        { ...doc, saved: doc.content, savedFormat: formatKey(doc), error: '', saving: false },
      ]);
      setFileOrder((prev) => (prev.includes(path) ? prev : [...prev, path]));
      if (split && splitDirection === 'columns' && activePane === 1 && !fileOrder.includes(path)) {
        assignToPane(path, 1);
        selectInPane(1, path);
      } else setActive(path);
      return true;
    } catch (e) {
      if (
        !disposed.current &&
        instance.current === sessionID &&
        reads.current.get(path) === request
      )
        setPendingErrors((prev) => ({
          ...prev,
          [path]: { message: e, code: errorCode(e), encoding },
        }));
      return false;
    } finally {
      if (reads.current.get(path) === request) reads.current.delete(path);
    }
  }
  useImperativeHandle(ref, () => ({
    openResource,
    sudoEdit: () => {
      void openSudo();
    },
    workspaceAction,
    layout,
    hasDirty: () => draftsRef.current.some((d) => isDirty(d)),
    recoveryDrafts: () =>
      restoreReady
        ? draftsRef.current
            .filter((d) => isDirty(d))
            .map((d) => ({
              path: d.path,
              content: d.content,
              encoding: d.encoding,
              line_ending: d.line_ending,
              bom: d.bom,
            }))
        : null,
    insertionTarget: () => (terminalHandles.current.has(active) ? active : ''),
    insert: (text, target) =>
      target === active ? terminalHandles.current.get(target)?.insert(text) || false : false,
    appendQuickInput: (text, target) =>
      target === active && terminalOwners.current.get(target) === sessionID
        ? terminalHandles.current.get(target)?.appendQuickInput?.(text) || false
        : false,
    focus: () => focusTab(),
    showFiles,
    locateDirectory: (path) => {
      showFiles();
      setDirectoryRequest((previous) => ({
        path,
        sequence: (previous?.sequence || 0) + 1,
        locate: true,
      }));
    },
    toggleMonitor,
    terminalAction: (action) => terminalHandles.current.get(active)?.action(action),
    toggleFocus: () => setFocus((prev) => !prev),
    async prepareReconnect() {
      if (terminals.length >= 16) {
        setError(uiMessage('files:retainedTerminalLimitReached16CloseEndedTabs'));
        return false;
      }
      if (saves.current.size || creating || preparing || restoring || sudoPrompt) {
        setError(uiMessage('files:waitForSavingRestorationOrTerminalCreationTo'));
        return false;
      }
      setPreparing(true);
      try {
        await CloseWorkspace(sessionID);
        return !disposed.current;
      } finally {
        setPreparing(false);
      }
    },
    async saveAll() {
      for (const draft of draftsRef.current) {
        if (!(await save(draft.path))) {
          setActive(draft.path);
          return false;
        }
      }
      return !draftsRef.current.some((d) => isDirty(d));
    },
  }));

  function close(path: string, discard = false) {
    const draft = draftsRef.current.find((d) => d.path === path);
    if (draft?.saving) return;
    if (!discard && draft && isDirty(draft)) {
      setClosing(path);
      return;
    }
    clearDownloadError(path);
    const request = reads.current.get(path);
    reads.current.delete(path);
    request?.cancel();
    setFileViews((previous) => {
      const next = { ...previous };
      delete next[path];
      return next;
    });
    setFileJump((previous) => (previous?.path === path ? undefined : previous));
    setMarkdownAnchor((previous) => (previous?.path === path ? undefined : previous));
    updateDrafts((prev) => prev.filter((d) => d.path !== path));
    setFileOrder((prev) => prev.filter((p) => p !== path));
    setPendingErrors((prev) => {
      const next = { ...prev };
      delete next[path];
      return next;
    });
    setClosing('');
  }
  const closingDraft = drafts.find((d) => d.path === closing);
  function activate(path: string) {
    setActive(path);
    requestAnimationFrame(() => focusTab(path));
  }
  function closeTab(path: string) {
    if (!terminals.includes(path)) {
      close(path);
      return;
    }
    terminalOwners.current.delete(path);
    tmuxAttached.current.delete(path);
    unbindTmux(path);
    setTerminals((prev) => prev.filter((t) => t !== path));
  }
  function workspaceAction(action: 'switchPane' | 'closeContent' | 'newTerminal') {
    if (restoring) return true;
    if (action === 'newTerminal') void newTerminal();
    if (action === 'closeContent') {
      if (!active) return false;
      closeTab(active);
    }
    if (action === 'switchPane' && split) {
      const offset = paneSelected
        .slice(activePane + 1)
        .concat(paneSelected.slice(0, activePane))
        .findIndex(Boolean);
      if (offset >= 0) {
        const pane = (activePane + offset + 1) % paneSelected.length;
        setActivePane(pane);
        requestAnimationFrame(() => focusTab(paneSelected[pane]));
      }
    }
    return true;
  }
  const fileContexts = fileTabContexts(fileOrder);
  const tabs = tabIDs.map((path) => {
    const draft = drafts.find((d) => d.path === path);
    const terminal = terminals.includes(path);
    const ended =
      terminal && (terminalOwners.current.get(path) !== sessionID || state === 'disconnected');
    return {
      id: path,
      label: terminal
        ? `${tmuxBindings[path] ? `tmux · ${tmuxBindings[path]}` : translate('files:terminal', { value1: terminals.indexOf(path) + 1 })}${ended ? translate('files:disconnected2') : ''}`
        : path.split('/').pop() || path,
      context: terminal ? undefined : fileContexts.get(path),
      terminal,
      attention: terminal ? attention[path] : undefined,
      dirty: !!draft && isDirty(draft),
      closingDisabled: restoring || draft?.saving,
    };
  });
  return (
    <div
      className={compact ? 'ssh-workspace compact-ssh' : 'ssh-workspace'}
      onKeyDown={(event) => {
        if (
          event.key === 'Escape' &&
          narrowPanel &&
          !event.defaultPrevented &&
          !event.nativeEvent.isComposing &&
          !(event.target as HTMLElement).closest('input,textarea,[role=dialog]')
        ) {
          event.preventDefault();
          const panel = narrowPanel;
          setNarrowPanel(null);
          focusPanelToggle(panel);
        }
      }}
    >
      <div className="workspace-toolbar" aria-label={translate('files:sSHWorkspaceTools')}>
        <Tooltip content={target}>
          <span className="session-target">{target}</span>
        </Tooltip>
        {environment && (
          <span className={`connection-environment ${environment}`}>
            {
              (
                {
                  production: translate('files:production'),
                  staging: translate('files:staging'),
                  development: translate('files:development'),
                } as Record<string, string>
              )[environment]
            }
          </span>
        )}
        {state !== 'connected' && (
          <span className="session-state" role="status">
            {connectionStateLabel(state)}
          </span>
        )}
        {state === 'disconnected' && (
          <Button size="sm" variant="light" isDisabled={busy || preparing} onPress={onReconnect}>
            {translate('files:reconnect')}
          </Button>
        )}
        <Dropdown>
          <DropdownTrigger>
            <Tooltip content={translate('files:paneLayout')}>
              <button className="icon-button" aria-label={translate('files:paneLayout')}>
                <Icon name="sidebar" width="16" />
              </button>
            </Tooltip>
          </DropdownTrigger>
          <DropdownMenu
            aria-label={translate('files:paneActions')}
            disabledKeys={[
              ...(state !== 'connected' || terminals.length >= 16 ? ['new'] : []),
              ...(creating || restoring
                ? ['new', 'rows', 'columns', 'bottom', 'grid', 'move', 'merge']
                : []),
              ...(!active ? ['move'] : []),
              ...(!split ? ['maximize', 'merge'] : []),
            ]}
            onAction={(key) => {
              automaticSplit.current = false;
              if (key === 'rows' || key === 'columns') applyTwoPanes(key);
              if (key === 'bottom' || key === 'grid') applyColumns(key);
              if (key === 'new') void newTerminal(splitColumns ? activePane : 1);
              if (key === 'move') moveActive();
              if (key === 'maximize') setMaximized((v) => !v);
              if (key === 'merge') {
                setSplit(false);
                setSplitColumns(undefined);
                setPaneAssignments({});
                setSelection([active || paneSelected[0], '', '', '']);
                setActivePane(0);
                setMaximized(false);
              }
            }}
          >
            <DropdownItem
              key="rows"
              endContent={split && !splitColumns && splitDirection === 'rows' ? '✓' : null}
            >
              {translate('files:splitVertically')}
            </DropdownItem>
            <DropdownItem
              key="columns"
              endContent={split && splitDirection === 'columns' ? '✓' : null}
            >
              {translate('files:splitHorizontally')}
            </DropdownItem>
            <DropdownItem key="bottom" endContent={splitColumns === 'bottom' ? '✓' : null}>
              {translate('files:editorAndTwoTerminals')}
            </DropdownItem>
            <DropdownItem key="grid" endContent={splitColumns === 'grid' ? '✓' : null}>
              {translate('files:fourPaneGrid')}
            </DropdownItem>
            <DropdownItem key="new">
              {translate(
                splitColumns
                  ? 'common:newTerminal'
                  : splitDirection === 'rows'
                    ? 'files:newTerminalBelow'
                    : 'files:newTerminalOnTheRight',
              )}
            </DropdownItem>
            <DropdownItem key="move">{translate('files:moveCurrentTabToOtherPane')}</DropdownItem>
            <DropdownItem key="maximize">
              {maximized
                ? translate('files:restoreSplitPanes')
                : translate('files:maximizeCurrentPane')}
            </DropdownItem>
            <DropdownItem key="merge">{translate('files:mergePanes')}</DropdownItem>
          </DropdownMenu>
        </Dropdown>
        <Tooltip content={translate('files:focusMode')}>
          <button
            className="icon-button focus-toggle"
            aria-label={translate('files:focusMode')}
            aria-pressed={focus}
            onClick={() => setFocus(!focus)}
          >
            <Icon name="focus" width="16" />
          </button>
        </Tooltip>
        <Dropdown>
          <DropdownTrigger>
            <Tooltip content={translate('files:sSHSessionActions')}>
              <button className="icon-button" aria-label={translate('files:sSHSessionActions')}>
                <Icon name="more" width="15" />
              </button>
            </Tooltip>
          </DropdownTrigger>
          <DropdownMenu
            aria-label={translate('files:sSHSessionActions')}
            disabledKeys={[
              ...(busy || preparing ? ['reconnect'] : []),
              ...(!automaticReconnect ? ['automatic'] : []),
            ]}
            onAction={(key) => {
              if (key === 'automatic') {
                reconnect.toggle();
                if (reconnect.enabled) onCancelReconnect();
              } else onReconnect();
            }}
          >
            <DropdownItem key="reconnect">{translate('files:reconnect')}</DropdownItem>
            <DropdownItem key="automatic" endContent={reconnect.enabled ? '✓' : null}>
              {translate('files:reconnectAutomaticallyAfterDisconnecting')}
            </DropdownItem>
          </DropdownMenu>
        </Dropdown>
      </div>
      {reconnect.status && (
        <div className="session-status" role="status">
          <span>{reconnect.status}</span>
          <button
            className="session-tool"
            onClick={() => {
              reconnect.toggle();
              onCancelReconnect();
            }}
          >
            {translate('files:stopAutomaticReconnect')}
          </button>
        </div>
      )}
      <div className="ssh-panels">
        <WorkspaceToolRail
          side="left"
          tools={[
            {
              id: 'files',
              label: translate('files:files'),
              icon: 'files',
              active: filesShown,
              buttonRef: filesToggle,
              onClick: toggleFiles,
            },
            ...(onTransfers
              ? [
                  {
                    id: 'transfers',
                    label: translate('files:fileTransfers'),
                    icon: 'transfer' as const,
                    disabled: state !== 'connected',
                    onClick: () => onTransfers(directory, []),
                  },
                ]
              : []),
            {
              id: 'snippets',
              label: translate('common:insertSnippet2').trim(),
              icon: 'code',
              disabled: state !== 'connected' || !terminals.includes(active),
              onClick: () => onSnippets(),
            },
          ]}
        />
        {narrow && narrowPanel && (
          <button
            className="panel-scrim"
            aria-label={translate('files:closeAuxiliaryPanel')}
            tabIndex={-1}
            onClick={() => {
              const panel = narrowPanel;
              setNarrowPanel(null);
              focusPanelToggle(panel);
            }}
          />
        )}
        <div className="file-dock" hidden={!filesShown} style={{ width: filesWidth }}>
          <FileBrowser
            readOnly={browseOnly}
            onToggleReadOnly={() => void toggleBrowseOnly()}
            changingMode={changingMode}
            id={sessionID}
            connectionID={connectionID}
            initialDirectory={initialLayout?.directory}
            onDirectory={setDirectory}
            directoryRequest={directoryRequest}
            followDirectory={followDirectory}
            onFollowDirectory={() => setFollowDirectory((value) => !value)}
            onBrowseDirectory={() => setFollowDirectory(false)}
            directoryFollowStatus={directoryFollowStatus}
            onEnableDirectoryReporting={
              activeTerminal
                ? () => terminalHandles.current.get(active)?.action('directoryReporting')
                : undefined
            }
            onTerminalDirectory={locateInTerminal}
            onTransfers={onTransfers}
            visible={visible && filesShown}
            onOpen={open}
            onOpenFile={openTerminalFile}
            onClose={() => {
              toggleFiles();
              filesToggle.current?.focus();
            }}
          />
        </div>
        {filesShown && !narrow && (
          <ResizeHandle
            label={translate('files:filePanelWidth')}
            value={filesWidth}
            min={200}
            max={420}
            onChange={setFilesWidth}
          />
        )}
        <div className="ssh-center" ref={center}>
          <ErrorNotice
            message={error}
            onDismiss={() => setError('')}
            className="connection-feedback"
          />
          {!restoreReady && !restoring && (
            <Button
              size="sm"
              onPress={() => {
                restoreApplied.current = false;
                setRestoreEpoch((v) => v + 1);
              }}
            >
              {translate('files:retryLoadingLocalDrafts')}
            </Button>
          )}
          {restoring && (
            <div className="session-status" role="status">
              {translate('files:restoringFileAndTerminalEntries')}
            </div>
          )}
          {!tabIDs.length && (
            <div className="workspace-empty">
              {translate('files:createATerminalOrOpenAFileFrom')}
            </div>
          )}
          <WorkspacePanes
            split={split}
            direction={splitDirection}
            maximized={maximized}
            ratio={ratio}
            onRatio={setRatio}
            tabHeight={compact ? 30 : undefined}
            columns={
              splitColumns
                ? { mode: splitColumns, ratio: columnRatio, onRatio: setColumnRatio }
                : undefined
            }
          >
            {terminals
              .filter((terminal) => tmuxBindings[terminal] && !tmuxAttached.current.has(terminal))
              .map((terminal) => (
                <div
                  className="terminal-tab workspace-empty"
                  data-tab-id={terminal}
                  key={`tmux-${terminal}`}
                  hidden={!shown(terminal)}
                  style={panePosition(paneFor(terminal))}
                >
                  <span>tmux · {tmuxBindings[terminal]}</span>
                  <Button
                    size="sm"
                    isDisabled={state !== 'connected' || creating || restoring}
                    onPress={() => {
                      void attachTmux(tmuxBindings[terminal], terminal);
                    }}
                  >
                    {translate('files:reattach')}
                  </Button>
                  <Button size="sm" variant="light" onPress={() => closeTab(terminal)}>
                    {translate('files:closeEntry')}
                  </Button>
                </div>
              ))}
            {Array.from({ length: paneCount }, (_, pane) => (
              <PaneTabs
                key={`pane-${pane}`}
                pane={pane}
                newShortcut={shortcutLabel(shortcuts.newTerminal)}
                closeShortcut={shortcutLabel(shortcuts.closeContent)}
                items={tabs.filter((t) => paneFor(t.id) === pane)}
                selected={paneSelected[pane]}
                focused={pane === activePane}
                hidden={maximized && pane !== activePane}
                column={panePosition(pane, true).gridColumn}
                row={panePosition(pane, true).gridRow}
                stacked={splitDirection === 'rows'}
                numbered={!!splitColumns}
                creating={state !== 'connected' || creating || restoring || terminals.length >= 16}
                onSelect={activate}
                onClose={closeTab}
                onNew={() => void newTerminal(pane)}
                onSplit={
                  compact && !split && pane === 0
                    ? (direction) => void newTerminal(1, direction)
                    : compact && pane === 1 && paneCount === 2 && splitDirection === 'rows'
                      ? () => void newTerminal(2, 'rows', 'bottom')
                      : undefined
                }
                splitDirections={pane === 1 ? ['columns'] : undefined}
              />
            ))}
            {terminals
              .filter((terminal) => !tmuxBindings[terminal] || tmuxAttached.current.has(terminal))
              .map((terminal) => (
                <div
                  className={`terminal-tab ${activePane === paneFor(terminal) ? 'focused-pane' : ''}`}
                  data-tab-id={terminal}
                  hidden={!shown(terminal)}
                  style={panePosition(paneFor(terminal))}
                  onFocusCapture={() => setActivePane(paneFor(terminal))}
                  key={terminal}
                >
                  <TerminalView
                    onAIReference={
                      aiEnabled &&
                      state === 'connected' &&
                      terminalOwners.current.get(terminal) === sessionID
                        ? queueAIReference
                        : undefined
                    }
                    ref={(handle) => {
                      if (handle) terminalHandles.current.set(terminal, handle);
                      else terminalHandles.current.delete(terminal);
                    }}
                    id={terminal}
                    workspace={terminalOwners.current.get(terminal) || sessionID}
                    tmuxSession={tmuxBindings[terminal]}
                    tmuxAttached={tmuxAttached.current.has(terminal)}
                    tmuxAvailable={state === 'connected' && !creating && !restoring}
                    onTmuxAttach={(name) => attachTmux(name, terminal)}
                    onTmuxUnbind={() => unbindTmux(terminal)}
                    host={target
                      .slice(target.lastIndexOf('@') + 1, target.lastIndexOf(':'))
                      .replace(/^\[|\]$/g, '')}
                    onDirectory={(path, host) => terminalDirectory(terminal, path, host)}
                    onDirectoryStatus={(status) => terminalDirectoryStatus(terminal, status)}
                    onFile={openTerminalFile}
                    onSnippets={() => {
                      setActive(terminal);
                      onSnippets();
                    }}
                    quickInputAvailable={
                      state === 'connected' && terminalOwners.current.get(terminal) === sessionID
                    }
                    onQuickInputSnippets={() => {
                      setActive(terminal);
                      onSnippets(terminal);
                    }}
                    onAttention={(value) =>
                      setAttention((previous) =>
                        previous[terminal] === value
                          ? previous
                          : { ...previous, [terminal]: value },
                      )
                    }
                    onActivate={() => {
                      activate(terminal);
                      onActivate?.();
                    }}
                    onConnectionChange={() => changeCallback.current()}
                    visible={visible && shown(terminal)}
                    focusOnShow={activePane === paneFor(terminal)}
                    fontSize={fontSize}
                  />
                </div>
              ))}
            {fileOrder
              .filter((path) => !imageFile(path) && !drafts.some((d) => d.path === path))
              .map((path) => {
                const failure = pendingErrors[path];
                const retry = (encoding: string) => {
                  void openPath(path, encoding, 'text').catch((e) => setError(e));
                };
                return (
                  <div
                    key={path}
                    className="editor-tab pending-file"
                    data-tab-id={path}
                    hidden={!shown(path)}
                    style={panePosition(paneFor(path))}
                  >
                    <p className="file-path">{path}</p>
                    {failure ? (
                      <ErrorNotice message={errorMessage(failure.message)} />
                    ) : (
                      <p role="status" className="muted">
                        {translate('files:readingFile')}
                      </p>
                    )}
                    <div className="button-row">
                      {failure?.code === 'file_encoding' && (
                        <SelectControl
                          aria-label={translate('files:openFileWithSpecifiedEncoding')}
                          value=""
                          disabled={restoring || !restoreReady}
                          onChange={(e) => {
                            if (e.target.value) retry(e.target.value);
                          }}
                        >
                          <option value="" disabled>
                            {translate('files:selectEncoding')}
                          </option>
                          {editorEncodings.map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </SelectControl>
                      )}
                      {failure &&
                        ![
                          'file_encoding',
                          'file_binary',
                          'file_too_large',
                          'file_not_regular',
                        ].includes(failure.code) && (
                          <Button
                            size="sm"
                            variant="bordered"
                            isDisabled={restoring || !restoreReady}
                            onPress={() => retry(failure.encoding)}
                          >
                            {translate('files:retryReading2')}
                          </Button>
                        )}
                      {failure && (
                        <Button
                          size="sm"
                          variant="light"
                          isDisabled={restoring || !restoreReady || state !== 'connected'}
                          onPress={() => void openSudo(path)}
                        >
                          {translate('files:openWithSudo')}
                        </Button>
                      )}
                      {failure && failure.code !== 'file_not_regular' && (
                        <Button
                          size="sm"
                          variant="light"
                          onPress={() => {
                            void StartDownload(sessionID, path).catch((e) => setError(e));
                          }}
                        >
                          {translate('files:downloadOriginalFile')}
                        </Button>
                      )}
                      {failure?.code === 'file_binary' && (
                        <Button
                          size="sm"
                          variant="light"
                          onPress={() => {
                            void openPath(path, 'UTF-8', 'image').catch((e) => setError(e));
                          }}
                        >
                          {translate('files:previewImage')}
                        </Button>
                      )}
                      <Button size="sm" variant="light" onPress={() => close(path)}>
                        {translate('files:closeFile')}
                      </Button>
                    </div>
                  </div>
                );
              })}
            {fileOrder.filter(imageFile).map((path) => (
              <div
                key={`image:${path}`}
                className="editor-tab"
                data-tab-id={path}
                hidden={!shown(path)}
                style={panePosition(paneFor(path))}
                onFocusCapture={() => setActivePane(paneFor(path))}
              >
                <Suspense
                  fallback={
                    <div className="view-loading" role="status">
                      {translate('files:loadingImagePreview')}
                    </div>
                  }
                >
                  <ImagePreview
                    workspace={sessionID}
                    path={path}
                    visible={visible && shown(path)}
                    onDownload={() => {
                      void StartDownload(sessionID, path).catch((e) => setError(e));
                    }}
                    onText={() => {
                      void openPath(path, 'UTF-8', 'text').catch((e) => setError(e));
                    }}
                  />
                </Suspense>
              </div>
            ))}
            {drafts.map((d) => {
              const recovery = fileErrorAction(d, state === 'connected');
              return (
                <div
                  key={d.path}
                  className={`editor-tab ${activePane === paneFor(d.path) ? 'focused-pane' : ''}`}
                  data-tab-id={d.path}
                  hidden={!shown(d.path) || imageFile(d.path)}
                  style={panePosition(paneFor(d.path))}
                  onFocusCapture={() => setActivePane(paneFor(d.path))}
                >
                  <ErrorNotice
                    message={downloadErrors[d.path] ? translate('files:draftDownloadFailed') : ''}
                    onDismiss={() => clearDownloadError(d.path)}
                  >
                    <p>{errorMessage(downloadErrors[d.path])}</p>
                    <button className="session-tool" onClick={() => void downloadDraft(d.path)}>
                      {translate('files:downloadCurrentContent')}
                    </button>
                  </ErrorNotice>
                  {errorMessage(eventError(d)) && (
                    <div className="file-save-error">
                      <p role="alert" className="error">
                        {recovery === 'compare'
                          ? translate('files:reviewTheLatestRemoteContentBeforeSavingThe')
                          : d.errorOperation === 'read'
                            ? translate('files:fileReloadFailed')
                            : translate('files:fileSaveFailed')}
                      </p>
                      <details>
                        <summary>{errorMessage(eventError(d)).split('\n')[0]}</summary>
                        <p>{errorMessage(eventError(d))}</p>
                      </details>
                      <div className="button-row">
                        {recovery === 'compare' && (
                          <Button
                            size="sm"
                            variant="light"
                            isDisabled={d.saving}
                            onPress={() => setConflict(d.path)}
                          >
                            {translate('files:compareAndMerge')}
                          </Button>
                        )}
                        {recovery === 'reconnect' && (
                          <Button
                            size="sm"
                            variant="light"
                            isDisabled={busy || preparing}
                            onPress={onReconnect}
                          >
                            {translate('files:reconnect')}
                          </Button>
                        )}
                        {recovery === 'encoding' && (
                          <Button
                            size="sm"
                            variant="light"
                            isDisabled={d.saving}
                            onPress={() =>
                              updateDrafts((previous) =>
                                previous.map((item) =>
                                  item.path === d.path
                                    ? {
                                        ...item,
                                        encoding: 'UTF-8',
                                        error: '',
                                        errorOperation: undefined,
                                      }
                                    : item,
                                ),
                              )
                            }
                          >
                            {translate('files:useUTF8')}
                          </Button>
                        )}
                        {recovery === 'save' && (
                          <Button
                            size="sm"
                            variant="light"
                            isDisabled={d.saving}
                            onPress={() => void save(d.path)}
                          >
                            {translate('files:retrySave')}
                          </Button>
                        )}
                        {recovery === 'save' && !d.sudo && (
                          <Button
                            size="sm"
                            variant="light"
                            isDisabled={d.saving}
                            onPress={() => void openSudo(d.path)}
                          >
                            {translate('files:openWithSudo')}
                          </Button>
                        )}
                        {state === 'connected' && (
                          <Button
                            size="sm"
                            variant="light"
                            isDisabled={d.saving}
                            onPress={() => requestReload(d.path, savedEncoding(d))}
                          >
                            {translate('files:reload')}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="light"
                          onPress={() => {
                            navigator.clipboard.writeText(d.content).catch((e) => setError(e));
                          }}
                        >
                          {translate('files:copyDraft')}
                        </Button>
                      </div>
                    </div>
                  )}
                  <Suspense
                    fallback={
                      <div className="view-loading" role="status">
                        {translate('files:loadingEditor')}
                      </div>
                    }
                  >
                    <TextDocument
                      workspace={sessionID}
                      onHistory={() =>
                        setHistoryRequest({ path: d.path, owner: sessionID, validate: false })
                      }
                      onSaveAndValidate={
                        state === 'connected'
                          ? () =>
                              setHistoryRequest({ path: d.path, owner: sessionID, validate: true })
                          : undefined
                      }
                      anchor={markdownAnchor?.path === d.path ? markdownAnchor : undefined}
                      onNavigate={(path, hash) => {
                        setMarkdownAnchor((previous) => ({
                          path,
                          hash,
                          sequence: (previous?.sequence || 0) + 1,
                        }));
                        void openPath(path).catch((error) => setError(error));
                      }}
                      completionShortcut={shortcuts.completion}
                      path={d.path}
                      jumpTo={fileJump?.path === d.path ? fileJump : undefined}
                      content={d.content}
                      format={documentFormat(d)}
                      saving={d.saving}
                      dirty={isDirty(d)}
                      reloadEpoch={d.reloadEpoch}
                      visible={visible && shown(d.path) && !imageFile(d.path)}
                      focusOnShow={activePane === paneFor(d.path)}
                      onChange={(value, format) =>
                        updateDrafts((prev) =>
                          prev.map((item) =>
                            item.path === d.path ? { ...item, ...format, content: value } : item,
                          ),
                        )
                      }
                      onSave={() => void save(d.path)}
                      onReload={(encoding) => requestReload(d.path, encoding)}
                      onDownload={() => void downloadDraft(d.path)}
                    />
                  </Suspense>
                </div>
              );
            })}
          </WorkspacePanes>
          {historyRequest?.owner === sessionID &&
            drafts
              .filter((d) => d.path === historyRequest.path)
              .map((d) => (
                <Suspense
                  key={`history:${sessionID}:${d.path}`}
                  fallback={
                    <div role="status">{translate('files:loadingConfigurationHistory')}</div>
                  }
                >
                  <FileHistoryDialog
                    workspace={sessionID}
                    target={target}
                    document={d}
                    dirty={isDirty(d)}
                    validateOnOpen={historyRequest.validate}
                    onSave={() => save(d.path)}
                    onClose={() => setHistoryRequest(undefined)}
                    onRestore={(version) =>
                      updateDrafts((previous) =>
                        previous.map((item) =>
                          item.path === d.path
                            ? {
                                ...item,
                                content: version.content,
                                ...documentFormat(version),
                                reloadEpoch: (item.reloadEpoch || 0) + 1,
                              }
                            : item,
                        ),
                      )
                    }
                  />
                </Suspense>
              ))}
        </div>
        {tunnelsShown && !narrow && (
          <ResizeHandle
            label={translate('tunnels:panelWidth')}
            value={tunnelsWidth}
            min={280}
            max={520}
            reverse
            onChange={setTunnelsWidth}
          />
        )}
        <div
          className="tunnel-dock"
          hidden={!tunnelsShown}
          style={{ width: tunnelsWidth }}
          onKeyDown={(event) => {
            if (
              event.key === 'Escape' &&
              !event.defaultPrevented &&
              !event.nativeEvent.isComposing &&
              !(event.target as HTMLElement).closest('[role=dialog],[role=listbox]')
            ) {
              event.preventDefault();
              closeTunnels();
            }
          }}
        >
          <TunnelPanel
            id={sessionID}
            connectionID={connectionID}
            target={target}
            visible={visible && tunnelsShown}
            onClose={closeTunnels}
            onCountChange={setTunnelCount}
          />
        </div>
        <MonitorPanel
          id={sessionID}
          visible={visible && monitorShown}
          leadingDockWidth={filesShown && !narrow ? filesWidth : 0}
          onDirectory={(path) => {
            showFiles();
            setDirectoryRequest((previous) => ({
              path,
              sequence: (previous?.sequence || 0) + 1,
              locate: true,
            }));
          }}
          onFile={(path) => openTerminalFile(path, 1)}
          onClose={() => {
            toggleMonitor();
            monitorToggle.current?.focus();
          }}
        />
        {aiShown && !narrow && (
          <ResizeHandle
            label={translate('files:aIPanelWidth')}
            value={aiWidth}
            min={300}
            max={600}
            reverse
            onChange={setAIWidth}
          />
        )}
        {aiSettings.settings?.enabled && aiVisited && (
          <div className="ai-dock" hidden={!aiShown} style={{ width: aiWidth }}>
            <Suspense
              fallback={
                <div className="view-loading" role="status">
                  {translate('files:loading')}
                </div>
              }
            >
              <AIPanel
                key={sessionID}
                workspace={sessionID}
                visible={visible && aiShown && state === 'connected'}
                configRevision={aiSettings.revision}
                references={aiReferences}
                onRemoveReference={(index) =>
                  setAIReferences((previous) => previous.filter((_, i) => i !== index))
                }
                onReferencesSent={(sent) =>
                  setAIReferences((previous) =>
                    previous.filter((reference) => !sent.includes(reference)),
                  )
                }
                onClose={closeAI}
              />
            </Suspense>
          </div>
        )}
        <WorkspaceToolRail
          tools={[
            {
              id: 'monitor',
              label: translate('files:monitoring'),
              icon: 'monitor',
              active: monitorShown,
              buttonRef: monitorToggle,
              onClick: toggleMonitor,
            },
            ...(aiEnabled
              ? [
                  {
                    id: 'ai',
                    label: translate('files:aIAssistant'),
                    icon: 'sparkles' as const,
                    active: aiShown,
                    disabled: state !== 'connected',
                    buttonRef: aiToggle,
                    onClick: toggleAI,
                  },
                ]
              : []),
            {
              id: 'tunnels',
              label: translate('files:portForwarding'),
              icon: 'tunnel',
              active: tunnelsShown,
              count: tunnelCount,
              buttonRef: tunnelsToggle,
              onClick: toggleTunnels,
            },
            ...(onDocker
              ? [
                  {
                    id: 'docker',
                    label: translate('docker:dockerContainers'),
                    icon: 'container' as const,
                    disabled: state !== 'connected',
                    onClick: onDocker,
                  },
                ]
              : []),
          ]}
        />
      </div>
      {conflict && drafts.find((d) => d.path === conflict) && (
        <Suspense
          fallback={
            <div className="session-status" role="status">
              {translate('files:loadingDiffView')}
            </div>
          }
        >
          <FileConflictView
            key={`${sessionID}:${conflict}`}
            sessionID={sessionID}
            path={conflict}
            content={drafts.find((d) => d.path === conflict)!.content}
            encoding={savedEncoding(drafts.find((d) => d.path === conflict)!)}
            lineEnding={drafts.find((d) => d.path === conflict)!.line_ending || 'LF'}
            remoteDocument={sudoConflict}
            onClose={() => setConflict('')}
            onApply={(content, remote) => {
              updateDrafts((prev) =>
                prev.map((d) =>
                  d.path === conflict
                    ? {
                        ...d,
                        content,
                        saved: remote.content,
                        savedFormat: formatKey(remote),
                        revision: remote.revision,
                        needsReview: false,
                        recovery: false,
                        error: '',
                      }
                    : d,
                ),
              );
              setConflict('');
            }}
          />
        </Suspense>
      )}
      {resourceLog && (
        <Suspense fallback={<p role="status">{translate('files:loadingLogs')}</p>}>
          <RemoteLogDialog
            workspace={sessionID}
            path={resourceLog}
            visible={visible}
            onClose={() => setResourceLog('')}
          />
        </Suspense>
      )}
      {resourceService && (
        <Suspense fallback={<p role="status">{translate('files:loadingServices')}</p>}>
          <LinuxInspectionDialog
            workspace={sessionID}
            initialOrder="services"
            initialUnit={resourceService}
            onDirectory={(path) => {
              showFiles();
              setDirectoryRequest({ path, sequence: Date.now(), locate: true });
            }}
            onFile={(path) => openTerminalFile(path, 1)}
            onClose={() => setResourceService('')}
          />
        </Suspense>
      )}
      {sudoPrompt && (
        <SudoAuthorizationDialog {...sudoPrompt} target={target} onAnswer={answerSudo} />
      )}
      <Modal
        isOpen={!!closingDraft}
        onClose={() => !closingDraft?.saving && setClosing('')}
        className="app-dialog"
      >
        <ModalContent>
          <ModalHeader>{translate('files:saveFileChanges')}</ModalHeader>
          <ModalBody>
            <p className="file-path">{closing}</p>
            {errorMessage(eventError(closingDraft)) && (
              <p className="error" role="alert">
                {errorMessage(eventError(closingDraft))}
              </p>
            )}
          </ModalBody>
          <ModalFooter>
            <Button
              variant="light"
              isDisabled={closingDraft?.saving}
              onPress={() => setClosing('')}
            >
              {translate('files:cancel')}
            </Button>
            <Button
              color="danger"
              variant="light"
              isDisabled={closingDraft?.saving}
              onPress={() => close(closing, true)}
            >
              {translate('files:discardChanges')}
            </Button>
            <Button
              color="primary"
              isLoading={closingDraft?.saving}
              onPress={async () => {
                if (await save(closing)) close(closing, true);
              }}
            >
              {translate('files:saveAndClose')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
      <Modal isOpen={!!rereading} onClose={() => setRereading('')} className="app-dialog">
        <ModalContent>
          <ModalHeader>{translate('files:reloadRemoteFile')}</ModalHeader>
          <ModalBody>
            <p className="file-path">{rereading}</p>
            <p>{translate('files:thisReplacesTheLocalDraftCopyAnyContent')}</p>
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={() => setRereading('')}>
              {translate('files:cancel')}
            </Button>
            <Button color="danger" onPress={() => void reread(rereading)}>
              {translate('files:discardDraftAndReload')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
});

export default SSHWorkspace;
