import Modal from '../../components/Modal';
import { t as translate } from '../../i18n/index.ts';
import { useMessageState } from '../../i18n/useMessageState.ts';
import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import { Button, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react';
import {
  GetStorageStatus,
  SetStoragePassword,
  UseSystemStorage,
} from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { StorageStatus } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import { errorMessage } from '../../lib/errors';
import ApplicationLockSettings from './ApplicationLockSettings';

export default function StorageSettings() {
  useTranslation();
  const [status, setStatus] = useState<StorageStatus>();
  const [editing, setEditing] = useState<'password' | 'keyring'>();
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useMessageState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let ended = false;
    GetStorageStatus()
      .then((value) => {
        if (!ended) setStatus(value);
      })
      .catch((e) => {
        if (!ended) setError(e);
      });
    return () => {
      ended = true;
    };
  }, [setError]);
  function close() {
    if (busy) return;
    setEditing(undefined);
    setCurrent('');
    setPassword('');
    setConfirmation('');
    setError('');
  }
  async function save() {
    if (busy || !editing) return;
    setBusy(true);
    setError('');
    try {
      if (editing === 'keyring') await UseSystemStorage(current);
      else await SetStoragePassword(current, password);
      setCurrent('');
      setPassword('');
      setConfirmation('');
      setStatus(await GetStorageStatus());
      setEditing(undefined);
    } catch (e) {
      setError(e);
      setCurrent('');
      setPassword('');
      setConfirmation('');
      try {
        setStatus(await GetStorageStatus());
      } catch (statusError) {
        setError(`${errorMessage(e)}；${errorMessage(statusError)}`);
      }
    } finally {
      setBusy(false);
      window.dispatchEvent(new Event('termquay:storage-protection-changed'));
    }
  }
  return (
    <section className="settings-panel">
      <h2>{translate('settings:storageProtection')}</h2>
      <p>
        {status?.mode === 'password'
          ? translate('settings:masterPassword')
          : status?.mode === 'session'
            ? translate('settings:sessionStorage')
            : status
              ? translate('settings:systemKeychain')
              : translate('settings:reading')}
      </p>
      {status?.mode === 'password' && <ApplicationLockSettings />}
      {error && !editing && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {status?.unlocked && status.mode !== 'session' && (
        <div className="button-row">
          <Button
            size="sm"
            variant="light"
            onPress={() => {
              setError('');
              setEditing('password');
            }}
          >
            {status.mode === 'password'
              ? translate('settings:changeMasterPassword')
              : translate('settings:enableMasterPassword')}
          </Button>
          {status.mode === 'password' && (
            <Button
              size="sm"
              variant="light"
              onPress={() => {
                setError('');
                setEditing('keyring');
              }}
            >
              {translate('settings:switchToSystemKeychain')}
            </Button>
          )}
        </div>
      )}
      <Modal
        isOpen={!!editing}
        onClose={close}
        isDismissable={!busy}
        isKeyboardDismissDisabled={busy}
        className="app-dialog"
      >
        <ModalContent>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <ModalHeader>
              {editing === 'keyring'
                ? translate('settings:switchToSystemKeychain')
                : status?.mode === 'password'
                  ? translate('settings:changeMasterPassword')
                  : translate('settings:enableMasterPassword')}
            </ModalHeader>
            <ModalBody>
              {status?.mode === 'password' && (
                <label className="form-field">
                  {translate('settings:currentMasterPassword')}
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={current}
                    disabled={busy}
                    maxLength={1024}
                    onChange={(event) => setCurrent(event.target.value)}
                  />
                </label>
              )}
              {editing === 'password' && (
                <>
                  <label className="form-field">
                    {status?.mode === 'password'
                      ? translate('settings:newMasterPassword')
                      : translate('settings:masterPassword')}
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={password}
                      disabled={busy}
                      maxLength={1024}
                      onChange={(event) => setPassword(event.target.value)}
                    />
                  </label>
                  <label className="form-field">
                    {translate('settings:confirmMasterPassword')}
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={confirmation}
                      disabled={busy}
                      maxLength={1024}
                      onChange={(event) => setConfirmation(event.target.value)}
                    />
                  </label>
                  <p className="muted">
                    {translate('settings:theMasterPasswordNeedsAtLeast8Characters2')}
                  </p>
                </>
              )}
              <p className="muted">
                {translate('settings:protectsSavedCredentialsAndEncryptedSettingsConnectionNames')}
              </p>
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
            </ModalBody>
            <ModalFooter>
              <Button variant="light" isDisabled={busy} onPress={close}>
                {translate('settings:cancel')}
              </Button>
              <Button
                color="primary"
                type="submit"
                isLoading={busy}
                isDisabled={
                  editing === 'password'
                    ? Array.from(password).length < 8 ||
                      password !== confirmation ||
                      (status?.mode === 'password' && !current)
                    : !current
                }
              >
                {translate('settings:confirmSwitch')}
              </Button>
            </ModalFooter>
          </form>
        </ModalContent>
      </Modal>
    </section>
  );
}
