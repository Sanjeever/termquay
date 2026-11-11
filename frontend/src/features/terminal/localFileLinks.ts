import type { ILink, IMarker, Terminal } from '@xterm/xterm';
import { localDirectoryReport } from './localTerminal';

export type LocalFileReference = {
  path: string;
  line: number;
  column: number;
  start: number;
  end: number;
  directory?: string;
};

export function absoluteLocalPath(path: string) {
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\');
}

export function localFileReferences(text: string): LocalFileReference[] {
  if (text.length > 8192) return [];
  const result: LocalFileReference[] = [];
  const add = (raw: string, start: number, end: number) => {
    const suffix = /(?::(\d+)(?::(\d+))?|#L(\d+)(?:C(\d+))?)$/.exec(raw);
    const path = suffix ? raw.slice(0, suffix.index) : raw;
    if (
      !path ||
      path.length > 4096 ||
      /[\\/]$/.test(path) ||
      (!absoluteLocalPath(path) &&
        !/[\\/]/.test(path) &&
        !/\.[\p{L}\p{N}_-]+$/u.test(path) &&
        !suffix)
    )
      return;
    const line = Number(suffix?.[1] ?? suffix?.[3] ?? 1);
    const column = Number(suffix?.[2] ?? suffix?.[4] ?? 1);
    if (line < 1 || line > 1_000_000_000 || column < 1 || column > 1_000_000_000) return;
    if (result.some((link) => start < link.end && end > link.start)) return;
    result.push({ path, line, column, start, end });
  };
  for (const match of text.matchAll(/(["'`])([^"'`\r\n]+)\1((?::\d+(?::\d+)?|#L\d+(?:C\d+)?)?)/g)) {
    add(match[2] + match[3], match.index!, match.index! + match[0].length);
    if (result.length >= 32) return result;
  }
  for (const match of text.matchAll(
    /(?:^|[\s([>])((?:[A-Za-z]:[\\/])?[^\s:"'`<>|()[\]]+(?::\d+(?::\d+)?)?)/g,
  )) {
    const raw = match[1].replace(/[.,;]+$/, '');
    const start = match.index! + match[0].indexOf(match[1]);
    add(raw, start, start + raw.length);
    if (result.length >= 32) break;
  }
  return result.sort((first, second) => first.start - second.start);
}

export function addLocalFileLinks(
  term: Terminal,
  hostname: string,
  kind: string,
  open: (reference: LocalFileReference) => void,
) {
  const contexts: { marker: IMarker; directory?: string }[] = [];
  let directory: string | undefined;
  let alternateDirectory: string | undefined;
  const remember = (value?: string) => {
    const marker = term.registerMarker(0);
    if (!marker) return;
    while (contexts[0]?.marker.isDisposed) contexts.shift();
    if (contexts.length >= 128) contexts.shift()!.marker.dispose();
    contexts.push({ marker, directory: value });
  };
  const subscriptions = [
    term.parser.registerOscHandler(7, (data) => {
      if (data.length > 8192) return false;
      try {
        const uri = new URL(data);
        if (uri.protocol !== 'file:') return false;
        const path = decodeURIComponent(uri.pathname);
        // oxlint-disable-next-line no-control-regex -- Directory reports cannot contain control characters.
        const accepted = !/[\x00-\x1f\x7f-\x9f]/.test(path)
          ? localDirectoryReport(path, uri.hostname, hostname, kind)
          : undefined;
        if (term.buffer.active.type === 'normal') {
          directory = accepted;
          remember(directory);
        } else alternateDirectory = accepted;
      } catch {
        return false;
      }
      return false;
    }),
    term.buffer.onBufferChange((buffer) => {
      alternateDirectory = buffer.type === 'alternate' ? directory : undefined;
    }),
    term.parser.registerEscHandler({ final: 'c' }, () => {
      contexts.splice(0).forEach(({ marker }) => marker.dispose());
      directory = alternateDirectory = undefined;
      return false;
    }),
    term.registerLinkProvider({
      provideLinks(y, callback) {
        const buffer = term.buffer.active;
        let start = y - 1;
        let count = 0;
        while (buffer.getLine(start)?.isWrapped && start > 0) {
          if (++count >= 64) {
            callback(undefined);
            return;
          }
          start--;
        }
        let text = '';
        const positions: { x: number; y: number; width: number }[] = [];
        for (let row = start; row < buffer.length; row++) {
          if (row - start >= 64) {
            callback(undefined);
            return;
          }
          const line = buffer.getLine(row);
          if (!line) break;
          const wrapped = !!buffer.getLine(row + 1)?.isWrapped;
          const length = line.translateToString(!wrapped).length;
          let consumed = 0;
          for (let x = 0; x < line.length && consumed < length; x++) {
            const cell = line.getCell(x);
            if (!cell?.getWidth()) continue;
            if (wrapped && x === line.length - 1 && !cell.getChars()) continue;
            const chars = cell.getChars() || ' ';
            const position = { x: x + 1, y: row + 1, width: cell.getWidth() };
            for (let index = 0; index < chars.length; index++) positions.push(position);
            text += chars;
            consumed += chars.length;
            if (text.length > 8192) {
              callback(undefined);
              return;
            }
          }
          if (!wrapped) break;
        }
        const links: ILink[] = [];
        for (const reference of localFileReferences(text)) {
          const first = positions[reference.start],
            last = positions[reference.end - 1];
          if (!first || !last || first.y > y || last.y < y) continue;
          let base = alternateDirectory;
          if (buffer.type === 'normal') {
            base = undefined;
            for (const context of contexts)
              if (!context.marker.isDisposed && context.marker.line <= first.y - 1)
                base = context.directory;
          }
          links.push({
            text: reference.path,
            range: {
              start: { x: first.x, y: first.y },
              end: { x: last.x + last.width - 1, y: last.y },
            },
            activate(event) {
              if (event.ctrlKey || event.metaKey) open({ ...reference, directory: base });
            },
          });
        }
        callback(links);
      },
    }),
  ];
  return {
    dispose() {
      subscriptions.forEach((subscription) => subscription.dispose());
      contexts.forEach(({ marker }) => marker.dispose());
    },
  };
}
