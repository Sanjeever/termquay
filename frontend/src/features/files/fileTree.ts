import type { Entry } from '../../../bindings/github.com/Sanjeever/termquay/internal/files/models';
import type { Transfer } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';

export type TreeDirectory = { entries?: Entry[]; loading: boolean; error: string };
export type FileTreeRow = { entry: Entry; depth: number; parent: string; position: number; siblings: number };
export const maxExpandedDirectories = 64;

export function directoryAncestors(path: string) {
  return ['/', ...path.split('/').filter(Boolean).map((_, index, parts) => `/${parts.slice(0, index + 1).join('/')}`)];
}

export function inDirectory(path: string, parent: string) {
  return path === parent || path.startsWith(parent === '/' ? '/' : `${parent}/`);
}

export function uploadRefreshPaths(task: Pick<Transfer, 'state' | 'direction' | 'destination_path' | 'directory'>, cached: string[]) {
  if (task.state !== 'done' || task.direction !== 'upload' || !task.destination_path) return [];
  const directory = task.directory ? task.destination_path : task.destination_path.slice(0, task.destination_path.lastIndexOf('/')) || '/';
  return cached.filter(path => task.directory ? inDirectory(path, directory) : path === directory);
}

export function fileTreeRows(nodes: Record<string, TreeDirectory>, expanded: ReadonlySet<string>, options: { filter: string; showHidden: boolean; sort: string; descending: boolean }) {
  const query = options.filter.trim().toLowerCase();
  function children(parent: string, depth: number): FileTreeRow[] {
    const entries = (nodes[parent]?.entries || []).filter(entry => options.showHidden || !entry.name.startsWith('.')).slice().sort((a, b) => Number(b.directory) - Number(a.directory)
      || (options.sort === 'size' ? a.size - b.size : options.sort === 'modified' ? a.modified - b.modified : a.name.localeCompare(b.name, undefined, { numeric: true })) * (options.descending ? -1 : 1) || a.name.localeCompare(b.name));
    const branches = entries.flatMap(entry => {
      const nested = entry.directory && expanded.has(entry.path) ? children(entry.path, depth + 1) : [];
      return !query || entry.name.toLowerCase().includes(query) || nested.length ? [[{ entry, depth, parent, position: 0, siblings: 0 }, ...nested]] : [];
    });
    return branches.flatMap(([row, ...nested], index) => [{ ...row, position: index + 1, siblings: branches.length }, ...nested]);
  }
  return children('/', 0);
}

export function entryMetadata(entry: Entry) {
  const size = entry.size < 1024 ? `${entry.size} 字节` : `${(entry.size / (entry.size < 1024 ** 2 ? 1024 : 1024 ** 2)).toFixed(1)} ${entry.size < 1024 ** 2 ? 'KiB' : 'MiB'}（${entry.size.toLocaleString()} 字节）`;
  return [
    ['路径', entry.path],
    ['类型', entry.symlink ? '符号链接' : entry.directory ? '目录' : entry.mode.startsWith('-') ? '普通文件' : '特殊文件'],
    ...(entry.symlink ? [['链接指向', entry.link_target || '—'], ['实际路径', entry.link_resolved || '—'], ['目标类型', entry.link_error ? entry.link_error : entry.directory ? '目录' : '文件']] : []),
    ['大小', size],
    ['修改时间', new Date(entry.modified).toLocaleString()],
    ['权限', entry.mode],
    ['UID / GID', `${entry.uid ?? '—'} / ${entry.gid ?? '—'}`],
  ];
}
