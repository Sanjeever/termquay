import Modal from '../../components/Modal';
import { t as translate } from '../../i18n/index.ts';
import { useMessageState } from '../../i18n/useMessageState.ts';
import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import { Button, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@heroui/react';
import {
  GetBackupRecoveryRecipient,
  ExportBackupRecoveryKey,
  SelectBackupRecoveryRecipient,
  SetBackupRecoveryRecipient,
} from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import ErrorNotice from '../../components/ErrorNotice';

export default function BackupRecoverySettings({ disabled }: { disabled: boolean }) {
  useTranslation();
  const [recipient, setRecipient] = useState('');
  const [pending, setPending] = useState<{ recipient: string; path: string }>();
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useMessageState('');
  useEffect(() => {
    let ended = false;
    GetBackupRecoveryRecipient()
      .then((value) => {
        if (!ended) setRecipient(value);
      })
      .catch((error) => {
        if (!ended) setError(error);
      });
    return () => {
      ended = true;
    };
  }, []);
  async function choose(create: boolean) {
    if (busy) return;
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      const value = create
        ? await ExportBackupRecoveryKey()
        : { recipient: await SelectBackupRecoveryRecipient(), path: '' };
      if (value.recipient) setPending(value);
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!pending || busy) return;
    setBusy(true);
    setError('');
    try {
      await SetBackupRecoveryRecipient(pending.recipient);
      setRecipient(pending.recipient);
      setPending(undefined);
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="backup-section">
      <div className="backup-section-heading">
        <h3>{translate('settings:recoveryKey')}</h3>
      </div>
      {recipient && <code className="fingerprint">{recipient}</code>}
      <div className="button-row">
        <Button
          size="sm"
          variant="bordered"
          isDisabled={disabled || busy}
          onPress={() => void choose(true)}
        >
          {recipient
            ? translate('settings:replaceRecoveryKey')
            : translate('settings:createRecoveryKey')}
        </Button>
        <Button
          size="sm"
          variant="light"
          isDisabled={disabled || busy}
          onPress={() => void choose(false)}
        >
          {translate('settings:useExistingKey')}
        </Button>
        {recipient && (
          <Button
            size="sm"
            variant="light"
            isDisabled={disabled || busy}
            onPress={() => {
              setSaved(false);
              setError('');
              setPending({ recipient: '', path: '' });
            }}
          >
            {translate('settings:disable')}
          </Button>
        )}
      </div>
      <ErrorNotice message={!pending ? error : ''} />
      <Modal
        isOpen={!!pending}
        onClose={() => !busy && setPending(undefined)}
        isDismissable={!busy}
        isKeyboardDismissDisabled={busy}
        className="app-dialog"
      >
        <ModalContent>
          <ModalHeader>
            {pending?.recipient
              ? translate('settings:enableBackupRecoveryKey')
              : translate('settings:disableBackupRecoveryKey')}
          </ModalHeader>
          <ModalBody>
            {pending?.recipient ? (
              <>
                {pending.path && (
                  <p className="file-path">
                    {translate('settings:exportedTo')}
                    {pending.path}
                  </p>
                )}
                <code className="fingerprint">{pending.recipient}</code>
                <p>{translate('settings:theRecoveryKeyDecryptsCorrespondingBackupsCreatedFrom')}</p>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={saved}
                    disabled={busy}
                    onChange={(event) => setSaved(event.target.checked)}
                  />
                  {translate('settings:iHaveStoredTheRecoveryKeySecurely')}
                </label>
              </>
            ) : (
              <p>{translate('settings:backupsCreatedFromNowOnUseTheBackup')}</p>
            )}
            <p>{translate('settings:existingBackupsStillRequireTheirOriginalPasswordOr')}</p>
            <ErrorNotice message={error} />
          </ModalBody>
          <ModalFooter>
            <Button variant="light" isDisabled={busy} onPress={() => setPending(undefined)}>
              {translate('settings:cancel')}
            </Button>
            <Button
              color={pending?.recipient ? 'primary' : 'danger'}
              isLoading={busy}
              isDisabled={!!pending?.recipient && !saved}
              onPress={() => void save()}
            >
              {pending?.recipient
                ? translate('settings:confirmEnabling')
                : translate('settings:confirmDisabling')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </section>
  );
}
