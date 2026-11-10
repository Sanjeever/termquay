import Modal from '../../components/Modal';
import { t as translate } from '../../i18n/index.ts';
import { useMessageState } from '../../i18n/useMessageState.ts';
import { useTranslation } from 'react-i18next';

import { useEffect, useState } from 'react';
import { Button, Input, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react';
import {
  ListCredentialReferences,
  UpdateCredential,
} from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { CredentialReference } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import type { Request } from '../../../bindings/github.com/Sanjeever/termquay/internal/ssh/models';
import ErrorNotice from '../../components/ErrorNotice';

export default function CredentialSettings({ onChanged }: { onChanged(): void }) {
  useTranslation();
  const [items, setItems] = useState<CredentialReference[]>([]);
  const [editing, setEditing] = useState<CredentialReference>();
  const [error, setError] = useMessageState('');
  const [busy, setBusy] = useState(false);
  async function load() {
    try {
      setItems((await ListCredentialReferences()) || []);
    } catch (e) {
      setError(e);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  return (
    <section className="settings-panel">
      <h2>{translate('settings:credentials2')}</h2>
      {!editing && <ErrorNotice message={error} onDismiss={() => setError('')} />}
      <ul className="credential-list">
        {items.map((item) => (
          <li key={item.id}>
            <div>
              <strong>{item.names?.[0] || translate('settings:noLinkedCredentials')}</strong>
              <span className="muted">
                {item.kind === 'private_key'
                  ? translate('settings:privateKey')
                  : translate('settings:password')}{' '}
                · {item.connection_ids?.length || 0} {translate('settings:connections2')}
              </span>
              {(item.names?.length || 0) > 1 && (
                <details>
                  <summary>{translate('settings:linkedConnections')}</summary>
                  <ul>
                    {item.names?.map((name, index) => (
                      <li key={index}>{name}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
            <Button
              size="sm"
              variant="light"
              onPress={() => {
                setError('');
                setEditing(item);
              }}
            >
              {translate('settings:updateCredentials')}
            </Button>
          </li>
        ))}
      </ul>
      <Modal
        isOpen={!!editing}
        onClose={() => {
          if (!busy) {
            setEditing(undefined);
            setError('');
          }
        }}
        className="app-dialog"
        isDismissable={!busy}
      >
        <ModalContent>
          <ModalHeader>{translate('settings:updateSharedCredentials')}</ModalHeader>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (!editing || busy) return;
              const data = new FormData(event.currentTarget);
              const auth: Request = {
                host: '',
                port: 22,
                username: '',
                password: String(data.get('password') || ''),
                private_key: String(data.get('private_key') || ''),
                passphrase: String(data.get('passphrase') || ''),
                fingerprint: '',
                cols: 80,
                rows: 24,
              };
              setBusy(true);
              try {
                await UpdateCredential(editing.id, auth, editing.connection_ids || []);
                setEditing(undefined);
                await load();
                onChanged();
              } catch (e) {
                setError(e);
              } finally {
                setBusy(false);
                auth.password = '';
                auth.private_key = '';
                auth.passphrase = '';
              }
            }}
          >
            <ModalBody>
              <p>
                {translate('settings:updatesApplyToNewSessionsForTheFollowing')}
                {editing?.connection_ids?.length || 0} {translate('settings:connections2')}
              </p>
              <ul className="batch-paths">
                {editing?.names?.map((name, index) => (
                  <li key={index}>{name}</li>
                ))}
              </ul>
              {editing?.kind === 'private_key' ? (
                <>
                  <label className="form-field">
                    {translate('settings:newPrivateKey')}
                    <textarea
                      name="private_key"
                      aria-label={translate('settings:newPrivateKey')}
                      rows={5}
                      autoComplete="off"
                      spellCheck={false}
                      required
                      disabled={busy}
                    />
                  </label>
                  <Input
                    name="passphrase"
                    type="password"
                    label={translate('settings:privateKeyPassphrase')}
                    labelPlacement="outside"
                    autoComplete="off"
                    isDisabled={busy}
                  />
                </>
              ) : (
                <Input
                  autoFocus
                  name="password"
                  type="password"
                  label={translate('settings:newPassword')}
                  labelPlacement="outside"
                  autoComplete="new-password"
                  isRequired
                  isDisabled={busy}
                />
              )}{' '}
              <ErrorNotice message={error} onDismiss={() => setError('')} />
            </ModalBody>
            <ModalFooter>
              <Button
                variant="light"
                isDisabled={busy}
                onPress={() => {
                  setEditing(undefined);
                  setError('');
                }}
              >
                {translate('settings:cancel')}
              </Button>
              <Button color="primary" type="submit" isLoading={busy}>
                {translate('settings:update')}
                {editing?.connection_ids?.length || 0} {translate('settings:connections2')}
              </Button>
            </ModalFooter>
          </form>
        </ModalContent>
      </Modal>
    </section>
  );
}
