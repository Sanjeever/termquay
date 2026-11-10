import type { IDecoration, Terminal } from '@xterm/xterm';
import type { terminalTheme } from '../settings/appearance';

export function logLevelMatches(text: string) {
  return Array.from(
    text.matchAll(/\b(ERROR|FATAL|WARN(?:ING)?|INFO|DEBUG|TRACE)\b/gi),
    (match) => ({
      index: match.index!,
      length: match[0].length,
      color: (/^(ERROR|FATAL)$/i.test(match[0])
        ? 'red'
        : /^WARN/i.test(match[0])
          ? 'yellow'
          : /^INFO$/i.test(match[0])
            ? 'cyan'
            : 'brightBlack') as 'red' | 'yellow' | 'cyan' | 'brightBlack',
    }),
  );
}

export function addLogHighlights(
  term: Terminal,
  colors: ReturnType<typeof terminalTheme>,
  keyword = '',
) {
  let frame = 0;
  let decorations: IDecoration[] = [];
  function clear() {
    for (const decoration of decorations) {
      decoration.dispose();
      decoration.marker.dispose();
    }
    decorations = [];
  }
  function refresh() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      clear();
      const buffer = term.buffer.active;
      if (buffer.type !== 'normal') return;
      const cell = buffer.getNullCell();
      const end = Math.min(buffer.length, buffer.viewportY + term.rows, buffer.viewportY + 200);
      for (let row = buffer.viewportY; row < end && decorations.length < 256; row++) {
        const line = buffer.getLine(row)!;
        const text = line.translateToString(true, 0, Math.min(term.cols, 512));
        const matches = keyword
          ? Array.from(
              text.matchAll(new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')),
            )
              .slice(0, 64)
              .map((match) => ({
                index: match.index!,
                length: match[0].length,
                color: 'yellow' as const,
              }))
          : logLevelMatches(text);
        let column = 0,
          offset = 0;
        for (const match of matches) {
          if (decorations.length >= 256) break;
          while (offset < match.index && column < term.cols) {
            line.getCell(column, cell);
            column += Math.max(1, cell.getWidth());
            if (cell.getWidth()) offset += cell.getChars().length || 1;
          }
          let endColumn = column,
            endOffset = offset;
          while (endOffset < match.index + match.length && endColumn < term.cols) {
            line.getCell(endColumn, cell);
            endColumn += Math.max(1, cell.getWidth());
            if (cell.getWidth()) endOffset += cell.getChars().length || 1;
          }
          let plain = true;
          for (let x = column; x < endColumn; x++) {
            line.getCell(x, cell);
            if (
              !cell.isFgDefault() ||
              !cell.isBgDefault() ||
              cell.isInverse() ||
              cell.isInvisible()
            ) {
              plain = false;
              break;
            }
          }
          if (!plain) continue;
          const marker = term.registerMarker(row - buffer.baseY - buffer.cursorY);
          const decoration = term.registerDecoration({
            marker,
            x: column,
            width: Math.max(1, endColumn - column),
            foregroundColor: colors[match.color],
            layer: 'bottom',
          });
          if (decoration) decorations.push(decoration);
          else marker.dispose();
        }
      }
    });
  }
  const subscriptions = [
    term.onWriteParsed(refresh),
    term.onScroll(refresh),
    term.onResize(refresh),
    term.buffer.onBufferChange(refresh),
  ];
  refresh();
  return {
    dispose() {
      subscriptions.forEach((subscription) => subscription.dispose());
      cancelAnimationFrame(frame);
      clear();
    },
  };
}
