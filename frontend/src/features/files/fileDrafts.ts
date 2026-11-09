import type { Document } from '../../../bindings/github.com/Sanjeever/termquay/internal/files/models';
import { formatKey } from './editorFormat.ts';

export type Draft = Document & {
  saved: string;
  savedFormat?: string;
  reloadEpoch?: number;
  error: unknown;
  errorOperation?: 'save' | 'read' | 'download';
  saving: boolean;
  needsReview?: boolean;
  recovery?: boolean;
  sudo?: boolean;
};

export function isDirty(draft: Draft) {
  return !!draft.recovery || draft.content !== draft.saved || !!draft.savedFormat && formatKey(draft) !== draft.savedFormat;
}

export function savedEncoding(draft: Draft) {
  return draft.savedFormat ? JSON.parse(draft.savedFormat).encoding as string : draft.encoding || 'UTF-8';
}

export function withSavedDocument(draft: Draft, document: Document): Draft {
  return { ...draft, saved: document.content, savedFormat: formatKey(document), revision: document.revision, saving: false, error: '', errorOperation: undefined };
}

export function fileErrorAction(draft: Pick<Draft, 'error' | 'errorOperation' | 'needsReview'>, connected: boolean): 'download' | 'reconnect' | 'compare' | 'encoding' | 'reload' | 'save' {
  if (draft.errorOperation === 'download') return 'download';
  if (!connected) return 'reconnect';
  const codes = new Set<string>();
  function collect(error: unknown) {
    if (!error || typeof error !== 'object') return;
    if (Array.isArray(error)) { error.forEach(collect); return; }
    const detail = error as { messageCode?: string; cause?: unknown; causes?: unknown[] };
    if (detail.messageCode) codes.add(detail.messageCode);
    collect(detail.cause); detail.causes?.forEach(collect);
  }
  collect(draft.error);
  if (draft.needsReview || codes.has('backend:remoteFileChangedCompareAndMergeFirst') || codes.has('backend:remoteFileChangedReadItAgainAndCompare')) return 'compare';
  if (codes.has('backend:cannotRepresentTheCurrentContentUseUTF8')) return 'encoding';
  return draft.errorOperation === 'read' ? 'reload' : 'save';
}
