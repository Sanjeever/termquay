import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { t } from '../../i18n';
import { Button, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react';
import Modal from '../../components/Modal';
import SelectControl from '../../components/SelectControl';
import { useMessageState } from '../../i18n/useMessageState';
import {
  CancelDirectorySyncPreview,
  ExecuteFilePaste,
  PreviewClipboardPaste,
} from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { DirectorySyncPreview } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';

export default function FilePasteDialog({
  workspace,
  initialPreview,
  onClose,
}: {
  workspace: string;
  initialPreview: DirectorySyncPreview;
  onClose(): void;
}) {
  useTranslation();
  const [preview, setPreview] = useState(initialPreview);
  const [names, setNames] = useState((initialPreview.paste_items || []).map((item) => item.name));
  const [actions, setActions] = useState<string[]>(
    (initialPreview.paste_items || []).map((item) => (item.exists ? 'skip' : 'copy')),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useMessageState('');
  const [acceptSkipped, setAcceptSkipped] = useState(false);
  const latest = useRef(preview);
  latest.current = preview;
  const pending = useRef<{ cancel(): unknown }>();
  const disposed = useRef(false);
  useEffect(
    () => () => {
      disposed.current = true;
      pending.current?.cancel();
      void CancelDirectorySyncPreview(latest.current.id);
    },
    [],
  );
  const items = preview.paste_items || [];
  const changed = names.some((name, index) => name !== items[index].name);
  const conflicts = (preview.entries || []).filter((entry) => entry.state === 'conflict');
  const blocked = new Set(conflicts.map((entry) => entry.path));
  async function submit() {
    setBusy(true);
    setError('');
    try {
      if (changed) {
        await CancelDirectorySyncPreview(preview.id);
        const request = PreviewClipboardPaste(workspace, preview.remote, names);
        pending.current = request;
        const next = await request;
        if (disposed.current) {
          void CancelDirectorySyncPreview(next.id);
          return;
        }
        setPreview(next);
        setNames((next.paste_items || []).map((item) => item.name));
        setActions((next.paste_items || []).map((item) => (item.exists ? 'skip' : 'copy')));
        setAcceptSkipped(false);
      } else {
        const request = ExecuteFilePaste(
          preview.id,
          items.map((item, index) => ({
            name: item.name,
            action: blocked.has(item.name) ? 'skip' : actions[index],
          })),
        );
        pending.current = request;
        await request;
        if (!disposed.current) onClose();
      }
    } catch (error) {
      if (!disposed.current) setError(error);
    } finally {
      pending.current = undefined;
      if (!disposed.current) setBusy(false);
    }
  }
  return (
    <Modal
      isOpen
      onClose={onClose}
      isDismissable={!busy}
      isKeyboardDismissDisabled={busy}
      className="app-dialog file-paste-dialog"
    >
      <ModalContent>
        <ModalHeader>{t('files:pasteFiles')}</ModalHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <ModalBody>
            <p className="file-path">{preview.remote}</p>
            <ul className="file-paste-items">
              {items.map((item, index) => (
                <li key={item.source}>
                  <span className="file-path">{item.source}</span>
                  <input
                    className="native-input"
                    aria-label={t('files:copyName', { path: item.source })}
                    value={names[index]}
                    required
                    pattern="[^/]+"
                    disabled={busy}
                    onChange={(event) =>
                      setNames((previous) =>
                        previous.map((name, i) => (i === index ? event.target.value : name)),
                      )
                    }
                  />
                  {item.exists && (
                    <SelectControl
                      aria-label={t('files:nameConflict', { path: item.name })}
                      value={actions[index]}
                      disabled={busy || blocked.has(item.name)}
                      onChange={(event) =>
                        setActions((previous) =>
                          previous.map((action, i) => (i === index ? event.target.value : action)),
                        )
                      }
                    >
                      <option value="skip">{t('files:skip')}</option>
                      <option value="overwrite">{t('files:overwrite')}</option>
                    </SelectControl>
                  )}
                </li>
              ))}
            </ul>
            {!!conflicts.length && (
              <details open>
                <summary>{t('files:copyConflicts', { count: conflicts.length })}</summary>
                <ul className="batch-paths">
                  {conflicts.map((entry) => (
                    <li className="file-path" key={entry.path}>
                      {entry.path}
                    </li>
                  ))}
                </ul>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={acceptSkipped}
                    disabled={busy}
                    onChange={(event) => setAcceptSkipped(event.target.checked)}
                  />
                  {t('files:skipCopyConflicts')}
                </label>
              </details>
            )}
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="light" isDisabled={busy} onPress={onClose}>
              {t('files:cancel')}
            </Button>
            <Button
              type="submit"
              color="primary"
              isLoading={busy}
              isDisabled={
                !changed &&
                ((conflicts.length > 0 && !acceptSkipped) ||
                  !items.some(
                    (item, index) => !blocked.has(item.name) && actions[index] !== 'skip',
                  ))
              }
            >
              {changed ? t('files:preview') : t('files:copy')}
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
}
