import { useEffect, useRef, useState } from 'react';
import { ReadDirectory } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { Directory, Entry } from '../../../bindings/github.com/Sanjeever/termquay/internal/files/models';
import { directoryAncestors, inDirectory, maxExpandedDirectories, type TreeDirectory } from './fileTree';

type Read = { workspace: string; path: string; promise: Promise<Directory>; resolve(value: Directory): void; reject(error: unknown): void; request?: ReturnType<typeof ReadDirectory> };

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

  function update(path: string, value: TreeDirectory) {
    nodeState.current = { ...nodeState.current, [path]: value };
    setNodes(nodeState.current);
  }
  function changeExpansion(value: Set<string>) { expansion.current = value; setExpanded(value); }
  function cancel(path: string) {
    const operation = reads.current.get(path);
    if (!operation) return;
    reads.current.delete(path); queue.current = queue.current.filter(read => read !== operation);
    operation.request?.cancel(); operation.reject(new Error('目录读取已取消'));
  }
  function pump() {
    while (shown.current && running.current < 2 && queue.current.length) {
      const operation = queue.current.shift()!;
      if (reads.current.get(operation.path) !== operation) continue;
      running.current++;
      let request: Promise<Directory>;
      if(demoDirectories) { const entries=demoDirectories[operation.path];request=entries ? Promise.resolve({path:operation.path,entries}) : Promise.reject(new Error('演示目录不存在')); }
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
        reads.current.delete(operation.path);
        operation.resolve(value);
      }).catch(error => {
        if (reads.current.get(operation.path) !== operation) return;
        update(operation.path, { ...nodeState.current[operation.path], loading: false, error: String(error) });
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
    if (!shown.current) return Promise.reject(new Error('文件面板已收起'));
    if (force) cancel(path);
    const pending = reads.current.get(path); if (pending) return pending.promise;
    const existing = nodeState.current[path];
    if (!force && existing?.entries && !existing.error) return Promise.resolve({ path, entries: existing.entries });
    let resolve!: Read['resolve']; let reject!: Read['reject'];
    const promise = new Promise<Directory>((done, fail) => { resolve = done; reject = fail; });
    const operation = { workspace: id, path, promise, resolve, reject };
    reads.current.set(path, operation); queue.current.push(operation);
    update(path, { ...existing, loading: true, error: '' }); pump();
    return promise;
  }
  async function reveal(path: string, force = false) {
    const epoch = generation.current;
    if (!expansion.current.has(navigation.current.path)) cancel(navigation.current.path);
    const sequence = navigation.current.sequence + 1; navigation.current = { sequence, path };
    const result = await read(path, force);
    if (epoch !== generation.current || sequence !== navigation.current.sequence) throw new Error('目录读取已取消');
    const ancestors = directoryAncestors(result.path);
    const next = new Set([...expansion.current, ...ancestors]);
    if (next.size > maxExpandedDirectories) {
      if (!expansion.current.has(result.path)) { const remaining = { ...nodeState.current }; delete remaining[result.path]; nodeState.current = remaining; setNodes(remaining); }
      throw new Error(`已展开目录达到上限（${maxExpandedDirectories} 个），请先收起其他目录`);
    }
    changeExpansion(next);
    for (const ancestor of ancestors) {
      if (epoch !== generation.current || sequence !== navigation.current.sequence) throw new Error('目录读取已取消');
      if (ancestor !== result.path) await read(ancestor);
    }
    return result;
  }
  function collapse(path: string) {
    changeExpansion(new Set([...expansion.current].filter(value => !inDirectory(value, path))));
    for (const value of reads.current.keys()) if (inDirectory(value, path)) cancel(value);
    nodeState.current = Object.fromEntries(Object.entries(nodeState.current).filter(([value]) => !inDirectory(value, path)));
    setNodes(nodeState.current);
  }
  async function expand(path: string) {
    if (!expansion.current.has(path)) {
      if (expansion.current.size >= maxExpandedDirectories) throw new RangeError(`已展开目录达到上限（${maxExpandedDirectories} 个），请先收起其他目录`);
      changeExpansion(new Set([...expansion.current, path]));
    }
    await read(path);
  }
  async function refresh() {
    await read('/', true);
    await Promise.all([...expansion.current].filter(path => path !== '/').map(async path => { try { await read(path, true); } catch (error) { if (expansion.current.has(path)) throw error; } }));
  }

  useEffect(() => {
    generation.current++; changeExpansion(new Set(['/'])); nodeState.current = {}; setNodes({});
    return () => { generation.current++; for (const path of reads.current.keys()) cancel(path); };
  }, [id]);
  useEffect(() => {
    if (visible) { for (const path of expansion.current) if (!nodeState.current[path]?.entries) void read(path).catch(() => {}); pump(); }
    else {
      generation.current++; for (const path of reads.current.keys()) cancel(path);
      nodeState.current = Object.fromEntries(Object.entries(nodeState.current).map(([path, node]) => [path, { ...node, loading: false }])); setNodes(nodeState.current);
    }
  }, [visible, id]);
  return { nodes, expanded, read, reveal, collapse, expand, refresh };
}
