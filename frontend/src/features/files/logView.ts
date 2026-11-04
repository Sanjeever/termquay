export type LogViewOptions = { filter: string; exclude: string; highlight: string; regex: boolean; case_sensitive: boolean; context_lines: number; format_json: boolean };
export type LogViewRow = { text: string; gap: boolean; highlights: { start: number; end: number }[] };
export type LogViewResult = { rows: LogViewRow[]; matched: number; scanned: number; truncated: boolean; highlightLimited: boolean; formatted: number; unformatted: number; error?: string };

export const defaultLogViewOptions: LogViewOptions = { filter: '', exclude: '', highlight: '', regex: false, case_sensitive: false, context_lines: 0, format_json: false };
export const maxLogCharacters = 512 * 1024;
export const maxLogLines = 10000;

export function retainLogTail(content: string) {
  let start = Math.max(0, content.length - maxLogCharacters);
  if (start > 0) {
    const boundary = content.indexOf('\n', start);
    if (boundary >= 0) start = boundary + 1;
    else if (content.charCodeAt(start) >= 0xdc00 && content.charCodeAt(start) <= 0xdfff) start++;
  }
  let cursor = content.length;
  for (let count = 0; count < maxLogLines && cursor > start; count++) cursor = content.lastIndexOf('\n', cursor - 1);
  if (cursor >= start) start = cursor + 1;
  return { content: content.slice(start), removedBytes: new TextEncoder().encode(content.slice(0, start)).length };
}

export function renderLogView(content: string, options: LogViewOptions): LogViewResult {
  const expression = (source: string) => source ? new RegExp(options.regex ? source : source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), options.case_sensitive ? 'g' : 'gi') : undefined;
  const filter = expression(options.filter), exclude = expression(options.exclude), highlight = expression(options.highlight || options.filter);
  const test = (pattern: RegExp | undefined, text: string) => { if (!pattern) return false; pattern.lastIndex = 0; return pattern.test(text); };
  const lines = content.split('\n');
  const selected = new Uint8Array(lines.length), excluded = new Uint8Array(lines.length);
  let matched = 0;
  for (let i = 0; i < lines.length; i++) {
    if (test(exclude, lines[i])) { excluded[i] = 1; continue; }
    if (!filter || test(filter, lines[i])) {
      matched++;
      const context = filter ? options.context_lines : 0;
      selected.fill(1, Math.max(0, i - context), Math.min(lines.length, i + context + 1));
    }
  }
  const indices: number[] = [];
  for (let i = 0; i < lines.length; i++) if (selected[i] && !excluded[i]) indices.push(i);
  const result: LogViewResult = { rows: [], matched, scanned: lines.length, truncated: indices.length > 4000, highlightLimited: false, formatted: 0, unformatted: 0 };
  let characters = 0, highlights = 0, previous = -1;
  for (const index of indices.slice(-4000)) {
    let text = lines[index];
    if (options.format_json && /^\s*[\[{]/.test(text)) {
      try { const formatted = JSON.stringify(JSON.parse(text), null, 2); if (formatted.length <= 128 * 1024) { text = formatted; result.formatted++; } else result.unformatted++; }
      catch { result.unformatted++; }
    }
    if (characters + text.length > 1024 * 1024) { result.truncated = true; break; }
    characters += text.length;
    const row: LogViewRow = { text, gap: previous >= 0 && index > previous + 1, highlights: [] };
    if (highlight && highlights < 2048) {
      highlight.lastIndex = 0;
      for (const match of text.matchAll(highlight)) {
        if (!match[0].length) continue;
        row.highlights.push({ start: match.index!, end: match.index! + match[0].length });
        if (++highlights >= 2048) { result.highlightLimited = true; break; }
      }
    }
    result.rows.push(row); previous = index;
  }
  return result;
}
