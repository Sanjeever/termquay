import { t as translate } from '../../i18n/index.ts';
import { message as uiMessage } from '../../i18n/messages.ts';
import { useMessageState } from '../../i18n/useMessageState.ts';
import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import { Button } from '@heroui/react';
import {
  CreatePasswordStorage,
  GetStorageStatus,
  UnlockPasswordStorage,
  UseSessionStorage,
} from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { StorageStatus } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';

export default function StorageAccess({
  error: initialError,
  onOpened,
}: {
  error: string;
  onOpened(): Promise<void>;
}) {
  useTranslation();
  const [status, setStatus] = useState<StorageStatus>();
  const [create, setCreate] = useState(false);
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
  async function open(session = false) {
    if (busy) return;
    if (!session && create && password !== confirmation) {
      setError(uiMessage('settings:masterPasswordsDoNotMatch'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (session) await UseSessionStorage();
      else if (create) await CreatePasswordStorage(password);
      else await UnlockPasswordStorage(password);
      setPassword('');
      setConfirmation('');
      await onOpened();
    } catch (e) {
      setError(e);
      setPassword('');
      setConfirmation('');
      try {
        const next = await GetStorageStatus();
        setStatus(next);
        if (next.mode === 'password') setCreate(false);
      } catch (statusError) {
        setError([e, statusError]);
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="settings-panel storage-access"
      aria-label={translate('settings:unlockLocalData')}
    >
      <h2>
        {status?.mode === 'password'
          ? translate('settings:unlockLocalData')
          : create
            ? translate('settings:createMasterPasswordStorage')
            : translate('settings:localStorageUnavailable')}
      </h2>
      {status?.mode !== 'password' && !create && (
        <p className="error" role="alert">
          {initialError}
        </p>
      )}
      {!status?.unlocked && (status?.mode === 'password' || create) && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void open();
          }}
        >
          <label className="form-field">
            {translate('settings:masterPassword')}
            <input
              autoFocus
              type="password"
              autoComplete={create ? 'new-password' : 'current-password'}
              value={password}
              disabled={busy}
              maxLength={1024}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {create && (
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
          )}
          <Button
            type="submit"
            color="primary"
            isLoading={busy}
            isDisabled={
              !password ||
              (create && (Array.from(password).length < 8 || password !== confirmation))
            }
          >
            {create ? translate('settings:createAndOpen') : translate('settings:unlock')}
          </Button>
        </form>
      )}
      {create && (
        <p className="muted">{translate('settings:theMasterPasswordNeedsAtLeast8Characters')}</p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {status?.unlocked && (
        <Button size="sm" variant="light" onPress={() => void onOpened()}>
          {translate('settings:reloadLocalData')}
        </Button>
      )}
      <div className="button-row">
        {status?.can_create && !create && (
          <Button size="sm" variant="light" isDisabled={busy} onPress={() => setCreate(true)}>
            {translate('settings:createStorageWithAMasterPassword')}
          </Button>
        )}
        {status?.mode !== 'password' && !create && (
          <Button size="sm" variant="light" isDisabled={busy} onPress={() => void onOpened()}>
            {translate('settings:retrySystemKeychain')}
          </Button>
        )}
        <Button size="sm" variant="light" isDisabled={busy} onPress={() => void open(true)}>
          {translate('settings:useSessionStorageThisTime')}
        </Button>
      </div>
    </section>
  );
}
