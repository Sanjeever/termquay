import type { IMarker, Terminal } from '@xterm/xterm';

export type CommandIndexEntry = { id: number; command?: string; directory: string; startedAt: number; duration?: number; exitCode?: string; canLocate?: boolean; canCopyOutput?: boolean };

export function shellQuote(value: string) { return "'" + value.replace(/'/g, "'\\''") + "'"; }

export const shellSetup = {
  bash: `if [ -n "$BASH_VERSION" ] && [ -z "\${__termquay_enabled-}" ]; then
  __termquay_prompt() { local code=$?; printf '\\033]133;D;%s\\007\\033]7;file://%s%s\\007\\033]133;A\\007' "$code" "$HOSTNAME" "$PWD"; return "$code"; }
  if declare -p PROMPT_COMMAND 2>/dev/null | grep -q 'declare -a'; then PROMPT_COMMAND=(__termquay_prompt "\${PROMPT_COMMAND[@]}"); else PROMPT_COMMAND=$'__termquay_prompt\\n'"\${PROMPT_COMMAND-}"; fi
  PS0=$'\\e]133;C\\a'"$PS0"
  PS1="$PS1"$'\\[\\e]133;B\\a\\]'
  __termquay_enabled=1
fi`,
  zsh: `if [ -n "$ZSH_VERSION" ] && [ -z "\${__termquay_enabled-}" ]; then
  __termquay_prompt() { local code=$?; printf '\\033]133;D;%s\\007\\033]7;file://%s%s\\007\\033]133;A\\007' "$code" "$HOST" "$PWD"; }
  __termquay_preexec() { printf '\\033]133;C\\007'; }
  precmd_functions=(__termquay_prompt \${precmd_functions[@]})
  preexec_functions+=(__termquay_preexec)
  PS1="$PS1"$'%{\\e]133;B\\a%}'
  __termquay_enabled=1
fi`,
};

export function shellSetupForHost(shell: 'bash' | 'zsh', host: string) {
  const authority = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  const prompt = ['local code=$?;', 'local __termquay_path="$PWD";', '__termquay_path=${__termquay_path//%/%25};', '__termquay_path=${__termquay_path//#/%23};', '__termquay_path=${__termquay_path//"?"/%3F};'].join(' ');
  return shellSetup[shell].replace('__termquay_enabled=1', `__termquay_enabled=1\n  __termquay_host=${shellQuote(authority)}`).replace(/"\$HOSTNAME"|"\$HOST"/g, '"$__termquay_host"').replace('"$PWD";', '"$__termquay_path";').replace('local code=$?;', prompt);
}

export function addShellIntegration(term: Terminal, onDirectory: (path: string, host: string) => void, onExit: (code: string) => void, onFile: (path: string, line: number) => void, onCommand?: (kind: string) => void, onCompletion?: (data: string) => void, onIndex?: (entries: CommandIndexEntry[]) => void) {
  const marks: IMarker[] = [];
  let output: IMarker | undefined;
  let completed: { start: IMarker; end: IMarker } | undefined;
  let currentDirectory = '', pendingCommand: string | undefined, sequence = 0;
  const entries: { view: CommandIndexEntry; start: IMarker; end?: IMarker }[] = [];
  let current: typeof entries[number] | undefined;
  let disposed = false;
  function publishIndex() { if (!disposed) onIndex?.(entries.map(entry => ({ ...entry.view, canLocate: !entry.start.isDisposed, canCopyOutput: !!entry.end && !entry.start.isDisposed && !entry.end.isDisposed }))); }
  function marker() {
    const value = term.registerMarker(0);
    if (value) { value.onDispose(publishIndex); marks.push(value); if (marks.length > 128) marks.shift()?.dispose(); }
    return value;
  }
  const cwd = term.parser.registerOscHandler(7, data => {
    if (data.length > 8192 || /[\x00-\x1f\x7f]/.test(data) || term.buffer.active.type !== 'normal') return true;
    try { const url = new URL(data); const path = decodeURIComponent(url.pathname); if (url.protocol === 'file:' && path.startsWith('/') && !/[\x00-\x1f\x7f]/.test(path)) { currentDirectory = path; onDirectory(path, url.hostname); } } catch { return true; }
    return true;
  });
  const command = term.parser.registerOscHandler(133, data => {
    if (term.buffer.active.type !== 'normal') return true;
    const [kind, status] = data.split(';', 2);
    onCommand?.(kind);
    if (kind === 'A') marker();
    if (kind === 'C') {
      output = marker();
      if (output) { current = { view: { id: ++sequence, command: pendingCommand, directory: currentDirectory, startedAt: Date.now() }, start: output }; entries.push(current); if (entries.length > 128) entries.shift(); publishIndex(); }
      pendingCommand = undefined;
    }
    if (kind === 'D') {
      const end = marker(); if (output && end) completed = { start: output, end }; output = undefined;
      if (current) { current.end = end; current.view.duration = Date.now() - current.view.startedAt; if (/^\d{1,3}$/.test(status || '')) current.view.exitCode = status; current = undefined; publishIndex(); }
      if (/^\d{1,3}$/.test(status || '')) onExit(status);
    }
    return true;
  });
  const completion = term.parser.registerOscHandler(777, data => { if (term.buffer.active.type === 'normal') onCompletion?.(data); return true; });
  const files = term.registerLinkProvider({ provideLinks(y, callback) {
    const line = term.buffer.active.getLine(y - 1);
    if (!line || term.buffer.active.type !== 'normal') { callback(undefined); return; }
    const text = line.translateToString(true);
    const cellColumn = (offset: number) => { let consumed = 0; for (let x = 0; x < line.length; x++) { const cell = line.getCell(x); if (!cell?.getWidth()) continue; if (consumed >= offset) return x + 1; consumed += cell.getChars().length || 1; } return line.length + 1; };
    const matches = Array.from(text.matchAll(/(?:^|[\s("'])((?:\/[^\s:"'<>|()]+)+):(\d+)(?::\d+)?/g)).slice(0, 32);
    callback(matches.map(match => { const start = match.index! + match[0].indexOf(match[1]); return { text: match[1], range: { start: { x: cellColumn(start), y }, end: { x: cellColumn(start + match[1].length + match[2].length + 1) - 1, y } }, activate(event: MouseEvent) { if (event.ctrlKey || event.metaKey) onFile(match[1], Number(match[2])); } }; }));
  } });
  return {
    recordCommand(text: string) { pendingCommand = text; },
    goTo(id: number) { const entry = entries.find(entry => entry.view.id === id); if (!entry || entry.start.isDisposed) return false; term.scrollToLine(entry.start.line); return true; },
    outputText(id: number) {
      const entry = entries.find(entry => entry.view.id === id);
      if (!entry || entry.start.isDisposed || !entry.end || entry.end.isDisposed) throw new Error('输出尚未结束或已移出终端缓冲区');
      const lines: string[] = []; let size = 0;
      for (let y = entry.start.line; y < entry.end.line; y++) { const line = term.buffer.normal.getLine(y)?.translateToString(true) || ''; size += new TextEncoder().encode(line).length + 1; if (size > 256 * 1024) throw new Error('输出超过 256 KiB 复制限制'); lines.push(line); }
      return lines.join('\n');
    },
    previous() { const before = term.buffer.active.viewportY; const mark = marks.filter(m => !m.isDisposed && m.line < before).slice(-1)[0]; if (mark) term.scrollToLine(mark.line); },
    selectOutput() { if (completed && !completed.start.isDisposed && !completed.end.isDisposed) term.selectLines(completed.start.line, Math.max(completed.start.line, completed.end.line - 1)); },
    dispose() { disposed = true; cwd.dispose(); command.dispose(); completion.dispose(); files.dispose(); marks.forEach(m => m.dispose()); },
  };
}
