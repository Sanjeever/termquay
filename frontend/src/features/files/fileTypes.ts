export function isImagePath(path: string) {
  return /\.(png|jpe?g|gif|webp)$/i.test(path);
}
export function isMarkdownPath(path: string) {
  return /\.(md|markdown|mdown|mkd)$|(?:^|\/)(readme|changelog|changes)$/i.test(path);
}

export function fileTabContexts(paths: string[]) {
  const groups = new Map<string, string[]>();
  for (const path of new Set(paths)) {
    const name = path.slice(path.lastIndexOf('/') + 1);
    const group = groups.get(name) || [];
    group.push(path);
    groups.set(name, group);
  }
  const result = new Map<string, string>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const parents = group.map((path) => path.slice(0, path.lastIndexOf('/')) || '/');
    for (let index = 0; index < group.length; index++) {
      const parts = parents[index].split('/');
      for (let depth = 1; depth <= parts.length; depth++) {
        const suffix = parts.slice(-depth).join('/') || '/';
        if (
          parents.every(
            (other, position) =>
              position === index || other.split('/').slice(-depth).join('/') !== suffix,
          )
        ) {
          result.set(group[index], suffix);
          break;
        }
      }
    }
  }
  return result;
}

export type DocumentTarget =
  | { kind: 'remote'; path: string; hash: string }
  | { kind: 'external'; url: string }
  | { kind: 'anchor'; hash: string }
  | { kind: 'blocked' };
export function documentTarget(documentPath: string, target: string): DocumentTarget {
  if (!target.trim()) return { kind: 'blocked' };
  try {
    const base =
      'https://termquay.invalid' + documentPath.split('/').map(encodeURIComponent).join('/');
    const url = new URL(target, base);
    if (url.username || url.password || !['http:', 'https:'].includes(url.protocol))
      return { kind: 'blocked' };
    if (url.origin !== 'https://termquay.invalid') return { kind: 'external', url: url.href };
    const path = decodeURIComponent(url.pathname);
    if (path === documentPath && url.hash) return { kind: 'anchor', hash: url.hash };
    return { kind: 'remote', path, hash: url.hash };
  } catch {
    return { kind: 'blocked' };
  }
}
