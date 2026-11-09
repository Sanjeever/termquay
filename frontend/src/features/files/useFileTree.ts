import { t as translate } from '../../i18n/index.ts';
import { message as uiMessage } from '../../i18n/messages.ts';

import { useEffect, useRef, useState } from 'react';
import { Events } from '@wailsio/runtime';
import { ReadDirectory } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { Directory, Entry } from '../../../bindings/github.com/Sanjeever/termquay/internal/files/models';
import type { Transfer } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import { directoryAncestors, inDirectory, maxExpandedDirectories, uploadRefreshPaths, type TreeDirectory } from './fileTree';

type Read = { workspace: string; path: string; version: number; promise: Promise<Directory>; resolve(value: Directory): void; reject(error: unknown): void; request?: ReturnType<typeof ReadDirectory> };

export default function useFileTree(id: string, visible: boolean, demoDirectories?: Record<string, Entry[]>) {
  const [nodes, setNodes] = useState<Record<string, TreeDirectory>>({});
  const [expanded, setExpanded] = useState(new Set(['/']));
  const nodeState = useRef(nodes); nodeState.current = nodes;
  const expansion = useRef(expanded); expansion.current = expanded;
  const reads = useRef(new Map<string, Read>());
  const queue = useRef<Read[]>([]);
  const running = useRef(0);
  const shown = useRef(visible); shown.current = visible;
  const generation = useRef(0);
  const navigation = useRef<{ sequence: number; path: string }>({ sequence: 0, path: '' });
  const invalidated = useRef(new Map<string, number>());
  const refreshTimer = useRef<ReturnType<typeof setTimeout>>();
  const highlightTimer = useRef<ReturnType<typeof setTimeout>>();
  const [recentPaths, setRecentPaths] = useState(new Set<string>());

  function scheduleRefresh() {
    if (!shown.current || refreshTimer.current) return;
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = undefined;
      for (const path of invalidated.current.keys()) {
        if (expansion.current.has(path) && !reads.current.has(path)) void read(path).catch(() => {});
      }
    }, 300);
  }

  function update(path: string, value: TreeDirectory) {
    nodeState.current = { ...nodeState.current, [path]: value };
    setNodes(nodeState.current);
  }
  function changeExpansion(value: Set<string>) { expansion.current = value; setExpanded(value); }
  function cancel(path: string) {
    const operation = reads.current.get(path);
    if (!operation) return;
    reads.current.delete(path); queue.current = queue.current.filter(read => read !== operation);
    operation.request?.cancel(); operation.reject(uiMessage('files:directoryReadCanceled'));
  }
  function pump() {
    while (shown.current && running.current < 2 && queue.current.length) {
      const operation = queue.current.shift()!;
      if (reads.current.get(operation.path) !== operation) continue;
      running.current++;
      let request: Promise<Directory>;
      if(demoDirectories) { const entries=demoDirectories[operation.path];request=entries ? Promise.resolve({path:operation.path,entries}) : Promise.reject(uiMessage('files:demoDirectoryDoesNotExist')); }
      else { const remote=ReadDirectory(operation.workspace, operation.path);operation.request=remote;request=remote; }
      request.then(value => {
        if (reads.current.get(operation.path) !== operation) return;
        const directories = new Set((value.entries || []).filter(entry => entry.directory).map(entry => entry.path));
        for (const path of expansion.current) {
          if (path === value.path || !inDirectory(path, value.path)) continue;
          const prefix = value.path === '/' ? '/' : `${value.path}/`;
          const child = prefix + path.slice(prefix.length).split('/')[0];
          if (!directories.has(child)) collapse(child);
        }
        if (operation.path !== value.path) { const next = { ...nodeState.current }; delete next[operation.path]; nodeState.current = next; }
        update(value.path, { entries: value.entries || [], loading: false, error: '' });
        if ((invalidated.current.get(operation.path) || 0) === operation.version) invalidated.current.delete(operation.path);
        else scheduleRefresh();
        reads.current.delete(operation.path);
        operation.resolve(value);
      }).catch(error => {
        if (reads.current.get(operation.path) !== operation) return;
        invalidated.current.delete(operation.path);
        update(operation.path, { ...nodeState.current[operation.path], loading: false, error: nodeState.current[operation.path]?.entries ? [uiMessage('files:couldNotRefreshDirectory'), error] : error });
        reads.current.delete(operation.path);
        operation.reject(error);
      }).finally(() => {
        running.current--;
        if (reads.current.get(operation.path) === operation) reads.current.delete(operation.path);
        pump();
      });
    }
  }
  function read(path: string, force = false): Promise<Directory> {
    if (!shown.current) return Promise.reject(uiMessage('files:filePanelCollapsed'));
    if (force) cancel(path);
    const pending = reads.current.get(path); if (pending) return pending.promise;
    const existing = nodeState.current[path];
    if (!force && !invalidated.current.has(path) && existing?.entries && !existing.error) return Promise.resolve({ path, entries: existing.entries });
    let resolve!: Read['resolve']; let reject!: Read['reject'];
    const promise = new Promise<Directory>((done, fail) => { resolve = done; reject = fail; });
    const operation = { workspace: id, path, version: invalidated.current.get(path) || 0, promise, resolve, reject };
    reads.current.set(path, operation); queue.current.push(operation);
    update(path, { ...existing, loading: true, error: '' }); pump();
    return promise;
  }
  async function reveal(path: string, force = false) {
    const epoch = generation.current;
    if (!expansion.current.has(navigation.current.path)) cancel(navigation.current.path);
    const sequence = navigation.current.sequence + 1; navigation.current = { sequence, path };
    const result = await read(path, force);
    if (epoch !== generation.current || sequence !== navigation.current.sequence) throw uiMessage('files:directoryReadCanceled');
    const ancestors = directoryAncestors(result.path);
    const next = new Set([...expansion.current, ...ancestors]);
    if (next.size > maxExpandedDirectories) {
      if (!expansion.current.has(result.path)) { const remaining = { ...nodeState.current }; delete remaining[result.path]; nodeState.current = remaining; setNodes(remaining); }
      throw uiMessage('files:expandedDirectoryLimitReachedCollapseOtherDirectoriesFirst', { value1: maxExpandedDirectories });
    }
    changeExpansion(next);
    for (const ancestor of ancestors) {
      if (epoch !== generation.current || sequence !== navigation.current.sequence) throw uiMessage('files:directoryReadCanceled');
      if (ancestor !== result.path) await read(ancestor);
    }
    return result;
  }
  function collapse(path: string) {
    changeExpansion(new Set([...expansion.current].filter(value => !inDirectory(value, path))));
    for (const value of reads.current.keys()) if (inDirectory(value, path)) cancel(value);
    for (const value of invalidated.current.keys()) if (inDirectory(value, path)) invalidated.current.delete(value);
    nodeState.current = Object.fromEntries(Object.entries(nodeState.current).filter(([value]) => !inDirectory(value, path)));
    setNodes(nodeState.current);
  }
  async function expand(path: string) {
    if (!expansion.current.has(path)) {
      if (expansion.current.size >= maxExpandedDirectories) throw new RangeError(translate('files:expandedDirectoryLimitReachedCollapseOtherDirectoriesFirst', { value1: maxExpandedDirectories }));
      changeExpansion(new Set([...expansion.current, path]));
    }
    await read(path);
  }
  async function refresh() {
    await read('/', true);
    await Promise.all([...expansion.current].filter(path => path !== '/').map(async path => { try { await read(path, true); } catch (error) { if (expansion.current.has(path)) throw error; } }));
  }

  useEffect(() => {
    invalidated.current.clear(); setRecentPaths(new Set());
    generation.current++; changeExpansion(new Set(['/'])); nodeState.current = {}; setNodes({});
    const off = demoDirectories ? () => {} : Events.On('transfer:changed', event => {
      const task = event.data as Transfer;
      if (task.workspace !== id) return;
      const paths = uploadRefreshPaths(task, Object.keys(nodeState.current));
      for (const path of paths) invalidated.current.set(path, (invalidated.current.get(path) || 0) + 1);
      if (task.state === 'done' && task.direction === 'upload' && !task.directory) {
        setRecentPaths(previous => new Set([...previous, task.destination_path].slice(-64)));
        clearTimeout(highlightTimer.current);
        highlightTimer.current = setTimeout(() => setRecentPaths(new Set()), 5000);
      }
      if (paths.length) scheduleRefresh();
    });
    return () => { off(); clearTimeout(refreshTimer.current); refreshTimer.current = undefined; clearTimeout(highlightTimer.current); generation.current++; for (const path of reads.current.keys()) cancel(path); };
  }, [id]);
  useEffect(() => {
    if (visible) { for (const path of expansion.current) if (!nodeState.current[path]?.entries || invalidated.current.has(path)) void read(path).catch(() => {}); pump(); }
    else {
      generation.current++; for (const path of reads.current.keys()) cancel(path);
      nodeState.current = Object.fromEntries(Object.entries(nodeState.current).map(([path, node]) => [path, { ...node, loading: false }])); setNodes(nodeState.current);
    }
  }, [visible, id]);
  return { nodes, expanded, recentPaths, read, reveal, collapse, expand, refresh };
}
