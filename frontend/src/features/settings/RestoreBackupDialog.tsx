import Modal from '../../components/Modal';
import { t as translate, currentLocale } from '../../i18n/index.ts';
import { useMessageState } from '../../i18n/useMessageState.ts';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '../../lib/errors';
import { useEffect, useRef, useState } from 'react';
import { Button, Input, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react';
import {
  CancelRestorePreview,
  ConfirmRestoreWithOptions,
  GetPortableUI,
  PreviewLocalRestore,
  PreviewSavedRestore,
  PreviewLocalRestoreWithRecovery,
  PreviewSavedRestoreWithRecovery,
} from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { RestorePreview } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import { applyPortableUI } from './portable';
import { backupSettingNames, workflowBackupOptions } from './backupContent';
import SelectControl from '../../components/SelectControl';

export default function RestoreBackupDialog({
  path,
  hasConnections,
  recoverySaved,
  onRestored,
  onClose,
  onError,
}: {
  path: string;
  hasConnections: boolean;
  recoverySaved: boolean;
  onRestored(): void;
  onClose(): void;
  onError(message: string): void;
}) {
  useTranslation();
  const [preview, setPreview] = useState<RestorePreview>();
  const previewID = useRef('');
  const [mode, setMode] = useState<'import' | 'replace'>(hasConnections ? 'import' : 'replace');
  const [selected, setSelected] = useState<string[]>([]);
  const [settings, setSettings] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useMessageState('');
  const [completed, setCompleted] = useState(false);
  const [showPassword, setShowPassword] = useState(!recoverySaved);
  const [unlockMode, setUnlockMode] = useState<'password' | 'key'>('password');
  const mounted = useRef(true);
  const request = useRef<ReturnType<typeof PreviewSavedRestore>>();

  async function unlock(password: string, usingKey = unlockMode === 'key') {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      request.current = usingKey
        ? path
          ? PreviewSavedRestoreWithRecovery(path, password)
          : PreviewLocalRestoreWithRecovery(password)
        : path
          ? PreviewSavedRestore(path, password)
          : PreviewLocalRestore(password);
      const value = await request.current;
      if (!mounted.current) {
        if (value.id) await CancelRestorePreview(value.id);
        return;
      }
      if (!value.id) {
        onClose();
        return;
      }
      previewID.current = value.id;
      setPreview(value);
      setShowPassword(false);
      setSelected(
        (value.connections || []).length <= 256
          ? (value.connections || []).map((connection) => connection.id)
          : [],
      );
      setSettings(
        mode === 'replace' ? (value.settings || []).filter((key) => key === 'snippets') : [],
      );
    } catch (error) {
      if (mounted.current) {
        setError(error);
        setShowPassword(true);
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  /* oxlint-disable react/exhaustive-deps -- Open one restore preview for this dialog; editing unlock fields must not cancel it or trigger another unlock. */
  useEffect(() => {
    mounted.current = true;
    if (recoverySaved) void unlock('');
    return () => {
      mounted.current = false;
      request.current?.cancel();
      if (previewID.current)
        void CancelRestorePreview(previewID.current).catch((error) => onError(errorMessage(error)));
    };
  }, []);
  /* oxlint-enable react/exhaustive-deps */

  function chooseMode(next: 'import' | 'replace') {
    setMode(next);
    setConfirmed(false);
    setSettings(
      next === 'replace' ? (preview?.settings || []).filter((key) => key === 'snippets') : [],
    );
  }
  const connections = preview?.connections || [];
  const chosen = new Set(selected);
  const byID = new Map(connections.map((connection) => [connection.id, connection]));
  function includeJump(id: string) {
    const jump = byID.get(id)?.jump_id;
    if (jump && !chosen.has(jump)) {
      chosen.add(jump);
      includeJump(jump);
    }
  }
  selected.forEach(includeJump);
  const imported = connections.filter((connection) => chosen.has(connection.id));
  const credentialCount = new Set(
    imported.map((connection) => connection.credential_id).filter(Boolean),
  ).size;
  async function restore() {
    if (!preview || busy) return;
    setBusy(true);
    setError('');
    try {
      await ConfirmRestoreWithOptions(preview.id, selected, mode === 'replace', settings);
      previewID.current = '';
      setCompleted(true);
      onRestored();
      if (settings.includes('appearance') || settings.includes('shortcuts'))
        applyPortableUI(await GetPortableUI());
      onClose();
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      isOpen
      onClose={() => {
        if (!busy) onClose();
      }}
      isDismissable={!busy}
      isKeyboardDismissDisabled={busy}
      size="2xl"
      scrollBehavior="inside"
      className="app-dialog restore-backup-dialog"
    >
      <ModalContent>
        <ModalHeader>
          {completed ? translate('settings:dataRestored') : translate('settings:restoreBackup')}
        </ModalHeader>
        <ModalBody>
          {busy && !preview && (
            <p role="status" className="muted">
              {translate('settings:readingAndUnlockingBackup')}
            </p>
          )}
          {showPassword && !preview && (
            <>
              <SelectControl
                aria-label={translate('settings:backupUnlockMethod')}
                value={unlockMode}
                disabled={busy}
                onChange={(event) => {
                  setUnlockMode(event.target.value as 'password' | 'key');
                  setError('');
                }}
              >
                <option value="password">{translate('settings:backupPassword')}</option>
                <option value="key">{translate('settings:recoveryKey')}</option>
              </SelectControl>
              <form
                id="unlock-backup"
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = event.currentTarget;
                  const password = form.elements.namedItem('password') as HTMLInputElement;
                  const value = password.value;
                  password.value = '';
                  void unlock(value);
                }}
              >
                <Input
                  key={unlockMode}
                  name="password"
                  label={
                    unlockMode === 'key'
                      ? translate('settings:recoveryKey')
                      : translate('settings:thisBackupSEncryptionPassword')
                  }
                  labelPlacement="outside"
                  type="password"
                  autoComplete="off"
                  maxLength={4096}
                  size="sm"
                  isRequired
                  isDisabled={busy}
                  autoFocus
                />
              </form>
              {unlockMode === 'key' && (
                <Button
                  size="sm"
                  variant="bordered"
                  isDisabled={busy}
                  onPress={() => void unlock('', true)}
                >
                  {translate('settings:selectRecoveryKeyFile')}
                </Button>
              )}
            </>
          )}
          {preview && (
            <>
              <div className="backup-restore-source">
                <strong>
                  {preview.device_name ||
                    translate('settings:device', { value1: preview.device_id.slice(0, 8) })}
                </strong>
                <time dateTime={preview.created_at}>
                  {new Date(preview.created_at).toLocaleString(currentLocale())}
                </time>
                <span className="muted">
                  {connections.length} {translate('settings:connections')}
                  {preview.credentials} {translate('settings:credentials3')}
                  {preview.credentials_included == null
                    ? translate('settings:credentialScopeUnknown')
                    : ''}
                </span>
              </div>
              <fieldset className="backup-restore-modes" disabled={busy || completed}>
                <legend>{translate('settings:restoreMethod')}</legend>
                <label>
                  <input
                    type="radio"
                    name="restore-mode"
                    checked={mode === 'import'}
                    onChange={() => chooseMode('import')}
                  />
                  {translate('settings:importConnectionCopies')}
                </label>
                <label>
                  <input
                    type="radio"
                    name="restore-mode"
                    checked={mode === 'replace'}
                    onChange={() => chooseMode('replace')}
                  />
                  {translate('settings:replaceLocalConnections')}
                </label>
              </fieldset>
              {mode === 'import' ? (
                <>
                  <div className="backup-import-toolbar">
                    <Input
                      aria-label={translate('settings:filterRestoredConnections')}
                      placeholder={translate('settings:searchConnections')}
                      size="sm"
                      value={search}
                      onValueChange={setSearch}
                      isDisabled={busy || completed}
                    />
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={!!connections.length && selected.length === connections.length}
                        disabled={busy || completed || connections.length > 256}
                        onChange={(event) =>
                          setSelected(
                            event.target.checked
                              ? connections.map((connection) => connection.id)
                              : [],
                          )
                        }
                      />
                      {translate('settings:selectAll')}
                    </label>
                    <span className="muted">
                      {translate('settings:selected')}
                      {selected.length}/256
                    </span>
                  </div>
                  <div className="backup-connection-list">
                    {connections
                      .filter((connection) =>
                        `${connection.name} ${connection.host}`
                          .toLowerCase()
                          .includes(search.toLowerCase()),
                      )
                      .map((connection) => (
                        <label className="checkbox-label" key={connection.id}>
                          <input
                            type="checkbox"
                            checked={selected.includes(connection.id)}
                            disabled={
                              busy ||
                              completed ||
                              (!selected.includes(connection.id) && selected.length >= 256)
                            }
                            onChange={(event) =>
                              setSelected((previous) =>
                                event.target.checked
                                  ? [...previous, connection.id]
                                  : previous.filter((id) => id !== connection.id),
                              )
                            }
                          />
                          <span>
                            {connection.name}
                            <small className="muted">{connection.host}</small>
                          </span>
                        </label>
                      ))}
                  </div>
                  <p className="muted">
                    {translate('settings:importImpact', {
                      connections: translate('common:connectionCount', { count: imported.length }),
                      credentials: translate('common:credentialCount', { count: credentialCount }),
                    })}
                  </p>
                </>
              ) : (
                <>
                  <div className="backup-restore-diff">
                    {(
                      [
                        [translate('settings:new'), preview.added],
                        [translate('settings:configurationUpdates'), preview.updated],
                        [translate('settings:credentialUpdates'), preview.credential_updated],
                        [translate('settings:delete'), preview.removed],
                      ] as const
                    ).map(([name, values]) => (
                      <details key={name}>
                        <summary>
                          {name} {values?.length || 0}
                        </summary>
                        <ul>
                          {values?.map((value, index) => (
                            <li key={index}>{value}</li>
                          ))}
                        </ul>
                      </details>
                    ))}
                  </div>
                  {(preview.credentials_included === false || !preview.credentials) && (
                    <p role="alert" className="error">
                      {translate('settings:thisBackupContainsNoSavedConnectionPasswordsOr')}
                    </p>
                  )}
                  <p className="muted">
                    {translate('settings:anEncryptedSafetyCopyIsSavedLocallyBefore')}
                  </p>
                </>
              )}
              {!!preview.settings?.length && (
                <fieldset className="backup-restore-settings" disabled={busy || completed}>
                  <legend>{translate('settings:alsoRestore')}</legend>
                  {preview.settings.map((key) => (
                    <label className="checkbox-label" key={key}>
                      <input
                        type="checkbox"
                        checked={settings.includes(key)}
                        onChange={(event) =>
                          setSettings((previous) =>
                            event.target.checked
                              ? [...previous, key]
                              : previous.filter((item) => item !== key),
                          )
                        }
                      />
                      {backupSettingNames()[key] || key}
                      {preview.setting_counts?.[key] !== undefined &&
                        translate('settings:items', { value1: preview.setting_counts[key] })}
                      {key === 'snippets'
                        ? translate('settings:replaceLocalSnippets')
                        : workflowBackupOptions.some((option) => option.key === key)
                          ? mode === 'import'
                            ? translate('settings:append')
                            : translate('settings:replaceLocalSettingsOfThisType')
                          : ''}
                    </label>
                  ))}
                </fieldset>
              )}
              {settings.includes('tunnel_presets') && (
                <p className="muted">
                  {translate('settings:restoredTunnelPresetsHaveAutomaticStartupPausedUntil')}
                </p>
              )}
              {!!preview.path_hints?.filter((hint) => settings.includes(hint.setting)).length && (
                <details>
                  <summary>
                    {translate('settings:localPathsToVerifyOnTheDestinationDevice')}
                  </summary>
                  <ul>
                    {preview.path_hints
                      .filter((hint) => settings.includes(hint.setting))
                      .map((hint, index) => (
                        <li key={index}>
                          {hint.name}
                          <span className="file-path">{hint.path}</span>
                          <span className="muted">
                            {hint.setting === 'connection_preferences'
                              ? translate(
                                  'settings:reselectPrivateKeyFilesOriginalPathsStayDisabled',
                                )
                              : translate('settings:verifyLocalDirectoriesBeforeDirectorySync')}
                          </span>
                        </li>
                      ))}
                  </ul>
                </details>
              )}
              {mode === 'replace' && !completed && (
                <label className="checkbox-label backup-replace-confirm">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    disabled={busy}
                    onChange={(event) => setConfirmed(event.target.checked)}
                  />
                  {translate('settings:confirmReplacingLocalConnectionsGroupsAndCredentials')}
                </label>
              )}
            </>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
        </ModalBody>
        <ModalFooter>
          <Button size="sm" variant="light" isDisabled={busy} onPress={onClose}>
            {completed ? translate('settings:off') : translate('settings:cancel')}
          </Button>
          {!preview && showPassword && (
            <Button size="sm" color="primary" type="submit" form="unlock-backup" isLoading={busy}>
              {translate('settings:unlock')}
            </Button>
          )}
          {preview && !completed && (
            <Button
              size="sm"
              color={mode === 'replace' ? 'danger' : 'primary'}
              isLoading={busy}
              isDisabled={mode === 'replace' ? !confirmed : !selected.length}
              onPress={() => void restore()}
            >
              {mode === 'replace'
                ? translate('settings:replaceLocalConnections')
                : translate('settings:importConnectionCopies')}
            </Button>
          )}
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
