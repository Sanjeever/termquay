import Modal from '../../components/Modal';
import { t as translate } from '../../i18n/index.ts';
import { useMessageState } from '../../i18n/useMessageState.ts';
import { useTranslation } from 'react-i18next';

import { useState } from 'react';
import { Button, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@heroui/react';
import type {
  WorkspaceLayout,
  WorkspaceLayoutEntry,
} from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import type { Connection } from '../../../bindings/github.com/Sanjeever/termquay/internal/store/models';
export default function WorkspaceRestoreDialog({
  layout,
  connections,
  openIDs,
  onRestore,
  onClose,
}: {
  layout: WorkspaceLayout;
  connections: Connection[];
  openIDs: string[];
  onRestore(entries: WorkspaceLayoutEntry[]): Promise<void>;
  onClose(): void;
}) {
  useTranslation();
  const [selected, setSelected] = useState(
    new Set((layout.entries || []).filter((e) => !openIDs.includes(e.id)).map((e) => e.id)),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useMessageState('');
  return (
    <Modal isOpen onClose={() => !busy && onClose()} className="app-dialog" scrollBehavior="inside">
      <ModalContent>
        <ModalHeader>{translate('workspaces:restoreWorkspaceLayout')}</ModalHeader>
        <ModalBody>
          {(layout.entries || []).map((e) => (
            <label className="restore-workspace-row" key={e.id}>
              <input
                type="checkbox"
                checked={selected.has(e.id)}
                disabled={busy || openIDs.includes(e.id)}
                onChange={(event) =>
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (event.target.checked) next.add(e.id);
                    else next.delete(e.id);
                    return next;
                  })
                }
              />
              <span>
                {e.name}
                <small className="muted">
                  {e.target.protocol.toUpperCase()} · {e.target.host}:{e.target.port}
                  {openIDs.includes(e.id)
                    ? translate('workspaces:alreadyOpen')
                    : e.connection_id && !connections.some((c) => c.id === e.connection_id)
                      ? translate('workspaces:savedConfigurationDeleted')
                      : ''}
                </small>
              </span>
            </label>
          ))}
          <p className="muted">
            {translate('workspaces:restoredWorkspacesStayDisconnectedConnectFromEachWorkspace')}
          </p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="light" isDisabled={busy} onPress={onClose}>
            {translate('workspaces:notNow')}
          </Button>
          <Button
            color="primary"
            isLoading={busy}
            isDisabled={!selected.size || openIDs.length + selected.size > 16}
            onPress={async () => {
              setBusy(true);
              try {
                await onRestore((layout.entries || []).filter((e) => selected.has(e.id)));
                onClose();
              } catch (e) {
                setError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            {translate('workspaces:restoreLayout')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
