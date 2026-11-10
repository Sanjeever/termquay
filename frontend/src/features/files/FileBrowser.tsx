import Modal from '../../components/Modal';
import { t as translate, currentLocale } from '../../i18n/index.ts';
import { message as uiMessage } from '../../i18n/messages.ts';
import { useMessageState } from '../../i18n/useMessageState.ts';
import { useTranslation } from 'react-i18next';
import { errorMessage, eventError } from '../../lib/errors.ts';
import { Events } from '@wailsio/runtime';
import { Fragment, lazy, Suspense, useEffect, useRef, useState } from 'react';
import {
  Button,
  DropdownTrigger,
  DropdownMenu,
  DropdownItem,
  ModalBody,
  ModalContent,
  ModalHeader,
  ModalFooter,
} from '@heroui/react';
import { Dropdown } from '../../components/Popover';
import Tooltip from '../../components/Tooltip';
import {
  GetDirectoryBookmarks,
  SetDirectoryBookmarks,
  CreateRemoteDirectory,
  RenameRemotePath,
  DeleteRemotePath,
  StartDownload,
  StartDownloads,
  MoveRemotePaths,
  DeleteRemotePaths,
} from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { Entry } from '../../../bindings/github.com/Sanjeever/termquay/internal/files/models';
import Icon from '../../components/Icon';
import ErrorNotice from '../../components/ErrorNotice';
import DirectorySyncDialog from './DirectorySyncDialog';
import { selectItems } from '../../lib/selection';
import type { RemotePathResult } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import useFileTree from './useFileTree';
import { entryMetadata, fileTreeRows, inDirectory } from './fileTree';
import FileIcon from './FileIcon';
import RemoteLogDialog from './RemoteLogDialog';
import {
  CopyRemoteFiles,
  PasteClipboardFiles,
} from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';

const FileSearchDialog = lazy(() => import('./FileSearchDialog'));

function FileMetadata({ entry }: { entry: Entry }) {
  useTranslation();
  return (
    <dl className="file-tooltip">
      {entryMetadata(entry).map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function FileBrowser({
  id,
  connectionID,
  visible,
  readOnly = false,
  onToggleReadOnly,
  changingMode = false,
  onOpen,
  onOpenFile,
  onClose,
  initialDirectory = '',
  onDirectory,
  directoryRequest,
  followDirectory,
  onFollowDirectory,
  onTerminalDirectory,
  demoDirectories,
}: {
  id: string;
  connectionID: string;
  visible: boolean;
  readOnly?: boolean;
  onToggleReadOnly?(): void;
  changingMode?: boolean;
  onOpen(entry: Entry, view?: 'text' | 'image'): Promise<void>;
  onOpenFile?(path: string, line: number): Promise<void>;
  onClose(): void;
  initialDirectory?: string;
  onDirectory?(path: string): void;
  directoryRequest?: { path: string; sequence: number; locate?: boolean };
  followDirectory?: boolean;
  onFollowDirectory?(): void;
  onTerminalDirectory?(path: string): void;
  demoDirectories?: Record<string, Entry[]>;
}) {
  useTranslation();
  const [directory, setDirectory] = useState(initialDirectory);
  const tree = useFileTree(id, visible, demoDirectories);
  const [selected, setSelected] = useState('');
  const [selection, setSelection] = useState<string[]>([]);
  const anchor = useRef('');
  const [menu, setMenu] = useState('');
  const [batch, setBatch] = useState<{ kind: 'download' | 'move' | 'delete'; paths: string[] }>();
  const [results, setResults] = useState<RemotePathResult[]>([]);
  const [error, setError] = useMessageState('');
  const [navigationFailure, setNavigationFailure] = useState<{ path: string; message: unknown }>();
  const [loading, setLoading] = useState(false);
  const [editingPath, setEditingPath] = useState(false);
  const [action, setAction] = useState<{ kind: 'mkdir' | 'rename' | 'delete'; path: string }>();
  const [working, setWorking] = useState(false);
  const deletion = useRef<ReturnType<typeof DeleteRemotePaths>>();
  const [deleteProgress, setDeleteProgress] = useState('');
  useEffect(() => {
    const off = Events.On('files:delete-progress', (event) => {
      const value = event.data as { workspace: string; path: string; deleted: number };
      if (value.workspace === id && deletion.current)
        setDeleteProgress(
          translate('files:deletedItems', { value1: value.path, value2: value.deleted }),
        );
    });
    return () => {
      off();
      deletion.current?.cancel();
      deletion.current = undefined;
    };
  }, [id]);
  const [clipboardBusy, setClipboardBusy] = useState(false);
  const [clipboardCopied, setClipboardCopied] = useState(false);
  useEffect(() => {
    const copied = () => setClipboardCopied(true),
      blurred = () => setClipboardCopied(false);
    window.addEventListener('termquay:files-copied', copied);
    window.addEventListener('blur', blurred);
    return () => {
      window.removeEventListener('termquay:files-copied', copied);
      window.removeEventListener('blur', blurred);
    };
  }, []);
  const clipboardRequest = useRef<{ cancel(): unknown }>();
  useEffect(
    () => () => {
      clipboardRequest.current?.cancel();
      clipboardRequest.current = undefined;
    },
    [id],
  );
  const [history, setHistory] = useState<{ paths: string[]; index: number }>({
    paths: [],
    index: -1,
  });
  const [bookmarks, setBookmarks] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [sort, setSort] = useState('name');
  const [descending, setDescending] = useState(false);
  const [showHidden, setShowHidden] = useState(true);
  const [bookmarkSaving, setBookmarkSaving] = useState(false);
  const [overwrite, setOverwrite] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [logPath, setLogPath] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  useEffect(() => {
    if (!visible) setSearchOpen(false);
  }, [visible]);
  const loaded = useRef(false);
  const pending = useRef<ReturnType<typeof tree.reveal>>();
  const list = useRef<HTMLUListElement>(null);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = panel.current;
    if (!element || demoDirectories) return;
    const observer = new MutationObserver(() => {
      const target = element.matches('.file-drop-target-active')
        ? element
        : element.querySelector<HTMLElement>('.file-drop-target-active');
      element.querySelector('[data-upload-target]')?.removeAttribute('data-upload-target');
      if (target) {
        const directory = target.dataset.remoteDirectory || '';
        element.dataset.dropDirectory = directory;
        const row = element.querySelector<HTMLElement>(
          `[data-tree-path="${CSS.escape(directory)}"]`,
        );
        if (row) {
          row.dataset.uploadTarget = 'true';
          element.dataset.dropRow = 'true';
        } else delete element.dataset.dropRow;
      } else {
        delete element.dataset.dropDirectory;
        delete element.dataset.dropRow;
      }
    });
    observer.observe(element, { subtree: true, attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, [demoDirectories]);
  const lastDirectoryRequest = useRef(0);
  useEffect(() => {
    if (visible && directoryRequest && lastDirectoryRequest.current !== directoryRequest.sequence) {
      lastDirectoryRequest.current = directoryRequest.sequence;
      if (directoryRequest.locate) {
        setFilter('');
        setShowHidden(true);
      }
      void load(directoryRequest.path);
    }
  }, [visible, directoryRequest]);

  async function load(path: string, historyIndex?: number, refresh = false) {
    setNavigationFailure(undefined);
    setLoading(true);
    const request = (async () => {
      if (refresh) await tree.refresh();
      return tree.reveal(path);
    })();
    pending.current = request;
    try {
      const result = await request;
      if (pending.current !== request) return;
      setDirectory(result.path);
      onDirectory?.(result.path);
      setSelected(result.path);
      setSelection([]);
      loaded.current = true;
      setHistory((prev) => {
        if (historyIndex !== undefined) return { ...prev, index: historyIndex };
        if (prev.paths[prev.index] === result.path) return prev;
        const paths = [...prev.paths.slice(0, prev.index + 1), result.path].slice(-100);
        return { paths, index: paths.length - 1 };
      });
      requestAnimationFrame(() =>
        list.current
          ?.querySelector<HTMLElement>(`[data-tree-path="${CSS.escape(result.path)}"]`)
          ?.scrollIntoView({ block: 'nearest' }),
      );
    } catch (e) {
      if (pending.current === request) setNavigationFailure({ path, message: e });
    } finally {
      if (pending.current === request) {
        pending.current = undefined;
        setLoading(false);
      }
    }
  }
  useEffect(() => {
    loaded.current = false;
    if (visible) void load(directory);
    return () => {
      pending.current = undefined;
    };
  }, [id]);
  useEffect(() => {
    if (visible && !loaded.current && !pending.current) void load(directory);
    if (!visible && pending.current) {
      pending.current = undefined;
      loaded.current = false;
      setLoading(false);
    }
  }, [visible]);
  useEffect(() => {
    if (!connectionID || demoDirectories) return;
    let ended = false;
    GetDirectoryBookmarks(connectionID)
      .then((values) => {
        if (!ended) setBookmarks(values || []);
      })
      .catch((e) => {
        if (!ended) setError(e);
      });
    return () => {
      ended = true;
    };
  }, [connectionID, demoDirectories]);
  const rows = fileTreeRows(tree.nodes, tree.expanded, { filter, showHidden, sort, descending });
  const visibleEntries = rows.map((row) => row.entry);
  const focusedVisible = visibleEntries.some((entry) => entry.path === selected);
  const root = tree.nodes['/'];
  const directoryFailure =
    navigationFailure || (root?.error ? { path: '/', message: root.error } : undefined);
  function focusEntry(path: string) {
    setSelected(path);
    requestAnimationFrame(() =>
      list.current?.querySelector<HTMLElement>(`[data-tree-path="${CSS.escape(path)}"]`)?.focus(),
    );
  }
  function toggle(path: string) {
    setError('');
    if (tree.expanded.has(path)) {
      tree.collapse(path);
      setSelection((prev) => prev.filter((value) => value === path || !inDirectory(value, path)));
      if (selected !== path && inDirectory(selected, path)) focusEntry(path);
    } else
      void tree.expand(path).catch((e) => {
        if (e instanceof RangeError) setError(e);
      });
  }
  const selectedEntries = visibleEntries.filter((entry) => selection.includes(entry.path));
  function pick(path: string, toggle = false, range = false) {
    setSelected(path);
    setSelection((prev) =>
      selectItems(
        visibleEntries.map((e) => e.path),
        prev,
        path,
        anchor.current,
        toggle,
        range,
      ),
    );
    if (!range) anchor.current = path;
  }
  const regular = (entry: Entry) =>
    !entry.directory && !entry.symlink && entry.mode.startsWith('-');
  async function fileClipboard(copy: boolean) {
    if (!copy && readOnly) {
      setError(uiMessage('files:pastingUploadsIsDisabledInFileBrowsingMode'));
      return;
    }
    if (demoDirectories || working || clipboardRequest.current || !directory) return;
    if (copy && (!selectedEntries.length || !selectedEntries.every(regular))) {
      setError(uiMessage('files:selectRegularFilesUseDirectoryCopyForFolders'));
      return;
    }
    setClipboardBusy(true);
    setError('');
    const request = copy
      ? CopyRemoteFiles(
          id,
          selectedEntries.map((entry) => entry.path),
        )
      : PasteClipboardFiles(id, directory);
    clipboardRequest.current = request;
    try {
      await request;
      if (copy) window.dispatchEvent(new Event('termquay:files-copied'));
    } catch (e) {
      if (clipboardRequest.current === request) setError(e);
    } finally {
      if (clipboardRequest.current === request) {
        clipboardRequest.current = undefined;
        setClipboardBusy(false);
      }
    }
  }
  function batchAction(kind: 'download' | 'move' | 'delete', entry?: Entry) {
    if (demoDirectories) return;
    if (readOnly && kind !== 'download') {
      setError(uiMessage('files:remoteWritesAreDisabledInFileBrowsingMode'));
      return;
    }
    const paths =
      entry && !selectedEntries.some((e) => e.path === entry.path)
        ? [entry.path]
        : selectedEntries.map((e) => e.path);
    setError('');
    setOverwrite(false);
    setBatch({ kind, paths });
  }
  async function performBatch(target: string) {
    if (!batch || working || demoDirectories) return;
    setWorking(true);
    setError('');
    setDeleteProgress('');
    try {
      if (batch.kind === 'download') {
        const result = await StartDownloads(id, batch.paths, overwrite);
        setResults([
          ...(result.items || []).map((t) => ({
            path: t.name,
            target: '',
            state: 'queued',
            error: '',
          })),
          ...(result.errors || []).map((error) => ({
            path: '',
            target: '',
            state: 'not_run',
            error,
          })),
        ]);
      } else {
        const request =
          batch.kind === 'move'
            ? MoveRemotePaths(id, batch.paths, target)
            : DeleteRemotePaths(id, batch.paths);
        if (batch.kind === 'delete') deletion.current = request;
        setResults((await request) || []);
        await load(directory, undefined, true);
      }
      setBatch(undefined);
    } catch (e) {
      setError(e);
      if (batch.kind === 'delete')
        await load(directory, undefined, true).catch((refreshError) => setError([e, refreshError]));
    } finally {
      deletion.current = undefined;
      setWorking(false);
    }
  }
  async function toggleBookmark() {
    if (!directory || bookmarkSaving) return;
    const next = bookmarks.includes(directory)
      ? bookmarks.filter((p) => p !== directory)
      : [...bookmarks, directory];
    if (next.length > 32) {
      setError(uiMessage('files:directoryBookmarkLimitReached32'));
      return;
    }
    setBookmarkSaving(true);
    try {
      if (connectionID && !demoDirectories) await SetDirectoryBookmarks(connectionID, next);
      setBookmarks(next);
    } catch (e) {
      setError(e);
    } finally {
      setBookmarkSaving(false);
    }
  }

  async function open(entry: Entry, view?: 'text' | 'image') {
    if (entry.directory) await load(entry.path);
    else {
      try {
        setError('');
        await onOpen(entry, view);
      } catch (e) {
        setError(e);
      }
    }
  }
  async function perform(name = '') {
    if (readOnly) {
      setError(uiMessage('files:remoteWritesAreDisabledInFileBrowsingMode'));
      return;
    }
    if (!action || working || demoDirectories) return;
    setWorking(true);
    setError('');
    try {
      if (action.kind === 'mkdir')
        await CreateRemoteDirectory(id, `${directory.replace(/\/$/, '')}/${name}`);
      if (action.kind === 'rename')
        await RenameRemotePath(
          id,
          action.path,
          `${action.path.slice(0, action.path.lastIndexOf('/') + 1)}${name}`,
        );
      if (action.kind === 'delete') await DeleteRemotePath(id, action.path);
      setAction(undefined);
      await load(directory, undefined, true);
    } catch (e) {
      setError(e);
    } finally {
      setWorking(false);
    }
  }
  function keyDown(e: React.KeyboardEvent, entry: Entry, index: number) {
    if (
      e.nativeEvent.isComposing ||
      e.defaultPrevented ||
      (e.target as HTMLElement).closest('input,textarea,select,[role=menu]')
    )
      return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      setSelection(visibleEntries.map((e) => e.path));
    }
    if (e.key === ' ') {
      e.preventDefault();
      pick(entry.path, true, e.shiftKey);
    }
    if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      e.preventDefault();
      if (!selection.includes(entry.path)) pick(entry.path);
      setMenu(entry.path);
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
      e.preventDefault();
      const next =
        e.key === 'Home'
          ? 0
          : e.key === 'End'
            ? rows.length - 1
            : Math.max(0, Math.min(rows.length - 1, index + (e.key === 'ArrowDown' ? 1 : -1)));
      pick(rows[next].entry.path, false, e.shiftKey);
      focusEntry(rows[next].entry.path);
    }
    if (e.key === 'ArrowRight' && entry.directory) {
      e.preventDefault();
      if (!tree.expanded.has(entry.path)) toggle(entry.path);
      else if (rows[index + 1]?.parent === entry.path) {
        pick(rows[index + 1].entry.path);
        focusEntry(rows[index + 1].entry.path);
      }
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (entry.directory && tree.expanded.has(entry.path)) toggle(entry.path);
      else if (rows[index].parent !== '/') {
        pick(rows[index].parent);
        focusEntry(rows[index].parent);
      }
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      void open(entry);
    }
    if (e.key === 'F2' && selectedEntries.length <= 1 && !demoDirectories && !readOnly) {
      e.preventDefault();
      setError('');
      setAction({ kind: 'rename', path: entry.path });
    }
    if (e.key === 'Delete') {
      e.preventDefault();
      batchAction('delete', entry);
    }
  }
  const parent = directory.slice(0, directory.lastIndexOf('/')) || '/';
  const pathParts = directory.split('/').filter(Boolean);
  return (
    <aside
      ref={panel}
      className="file-panel"
      aria-label={translate('files:remoteFiles')}
      data-file-drop-target={
        readOnly || demoDirectories || !visible || !directory ? undefined : true
      }
      data-workspace-id={demoDirectories ? undefined : id}
      data-remote-directory={demoDirectories ? undefined : directory}
      onKeyDownCapture={(event) => {
        if (
          event.nativeEvent.isComposing ||
          event.repeat ||
          event.altKey ||
          !(event.ctrlKey || event.metaKey) ||
          !['c', 'v'].includes(event.key.toLowerCase()) ||
          (event.target as HTMLElement).closest(
            'input,textarea,select,[contenteditable=true],[role=dialog],[role=menu]',
          ) ||
          window.getSelection()?.toString()
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        void fileClipboard(event.key.toLowerCase() === 'c');
      }}
    >
      {onToggleReadOnly && (
        <button
          className="session-tool file-browse-mode"
          aria-pressed={readOnly}
          disabled={changingMode || working}
          onClick={onToggleReadOnly}
        >
          {readOnly
            ? translate('files:fileBrowsingModeAllowWrites')
            : translate('files:toggleFileBrowsingMode')}
        </button>
      )}
      <div className="sidebar-heading file-heading">
        <h2>{translate('files:files')}</h2>
        <Tooltip content={translate('files:newDirectory')}>
          <button
            className="icon-button"
            aria-label={translate('files:newDirectory')}
            disabled={readOnly || !directory || !!demoDirectories}
            onClick={() => {
              setError('');
              setAction({ kind: 'mkdir', path: directory });
            }}
          >
            <Icon name="plus" width="15" />
          </button>
        </Tooltip>
        <Tooltip content={translate('files:filterFiles')}>
          <button
            className="icon-button"
            aria-label={translate('files:filterFiles')}
            aria-pressed={filterOpen || !!filter}
            onClick={() => setFilterOpen((value) => !value)}
          >
            <Icon name="search" width="15" />
          </button>
        </Tooltip>
        <Dropdown>
          <DropdownTrigger>
            <Tooltip content={translate('files:fileViewOptions')}>
              <button className="icon-button" aria-label={translate('files:fileViewOptions')}>
                <Icon name="more" width="15" />
              </button>
            </Tooltip>
          </DropdownTrigger>
          <DropdownMenu
            aria-label={translate('files:fileViewOptions')}
            disabledKeys={
              demoDirectories
                ? ['upload', 'follow', 'terminal', 'sync']
                : readOnly || !directory
                  ? ['upload']
                  : []
            }
            onAction={(key) => {
              if (key === 'upload')
                window.dispatchEvent(
                  new CustomEvent('termquay:choose-upload', { detail: { id, directory } }),
                );
              if (key === 'follow') onFollowDirectory?.();
              if (key === 'terminal') onTerminalDirectory?.(directory);
              if (key === 'sync') setSyncOpen(true);
              if (key === 'copy')
                navigator.clipboard.writeText(directory).catch((error) => setError(error));
              if (key === 'hidden') setShowHidden((value) => !value);
              if (key === 'direction') setDescending((value) => !value);
              if (['name', 'modified', 'size'].includes(String(key))) setSort(String(key));
            }}
          >
            <DropdownItem key="upload" showDivider>
              {translate('files:uploadFiles')}
            </DropdownItem>
            <DropdownItem
              key="name"
              closeOnSelect={false}
              endContent={sort === 'name' ? '✓' : null}
            >
              {translate('files:sortByName')}
            </DropdownItem>
            <DropdownItem
              key="modified"
              closeOnSelect={false}
              endContent={sort === 'modified' ? '✓' : null}
            >
              {translate('files:sortByModificationTime')}
            </DropdownItem>
            <DropdownItem
              key="size"
              closeOnSelect={false}
              endContent={sort === 'size' ? '✓' : null}
            >
              {translate('files:sortBySize')}
            </DropdownItem>
            <DropdownItem key="direction" closeOnSelect={false}>
              {descending
                ? translate('files:switchToAscending')
                : translate('files:switchToDescending')}
            </DropdownItem>
            <DropdownItem
              key="hidden"
              closeOnSelect={false}
              endContent={showHidden ? '✓' : null}
              aria-label={translate('files:showHiddenFiles', {
                value1: showHidden ? translate('files:enabled') : translate('files:disabled'),
              })}
            >
              {translate('files:showHiddenFiles2')}
            </DropdownItem>
            <DropdownItem
              key="follow"
              closeOnSelect={false}
              endContent={followDirectory ? '✓' : null}
            >
              {translate('files:followTerminalDirectory')}
            </DropdownItem>
            <DropdownItem key="terminal" isDisabled={!directory}>
              {translate('files:locateDirectoryInTerminal')}
            </DropdownItem>
            <DropdownItem key="copy" isDisabled={!directory}>
              {translate('files:copyCurrentDirectoryPath')}
            </DropdownItem>
            <DropdownItem key="sync" isDisabled={!directory}>
              {translate('files:directorySync')}
            </DropdownItem>
          </DropdownMenu>
        </Dropdown>
        <Tooltip content={translate('files:collapseFilePanel')}>
          <button
            className="icon-button"
            aria-label={translate('files:collapseFilePanel')}
            onClick={onClose}
          >
            <Icon name="close" width="15" />
          </button>
        </Tooltip>
      </div>
      <div className="file-toolbar">
        <Tooltip content={translate('files:previousDirectory')}>
          <button
            className="icon-button"
            aria-label={translate('files:previousDirectory')}
            disabled={loading || history.index <= 0}
            onClick={() => void load(history.paths[history.index - 1], history.index - 1)}
          >
            <Icon name="back" width="15" />
          </button>
        </Tooltip>
        <Tooltip content={translate('files:nextDirectory')}>
          <button
            className="icon-button"
            aria-label={translate('files:nextDirectory')}
            disabled={loading || history.index >= history.paths.length - 1}
            onClick={() => void load(history.paths[history.index + 1], history.index + 1)}
          >
            <Icon name="back" width="15" style={{ transform: 'rotate(180deg)' }} />
          </button>
        </Tooltip>
        <Tooltip content={translate('files:parentDirectory')}>
          <button
            className="icon-button"
            aria-label={translate('files:parentDirectory')}
            disabled={loading || directory === '/'}
            onClick={() => void load(parent)}
          >
            <Icon name="up" width="15" />
          </button>
        </Tooltip>
        <Tooltip content={translate('files:refreshDirectory')}>
          <button
            className="icon-button"
            aria-label={translate('files:refreshDirectory')}
            disabled={loading}
            onClick={() => void load(directory, undefined, true)}
          >
            <Icon name="refresh" width="15" />
          </button>
        </Tooltip>
        <Dropdown>
          <DropdownTrigger>
            <Tooltip content={translate('files:directoryBookmarks')}>
              <button
                className="icon-button"
                disabled={bookmarkSaving || !directory}
                aria-label={translate('files:directoryBookmarks')}
              >
                <Icon name="bookmark" width="15" />
              </button>
            </Tooltip>
          </DropdownTrigger>
          <DropdownMenu
            aria-label={translate('files:directoryBookmarks')}
            items={[
              {
                key: 'toggle',
                name: bookmarks.includes(directory)
                  ? translate('files:removeCurrentDirectoryBookmark')
                  : translate('files:bookmarkCurrentDirectory'),
              },
              ...bookmarks.map((path) => ({ key: path, name: path })),
            ]}
            onAction={(key) => {
              if (key === 'toggle') void toggleBookmark();
              else void load(String(key));
            }}
          >
            {(item) => <DropdownItem key={item.key}>{item.name}</DropdownItem>}
          </DropdownMenu>
        </Dropdown>
        <Tooltip content={translate('files:pasteFiles')}>
          <button
            className={`icon-button${clipboardCopied ? ' clipboard-ready' : ''}`}
            aria-label={translate('files:pasteFiles')}
            disabled={readOnly || !directory || working || clipboardBusy || !!demoDirectories}
            onClick={() => void fileClipboard(false)}
          >
            <Icon name="paste" width="15" />
          </button>
        </Tooltip>
      </div>
      {editingPath ? (
        <form
          className="path-form"
          onSubmit={(e) => {
            e.preventDefault();
            void load(String(new FormData(e.currentTarget).get('path')));
            setEditingPath(false);
          }}
        >
          <input
            name="path"
            aria-label={translate('files:remoteDirectory')}
            defaultValue={directory}
            autoFocus
            onFocus={(e) => e.target.select()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setEditingPath(false);
            }}
            onBlur={() => setEditingPath(false)}
          />
        </form>
      ) : (
        <div className="path-bar">
          <div className="breadcrumbs" aria-label={directory}>
            <button onClick={() => void load('/')} aria-label={translate('files:rootDirectory')}>
              /
            </button>
            {pathParts.length > 2 && (
              <Dropdown>
                <DropdownTrigger>
                  <button aria-label={translate('files:parentDirectories')}>…</button>
                </DropdownTrigger>
                <DropdownMenu
                  aria-label={translate('files:parentDirectories')}
                  onAction={(key) => void load(String(key))}
                >
                  {pathParts.slice(0, -2).map((part, index) => (
                    <DropdownItem key={`/${pathParts.slice(0, index + 1).join('/')}`}>
                      {part}
                    </DropdownItem>
                  ))}
                </DropdownMenu>
              </Dropdown>
            )}
            {pathParts.slice(-2).map((part, index) => {
              const path = `/${pathParts.slice(0, Math.max(0, pathParts.length - 2) + index + 1).join('/')}`;
              return (
                <Tooltip key={path} content={path}>
                  <button onClick={() => void load(path)}>
                    {part}
                    <span>/</span>
                  </button>
                </Tooltip>
              );
            })}
          </div>
          <Tooltip content={translate('files:editDirectoryPath', { value1: directory })}>
            <button
              className="path-edit"
              aria-label={translate('files:editDirectoryPath2')}
              onClick={() => setEditingPath(true)}
            >
              <Icon name="edit" width="13" />
            </button>
          </Tooltip>
        </div>
      )}
      {!batch && (!action || action.kind === 'rename') && (
        <ErrorNotice message={error} onDismiss={() => setError('')} className="file-error" />
      )}
      {directoryFailure && (
        <ErrorNotice message={errorMessage(directoryFailure.message)} className="file-error">
          <button className="session-tool" onClick={() => void load(directoryFailure.path)}>
            {translate('files:retryReadingDirectory')}
          </button>
        </ErrorNotice>
      )}
      <div className="file-filters" hidden={!filterOpen && !filter}>
        <input
          aria-label={translate('files:filterFileNamesInExpandedDirectories')}
          placeholder={translate('files:filterExpandedDirectories')}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && !e.nativeEvent.isComposing) {
              setFilter('');
              setFilterOpen(false);
            }
          }}
        />
        <button
          className="session-tool"
          disabled={!directory || !!demoDirectories || !onOpenFile}
          onClick={() => setSearchOpen(true)}
        >
          {translate('files:recursiveSearch')}
        </button>
      </div>
      {(loading || root?.loading) && (
        <p className="muted" role="status">
          {translate('files:reading')}
        </p>
      )}
      <div
        className="file-selection"
        style={{ visibility: selectedEntries.length ? 'visible' : 'hidden' }}
      >
        <label>
          <input
            type="checkbox"
            aria-label={translate('files:selectAllVisibleFiles')}
            checked={!!visibleEntries.length && selectedEntries.length === visibleEntries.length}
            onChange={(e) =>
              setSelection(e.target.checked ? visibleEntries.map((e) => e.path) : [])
            }
          />
          {selectedEntries.length} {translate('files:items')}
        </label>
        <button
          disabled={
            working || clipboardBusy || !!demoDirectories || !selectedEntries.every(regular)
          }
          onClick={() => void fileClipboard(true)}
        >
          {translate('files:copy')}
        </button>
        <button
          disabled={working || !!demoDirectories || !selectedEntries.every(regular)}
          onClick={() => batchAction('download')}
        >
          {translate('files:download')}
        </button>
        <Dropdown>
          <DropdownTrigger>
            <button className="icon-button" aria-label={translate('files:selectedFileActions')}>
              <Icon name="more" width="15" />
            </button>
          </DropdownTrigger>
          <DropdownMenu
            aria-label={translate('files:selectedFileActions')}
            disabledKeys={
              working || demoDirectories || readOnly
                ? ['move', 'delete']
                : selectedEntries.some((e) => !regular(e) && !e.directory && !e.symlink)
                  ? ['move']
                  : []
            }
            onAction={(key) => batchAction(key as 'move' | 'delete')}
          >
            <DropdownItem key="move">{translate('files:move')}</DropdownItem>
            <DropdownItem key="delete" color="danger">
              {translate('files:delete')}
            </DropdownItem>
          </DropdownMenu>
        </Dropdown>
      </div>
      {!!results.length && (
        <details className="file-results" open>
          <summary>
            {translate('files:batchOperationResults')}
            <button
              aria-label={translate('files:closeBatchResults')}
              onClick={(e) => {
                e.preventDefault();
                setResults([]);
              }}
            >
              ×
            </button>
          </summary>
          {results.map((result, index) => (
            <p
              key={index}
              className={['failed', 'not_run'].includes(result.state) ? 'error' : 'muted'}
            >
              {
                (
                  {
                    done: translate('files:completed'),
                    queued: translate('files:queued'),
                    failed: translate('files:failed'),
                    skipped: translate('files:skipped'),
                    not_run: translate('files:notExecuted'),
                  } as Record<string, string>
                )[result.state]
              }{' '}
              · {result.path}
              {errorMessage(eventError(result)) && ` · ${errorMessage(eventError(result))}`}
            </p>
          ))}
        </details>
      )}
      <ul
        className="file-list file-tree"
        ref={list}
        role="tree"
        aria-label={translate('files:remoteDirectoryTree')}
        aria-multiselectable="true"
      >
        {rows.map(({ entry, depth, parent, position, siblings }, index) => (
          <Fragment key={entry.path}>
            <Tooltip
              placement="right"
              isDisabled={!visible || menu === entry.path || !!action || !!batch}
              content={<FileMetadata entry={entry} />}
            >
              <li
                role="treeitem"
                aria-label={entry.name}
                aria-level={depth + 1}
                aria-posinset={position}
                aria-setsize={siblings}
                aria-expanded={entry.directory ? tree.expanded.has(entry.path) : undefined}
                aria-selected={selection.includes(entry.path)}
                data-tree-path={entry.path}
                data-file-drop-target={readOnly || demoDirectories || !visible ? undefined : true}
                data-workspace-id={demoDirectories ? undefined : id}
                data-remote-directory={
                  demoDirectories ? undefined : entry.directory ? entry.path : parent
                }
                tabIndex={
                  focusedVisible ? (selected === entry.path ? 0 : -1) : index === 0 ? 0 : -1
                }
                style={{ paddingInlineStart: 4 + depth * 14 }}
                className={`${selection.includes(entry.path) ? 'selected' : ''}${tree.recentPaths.has(entry.path) ? ' file-uploaded' : ''}`}
                onKeyDown={(e) => keyDown(e, entry, index)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (!selection.includes(entry.path)) pick(entry.path);
                  setMenu(entry.path);
                }}
              >
                {entry.directory ? (
                  <button
                    className="tree-expand"
                    tabIndex={-1}
                    aria-label={translate('files:directory', {
                      value1: tree.expanded.has(entry.path)
                        ? translate('connections:collapse')
                        : translate('connections:expand'),
                      value2: entry.path,
                    })}
                    aria-expanded={tree.expanded.has(entry.path)}
                    onClick={() => toggle(entry.path)}
                  >
                    <Icon
                      name="chevron"
                      width="11"
                      height="11"
                      style={{
                        transform: tree.expanded.has(entry.path) ? 'rotate(90deg)' : undefined,
                      }}
                    />
                  </button>
                ) : (
                  <span className="tree-expand" />
                )}
                {action?.kind === 'rename' && action.path === entry.path ? (
                  <form
                    className="inline-rename"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void perform(String(new FormData(e.currentTarget).get('name')));
                    }}
                  >
                    <input
                      aria-label={translate('files:newName')}
                      name="name"
                      defaultValue={entry.name}
                      required
                      pattern="[^/]+"
                      autoFocus
                      disabled={working}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          setAction(undefined);
                          setError('');
                        }
                      }}
                    />
                    <Button type="submit" size="sm" isLoading={working}>
                      {translate('files:save')}
                    </Button>
                    <button
                      aria-label={translate('files:cancelRename')}
                      type="button"
                      onClick={() => {
                        setAction(undefined);
                        setError('');
                      }}
                    >
                      <Icon name="close" width="14" />
                    </button>
                  </form>
                ) : (
                  <>
                    <button
                      className="file-name"
                      tabIndex={-1}
                      aria-pressed={selection.includes(entry.path)}
                      onClick={(e) => {
                        pick(entry.path, e.ctrlKey || e.metaKey, e.shiftKey);
                        if (
                          entry.directory &&
                          !e.ctrlKey &&
                          !e.metaKey &&
                          !e.shiftKey &&
                          e.detail < 2
                        )
                          toggle(entry.path);
                      }}
                      onDoubleClick={() => {
                        if (!entry.directory) void open(entry);
                      }}
                    >
                      <FileIcon {...entry} expanded={tree.expanded.has(entry.path)} />
                      <span className="file-entry-name">{entry.name}</span>
                      {entry.symlink && (
                        <span className="file-link-target">
                          → {entry.link_target || translate('files:cannotReadDestination')}
                        </span>
                      )}
                    </button>
                    <span className="file-metadata">
                      {entry.directory ? '' : entry.size.toLocaleString(currentLocale())}
                    </span>
                    <span className="file-metadata">
                      {new Date(entry.modified).toLocaleDateString(currentLocale())}
                    </span>
                    <span className="file-metadata">{entry.mode}</span>
                    <Dropdown
                      isOpen={menu === entry.path}
                      onOpenChange={(open) => setMenu(open ? entry.path : '')}
                    >
                      <DropdownTrigger>
                        <button
                          className="icon-button row-menu"
                          aria-label={translate('files:actions', { value1: entry.name })}
                        >
                          <Icon name="more" width="16" />
                        </button>
                      </DropdownTrigger>
                      <DropdownMenu
                        aria-label={translate('files:actions', { value1: entry.name })}
                        disabledKeys={
                          readOnly
                            ? ['move', 'rename', 'delete']
                            : working
                              ? [
                                  'open',
                                  'image',
                                  'text',
                                  'log',
                                  'download',
                                  'move',
                                  'rename',
                                  'delete',
                                ]
                              : demoDirectories
                                ? ['image', 'log', 'download', 'move', 'rename', 'delete']
                                : []
                        }
                        onAction={(key) => {
                          if (
                            demoDirectories &&
                            ['image', 'log', 'download', 'move', 'rename', 'delete'].includes(
                              String(key),
                            )
                          )
                            return;
                          setError('');
                          const multiple =
                            selectedEntries.length > 1 && selection.includes(entry.path);
                          if (key === 'log') setLogPath(entry.path);
                          if (key === 'open') void open(entry);
                          if (key === 'image') void open(entry, 'image');
                          if (key === 'text') void open(entry, 'text');
                          if (key === 'download') {
                            if (multiple) batchAction('download', entry);
                            else StartDownload(id, entry.path).catch((e) => setError(e));
                          }
                          if (key === 'move' || key === 'delete') batchAction(key, entry);
                          if (key === 'copy')
                            navigator.clipboard.writeText(entry.path).catch((e) => setError(e));
                          if (key === 'rename') setAction({ kind: 'rename', path: entry.path });
                        }}
                      >
                        <DropdownItem key="open">{translate('files:open')}</DropdownItem>
                        <DropdownItem key="image" className={entry.directory ? 'hidden' : ''}>
                          {translate('files:previewAsImage')}
                        </DropdownItem>
                        <DropdownItem key="text" className={entry.directory ? 'hidden' : ''}>
                          {translate('files:openAsText')}
                        </DropdownItem>
                        <DropdownItem key="log" isDisabled={!regular(entry)}>
                          {translate('files:viewLogsLargeFile')}
                        </DropdownItem>
                        <DropdownItem
                          key="download"
                          isDisabled={
                            selection.includes(entry.path)
                              ? !selectedEntries.every(regular)
                              : !regular(entry)
                          }
                        >
                          {translate('files:download')}
                        </DropdownItem>
                        <DropdownItem
                          key="move"
                          isDisabled={
                            selection.includes(entry.path)
                              ? selectedEntries.some(
                                  (e) => !regular(e) && !e.directory && !e.symlink,
                                )
                              : !regular(entry) && !entry.directory && !entry.symlink
                          }
                        >
                          {translate('files:moveToDirectory')}
                        </DropdownItem>
                        <DropdownItem key="copy">{translate('files:copyFullPath')}</DropdownItem>
                        <DropdownItem
                          key="rename"
                          isDisabled={selectedEntries.length > 1 && selection.includes(entry.path)}
                        >
                          {translate('files:rename')}
                        </DropdownItem>
                        <DropdownItem key="delete" color="danger">
                          {translate('files:delete')}
                        </DropdownItem>
                      </DropdownMenu>
                    </Dropdown>
                  </>
                )}
              </li>
            </Tooltip>
            {entry.directory && tree.expanded.has(entry.path) && (
              <>
                {tree.nodes[entry.path]?.loading && (
                  <li
                    role="none"
                    className="tree-message"
                    style={{ paddingInlineStart: 22 + (depth + 1) * 14 }}
                  >
                    <span role="status">{translate('files:reading')}</span>
                  </li>
                )}
                {errorMessage(eventError(tree.nodes[entry.path])) && (
                  <li
                    role="none"
                    className="tree-message error"
                    style={{ paddingInlineStart: 22 + (depth + 1) * 14 }}
                  >
                    <details>
                      <summary>{translate('files:couldNotReadDirectory')}</summary>
                      {errorMessage(eventError(tree.nodes[entry.path]))}
                    </details>
                    <button
                      aria-label={translate('files:retryReading', { value1: entry.path })}
                      onClick={() => void tree.read(entry.path, true).catch(() => {})}
                    >
                      {translate('files:retry')}
                    </button>
                  </li>
                )}
                {!tree.nodes[entry.path]?.loading &&
                  !errorMessage(eventError(tree.nodes[entry.path])) &&
                  tree.nodes[entry.path]?.entries?.length === 0 && (
                    <li
                      role="none"
                      className="tree-message"
                      style={{ paddingInlineStart: 22 + (depth + 1) * 14 }}
                    >
                      {translate('files:emptyDirectory')}
                    </li>
                  )}
              </>
            )}
          </Fragment>
        ))}
      </ul>
      {root?.entries && !root.loading && !loading && !error && visibleEntries.length === 0 && (
        <p className="sidebar-empty">
          {root.entries.length === 0
            ? translate('files:emptyDirectory')
            : filter
              ? translate('files:noMatchingFiles')
              : translate('files:noVisibleFiles')}
        </p>
      )}
      <Modal
        isOpen={!!batch}
        onClose={() => {
          if (!working) {
            setBatch(undefined);
            setError('');
          }
        }}
        isDismissable={!working}
        isKeyboardDismissDisabled={working}
        className="app-dialog"
      >
        <ModalContent>
          <ModalHeader>
            {batch?.kind === 'download'
              ? translate('files:download')
              : batch?.kind === 'move'
                ? translate('files:move')
                : translate('files:delete')}{' '}
            {batch?.paths.length} {translate('files:items')}
          </ModalHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void performBatch(String(new FormData(e.currentTarget).get('directory') || ''));
            }}
          >
            <ModalBody>
              <ul className="batch-paths">
                {batch?.paths.map((path) => (
                  <li className="file-path" key={path}>
                    {path}
                  </li>
                ))}
              </ul>
              {batch?.kind === 'download' && (
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={overwrite}
                    disabled={working}
                    onChange={(e) => setOverwrite(e.target.checked)}
                  />
                  {translate('files:overwriteRegularFilesWithMatchingNames')}
                </label>
              )}
              {batch?.kind === 'move' && (
                <label className="form-field">
                  {translate('files:remoteDestinationDirectory')}
                  <input
                    className="native-input"
                    name="directory"
                    aria-label={translate('files:remoteDestinationDirectory')}
                    required
                    defaultValue={directory}
                    disabled={working}
                  />
                </label>
              )}
              {batch?.kind === 'delete' && (
                <>
                  <p className="error">{translate('files:theDirectoryAndAllItsContentsWillBe')}</p>
                  {working && (
                    <p role="status" className="file-path">
                      {deleteProgress || translate('files:scanningDeletionScope')}
                    </p>
                  )}
                </>
              )}
              {error && (
                <p role="alert" className="error">
                  {error}
                </p>
              )}
            </ModalBody>
            <ModalFooter>
              {working && batch?.kind === 'delete' ? (
                <Button variant="light" onPress={() => deletion.current?.cancel()}>
                  {translate('files:stopDeleting')}
                </Button>
              ) : (
                <Button
                  variant="light"
                  isDisabled={working}
                  onPress={() => {
                    setBatch(undefined);
                    setError('');
                  }}
                >
                  {translate('files:cancel')}
                </Button>
              )}
              <Button
                type="submit"
                color={batch?.kind === 'delete' ? 'danger' : 'primary'}
                isLoading={working}
              >
                {batch?.kind === 'download'
                  ? translate('files:selectDownloadDirectory')
                  : batch?.kind === 'move'
                    ? translate('files:move')
                    : translate('files:delete')}
              </Button>
            </ModalFooter>
          </form>
        </ModalContent>
      </Modal>
      {syncOpen && (
        <DirectorySyncDialog
          key={id}
          id={id}
          remote={directory}
          connectionID={connectionID}
          onClose={() => setSyncOpen(false)}
        />
      )}
      {logPath && (
        <RemoteLogDialog
          key={`${id}:${logPath}`}
          workspace={id}
          path={logPath}
          visible={visible}
          onClose={() => setLogPath('')}
        />
      )}
      {searchOpen && visible && (
        <Suspense
          fallback={
            <p role="status" className="muted">
              {translate('files:loadingSearch')}
            </p>
          }
        >
          <FileSearchDialog
            key={id}
            workspace={id}
            directory={directory}
            onClose={() => setSearchOpen(false)}
            onOpen={async (match) => {
              if (match.directory) await load(match.path);
              else await onOpenFile?.(match.path, match.line || 1);
            }}
          />
        </Suspense>
      )}
      <Modal
        isOpen={!!action && action.kind !== 'rename'}
        onClose={() => {
          if (!working) {
            setAction(undefined);
            setError('');
          }
        }}
        className="app-dialog"
      >
        <ModalContent>
          <ModalHeader>
            {action?.kind === 'mkdir'
              ? translate('files:newDirectory')
              : translate('files:deleteRemotePaths')}
          </ModalHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void perform(String(new FormData(e.currentTarget).get('name') || ''));
            }}
          >
            <ModalBody>
              {action?.kind === 'delete' ? (
                <p>{translate('files:confirmDeletePath', { path: action.path })}</p>
              ) : (
                <label className="form-field">
                  {translate('files:directoryName')}
                  <input
                    className="native-input"
                    name="name"
                    aria-label={translate('files:directoryName')}
                    required
                    pattern="[^/]+"
                    autoFocus
                  />
                </label>
              )}
              {error && (
                <p role="alert" className="error">
                  {error}
                </p>
              )}
            </ModalBody>
            <ModalFooter>
              <Button
                variant="light"
                isDisabled={working}
                onPress={() => {
                  setAction(undefined);
                  setError('');
                }}
              >
                {translate('files:cancel')}
              </Button>
              <Button
                type="submit"
                color={action?.kind === 'delete' ? 'danger' : 'primary'}
                isLoading={working}
              >
                {action?.kind === 'delete' ? translate('files:delete') : translate('files:create')}
              </Button>
            </ModalFooter>
          </form>
        </ModalContent>
      </Modal>
    </aside>
  );
}
