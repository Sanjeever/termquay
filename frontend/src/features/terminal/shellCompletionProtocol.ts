import { message as uiMessage, type MessageKey } from '../../i18n/messages.ts';
export const completionRequest = '\x1b[9270~';
export type CompletionShell = 'bash' | 'zsh';
export type ShellSnapshot = {
  shell: CompletionShell;
  sequence: number;
  line: string;
  cursor: number;
  directory: string;
  home: string;
};
export type CompletionMessage =
  | { kind: 'prompt'; shell: CompletionShell }
  | { kind: 'snapshot'; snapshot: ShellSnapshot }
  | { kind: 'error'; message: string; messageCode?: MessageKey }
  | { kind: 'applied'; sequence: number };

const completionErrorCodes = new Set<MessageKey>([
  'terminal:completionResponseLimit',
  'terminal:completionResponseIncomplete',
  'terminal:completionCommandChanged',
  'terminal:completionResponseInvalid',
  'terminal:completionInputLimit',
  'terminal:completionBashVersion',
  'terminal:completionShellMismatch',
]);
const decoder = new TextDecoder('utf-8', { fatal: true });
const encoder = new TextEncoder();
function unhex(value: string, maxBytes: number) {
  if (value.length > maxBytes * 2 || value.length % 2 || /[^0-9a-f]/.test(value))
    throw uiMessage('terminal:completionDataEncoding');
  return decoder.decode(Uint8Array.from(value.match(/../g) || [], (byte) => parseInt(byte, 16)));
}
export function parseRecordedCommand(data: string, token: string): string | undefined {
  const prefix = `termquay;${token};R;`;
  if (
    !/^[a-f0-9]{64}$/.test(token) ||
    data.length > prefix.length + 16384 ||
    !data.startsWith(prefix)
  )
    return;
  try {
    const command = unhex(data.slice(prefix.length), 8192);
    if (!/[\x00-\x08\x0b-\x1f\x7f]/.test(command)) return command;
  } catch {
    return;
  }
}
export function shellPoint(line: string, cursor: number, shell: CompletionShell) {
  const prefix = line.slice(0, cursor);
  return shell === 'bash' ? encoder.encode(prefix).length : Array.from(prefix).length;
}
export function parseCompletionMessage(data: string, token: string): CompletionMessage | null {
  if (
    !/^[a-f0-9]{64}$/.test(token) ||
    data.length > 49152 ||
    !data.startsWith(`termquay;${token};`)
  )
    return null;
  const [kind, ...parts] = data.slice(token.length + 10).split(';');
  if (kind === 'P' && parts.length === 1 && (parts[0] === 'bash' || parts[0] === 'zsh'))
    return { kind: 'prompt', shell: parts[0] };
  if (
    kind === 'E' &&
    (parts.length === 1 || parts.length === 2) &&
    parts[0].length <= 128 &&
    !/[\x00-\x1f\x7f]/.test(parts[0])
  ) {
    if (parts.length === 1) return { kind: 'error', message: parts[0] };
    if (completionErrorCodes.has(parts[1] as MessageKey))
      return { kind: 'error', message: parts[0], messageCode: parts[1] as MessageKey };
  }
  if (kind === 'A' && /^[1-9]\d{0,9}$/.test(parts[0]) && parts.length === 1)
    return { kind: 'applied', sequence: Number(parts[0]) };
  if (kind !== 'S' || parts.length !== 6) return null;
  const [sequence, shell, point, rawLine, rawDirectory, rawHome] = parts;
  if (
    !/^[1-9]\d{0,9}$/.test(sequence) ||
    !/^\d{1,5}$/.test(point) ||
    (shell !== 'bash' && shell !== 'zsh')
  )
    return null;
  try {
    const line = unhex(rawLine, 8192),
      directory = unhex(rawDirectory, 4096),
      home = unhex(rawHome, 4096);
    if (
      /[\x00-\x08\x0b-\x1f\x7f]/.test(line) ||
      !directory.startsWith('/') ||
      !home.startsWith('/') ||
      /[\x00-\x1f\x7f]/.test(directory + home)
    )
      return null;
    const offset = Number(point);
    const prefix =
      shell === 'bash'
        ? decoder.decode(encoder.encode(line).slice(0, offset))
        : Array.from(line).slice(0, offset).join('');
    if (shellPoint(line, prefix.length, shell) !== offset) return null;
    return {
      kind: 'snapshot',
      snapshot: { shell, sequence: Number(sequence), line, cursor: prefix.length, directory, home },
    };
  } catch {
    return null;
  }
}
export function completionEdit(
  token: string,
  snapshot: ShellSnapshot,
  from: number,
  to: number,
  text: string,
) {
  if (
    !/^[a-f0-9]{64}$/.test(token) ||
    from < 0 ||
    from > snapshot.cursor ||
    to < snapshot.cursor ||
    to > snapshot.line.length ||
    /[\x00-\x08\x0b-\x1f\x7f]/.test(text)
  )
    throw uiMessage('terminal:completionEditRange');
  const line = snapshot.line.slice(0, from) + text + snapshot.line.slice(to);
  const bytes = encoder.encode(line);
  if (bytes.length > 8192) throw uiMessage('terminal:completionCommandLimit');
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `\x1b[9271~${token};${snapshot.sequence};${shellPoint(line, from + text.length, snapshot.shell)};${hex}\x07`;
}
