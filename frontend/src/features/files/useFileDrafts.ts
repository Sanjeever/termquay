import { useRef, useState, type MutableRefObject } from 'react';
import { ReadRemoteFileEncoded, ReadSudoFile, SaveRemoteFile, SaveSudoFile } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import { errorMessage } from '../../lib/errors';
import { documentFormat, formatKey } from './editorFormat';
import { isDirty, savedEncoding, withSavedDocument, type Draft } from './fileDrafts';
import type { SudoAuthorization } from './SudoAuthorizationDialog';

export default function useFileDrafts({ sessionID, disposed, instance, authorizeSudo, setError }: {
  sessionID: string;
  disposed: MutableRefObject<boolean>;
  instance: MutableRefObject<string>;
  authorizeSudo(path: string, encoding: string, operation: 'read' | 'save'): Promise<SudoAuthorization | undefined>;
  setError(message: string): void;
}) {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const draftsRef = useRef(drafts);
  const reads = useRef(new Map<string, ReturnType<typeof ReadRemoteFileEncoded>>());
  const saves = useRef(new Map<string, Promise<boolean>>());
  const [rereading, setRereading] = useState('');
  const [reopenEncoding, setReopenEncoding] = useState('UTF-8');

  function updateDrafts(update: (previous: Draft[]) => Draft[]) {
    const next = update(draftsRef.current);
    draftsRef.current = next;
    setDrafts(next);
  }

  async function save(path: string): Promise<boolean> {
    const pending = saves.current.get(path);
    if (pending) return pending;
    const draft = draftsRef.current.find(draft => draft.path === path);
    if (!draft) return true;
    if (draft.needsReview) {
      updateDrafts(previous => previous.map(draft => draft.path === path ? { ...draft, error: '请先核对最新远端内容，再保存草稿' } : draft));
      return false;
    }
    if (!isDirty(draft)) return true;
    updateDrafts(previous => previous.map(draft => draft.path === path ? { ...draft, saving: true, error: '' } : draft));
    const operation = (async () => {
      try {
        const authorization = draft.sudo ? await authorizeSudo(path, draft.encoding || 'UTF-8', 'save') : undefined;
        if (draft.sudo && !authorization) {
          updateDrafts(previous => previous.map(draft => draft.path === path ? { ...draft, saving: false } : draft));
          return false;
        }
        if (disposed.current || instance.current !== sessionID) return false;
        const document = { path, content: draft.content, revision: draft.revision, original_encoding: savedEncoding(draft), ...documentFormat(draft) };
        const result = authorization ? await SaveSudoFile(sessionID, document, authorization.password) : await SaveRemoteFile(sessionID, document);
        if (disposed.current || instance.current !== sessionID) return false;
        updateDrafts(previous => previous.map(draft => draft.path === path ? withSavedDocument(draft, result) : draft));
        const current = draftsRef.current.find(draft => draft.path === path);
        return !!current && !isDirty(current);
      } catch (error) {
        if (!disposed.current) updateDrafts(previous => previous.map(draft => draft.path === path ? { ...draft, saving: false, error: errorMessage(error) } : draft));
        return false;
      } finally {
        saves.current.delete(path);
      }
    })();
    saves.current.set(path, operation);
    return operation;
  }

  function requestReload(path: string, encoding: string) {
    if (reads.current.has(path)) return;
    setError('');
    setReopenEncoding(encoding);
    const draft = draftsRef.current.find(draft => draft.path === path);
    if (draft && isDirty(draft)) setRereading(path);
    else void reread(path, encoding);
  }

  async function reread(path: string, encoding = reopenEncoding) {
    const sudo = draftsRef.current.find(draft => draft.path === path)?.sudo;
    const authorization = sudo ? await authorizeSudo(path, encoding, 'read') : undefined;
    if (sudo && !authorization || disposed.current || instance.current !== sessionID) return;
    setError('');
    const request = authorization ? ReadSudoFile(sessionID, path, encoding, authorization.password) : ReadRemoteFileEncoded(sessionID, path, encoding);
    reads.current.set(path, request);
    try {
      const document = await request;
      if (!disposed.current && instance.current === sessionID && reads.current.get(path) === request) {
        updateDrafts(previous => previous.map(draft => draft.path === path ? { ...document, sudo, saved: document.content, savedFormat: formatKey(document), reloadEpoch: (draft.reloadEpoch || 0) + 1, saving: false, error: '' } : draft));
        setRereading('');
      }
    } catch (error) {
      if (!disposed.current && instance.current === sessionID && reads.current.get(path) === request) {
        updateDrafts(previous => previous.map(draft => draft.path === path ? { ...draft, error: errorMessage(error) } : draft));
        setRereading('');
      }
    } finally {
      if (reads.current.get(path) === request) reads.current.delete(path);
    }
  }

  return { drafts, draftsRef, updateDrafts, reads, saves, save, rereading, setRereading, requestReload, reread };
}
