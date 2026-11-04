import type { Document } from '../../../bindings/github.com/Sanjeever/termquay/internal/files/models';
import { formatKey } from './editorFormat.ts';

export type Draft = Document & {
  saved: string;
  savedFormat?: string;
  reloadEpoch?: number;
  error: string;
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
  return { ...draft, saved: document.content, savedFormat: formatKey(document), revision: document.revision, saving: false };
}
