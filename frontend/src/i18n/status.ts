import i18n from './index.ts';

export function statusLabel(code: string | null | undefined, diagnostic = ''): string {
  const key = `status:${code}`;
  return code && i18n.exists(key) ? String(i18n.t(key as never)) : diagnostic;
}
