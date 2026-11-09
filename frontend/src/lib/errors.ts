import i18n from '../i18n/index.ts';
import { MessageError } from '../i18n/messages.ts';

export function errorMessage(error: unknown): string {
  if (Array.isArray(error)) return error.filter(Boolean).map(errorMessage).join('\n');
  type Detail = { message?: string; messageCode?: string; parameters?: Record<string, unknown>; cause?: Detail; causes?: Detail[] };
  const detail = error as Detail | null;
  if (detail?.causes?.length) return detail.causes.map(errorMessage).join('\n');
  const source = error instanceof MessageError || detail?.messageCode ? detail : detail?.cause;
  if (source?.causes?.length) return source.causes.map(errorMessage).join('\n');
  if (source?.messageCode && i18n.exists(source.messageCode)) {
    const parameters = Object.fromEntries(Object.entries(source.parameters ?? {}).map(([key, value]) => [key, value instanceof Error || value && typeof value === 'object' && 'message' in value ? errorMessage(value) : value]));
    return String(i18n.t(source.messageCode as never, parameters as never));
  }
  const message = error instanceof Error ? error.message || error.name : typeof detail?.message === 'string' ? detail.message : String(error);
  return message.replace(/^(?:RuntimeError|Error):\s*/, '');
}

export function eventError(value: { error?: unknown; error_message?: unknown } | null | undefined): unknown {
  return value?.error_message ?? value?.error ?? '';
}

export function errorCode(error: unknown): string {
  const code = (error as { cause?: { code?: unknown } } | null)?.cause?.code;
  return typeof code === 'string' ? code : '';
}
