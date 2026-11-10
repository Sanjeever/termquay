import { errorMessage } from '../../lib/errors.ts';
import { t as translate, currentLocale } from '../../i18n/index.ts';
import type { Entry } from '../../../bindings/github.com/Sanjeever/termquay/internal/files/models';
import type { Transfer } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';

export type TreeDirectory = { entries?: Entry[]; loading: boolean; error: unknown };
export type FileTreeRow = {
  entry: Entry;
  depth: number;
  parent: string;
  position: number;
  siblings: number;
};
export const maxExpandedDirectories = 64;

export function directoryAncestors(path: string) {
  return [
    '/',
    ...path
      .split('/')
      .filter(Boolean)
      .map((_, index, parts) => `/${parts.slice(0, index + 1).join('/')}`),
  ];
}

export function inDirectory(path: string, parent: string) {
  return path === parent || path.startsWith(parent === '/' ? '/' : `${parent}/`);
}

export function uploadRefreshPaths(
  task: Pick<Transfer, 'state' | 'direction' | 'destination_path' | 'directory'>,
  cached: string[],
) {
  if (task.state !== 'done' || task.direction !== 'upload' || !task.destination_path) return [];
  const directory = task.directory
    ? task.destination_path
    : task.destination_path.slice(0, task.destination_path.lastIndexOf('/')) || '/';
  return cached.filter((path) =>
    task.directory ? inDirectory(path, directory) : path === directory,
  );
}

export function fileTreeRows(
  nodes: Record<string, TreeDirectory>,
  expanded: ReadonlySet<string>,
  options: { filter: string; showHidden: boolean; sort: string; descending: boolean },
) {
  const query = options.filter.trim().toLowerCase();
  function children(parent: string, depth: number): FileTreeRow[] {
    const entries = (nodes[parent]?.entries || [])
      .filter((entry) => options.showHidden || !entry.name.startsWith('.'))
      .slice()
      .sort(
        (a, b) =>
          Number(b.directory) - Number(a.directory) ||
          (options.sort === 'size'
            ? a.size - b.size
            : options.sort === 'modified'
              ? a.modified - b.modified
              : a.name.localeCompare(b.name, currentLocale(), { numeric: true })) *
            (options.descending ? -1 : 1) ||
          a.name.localeCompare(b.name, currentLocale()),
      );
    const branches = entries.flatMap((entry) => {
      const nested =
        entry.directory && expanded.has(entry.path) ? children(entry.path, depth + 1) : [];
      return !query || entry.name.toLowerCase().includes(query) || nested.length
        ? [[{ entry, depth, parent, position: 0, siblings: 0 }, ...nested]]
        : [];
    });
    return branches.flatMap(([row, ...nested], index) => [
      { ...row, position: index + 1, siblings: branches.length },
      ...nested,
    ]);
  }
  return children('/', 0);
}

export function entryMetadata(entry: Entry) {
  const size =
    entry.size < 1024
      ? translate('files:bytes4', { value1: entry.size })
      : translate('files:bytes5', {
          value1: (entry.size / (entry.size < 1024 ** 2 ? 1024 : 1024 ** 2)).toFixed(1),
          value2: entry.size < 1024 ** 2 ? 'KiB' : 'MiB',
          value3: entry.size.toLocaleString(currentLocale()),
        });
  return [
    [translate('files:path'), entry.path],
    [
      translate('files:type'),
      entry.symlink
        ? translate('files:symbolicLink')
        : entry.directory
          ? translate('files:directory2')
          : entry.mode.startsWith('-')
            ? translate('files:regularFile')
            : translate('files:specialFile'),
    ],
    ...(entry.symlink
      ? [
          [translate('files:linkTarget'), entry.link_target || '—'],
          [translate('files:resolvedPath'), entry.link_resolved || '—'],
          [
            translate('files:targetType'),
            entry.link_error
              ? errorMessage(entry.link_error_message || entry.link_error)
              : entry.directory
                ? translate('files:directory2')
                : translate('files:files'),
          ],
        ]
      : []),
    [translate('files:size'), size],
    [translate('files:modifiedAt'), new Date(entry.modified).toLocaleString(currentLocale())],
    [translate('files:permissions'), entry.mode],
    ['UID / GID', `${entry.uid ?? '—'} / ${entry.gid ?? '—'}`],
  ];
}
