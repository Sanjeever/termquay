import i18n from '../i18n/index.ts';
import { MessageError } from '../i18n/messages.ts';

export function errorMessage(error: unknown): string {
  const source = error instanceof MessageError ? error : (error as { cause?: { messageCode?: string; parameters?: Record<string, unknown> } } | null)?.cause;
  if (source?.messageCode && i18n.exists(source.messageCode)) {
    const parameters = Object.fromEntries(Object.entries(source.parameters ?? {}).map(([key, value]) => [key, value instanceof Error ? errorMessage(value) : value]));
    return String(i18n.t(source.messageCode as never, parameters as never));
  }
  const message = error instanceof Error ? error.message || error.name : String(error);
  return message.replace(/^(?:RuntimeError|Error):\s*/, '');
}

export function errorCode(error: unknown): string {
  const code = (error as { cause?: { code?: unknown } } | null)?.cause?.code;
  return typeof code === 'string' ? code : '';
}
