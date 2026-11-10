import Modal from '../../components/Modal';
import { eventError, errorMessage } from '../../lib/errors.ts';
import { t as translate, currentLocale } from '../../i18n/index.ts';
import { message as uiMessage } from '../../i18n/messages.ts';
import { useMessageState } from '../../i18n/useMessageState.ts';
import { useTranslation } from 'react-i18next';
import { useEffect, useRef, useState } from 'react';
import { Button, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react';
import {
  GetFileHistory,
  ConfigureFileWorkflow,
  ClearFileHistory,
  ReadFileVersion,
  RunFileAction,
} from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { FileHistory } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import type { Document } from '../../../bindings/github.com/Sanjeever/termquay/internal/files/models';
import type { CommandResult } from '../../../bindings/github.com/Sanjeever/termquay/internal/ssh/models';
import ReadonlyDiffView from './ReadonlyDiffView';

import SelectControl from '../../components/SelectControl';

export default function FileHistoryDialog({
  workspace,
  target,
  document,
  dirty,
  onSave,
  onRestore,
  onClose,
}: {
  workspace: string;
  target: string;
  document: Document;
  dirty: boolean;
  onSave(): Promise<boolean>;
  onRestore(value: Document): void;
  onClose(): void;
}) {
  useTranslation();
  const [history, setHistory] = useState<FileHistory>();
  const [enabled, setEnabled] = useState(false);
  const [validate, setValidate] = useState('');
  const [reload, setReload] = useState('');
  const [health, setHealth] = useState('');
  const [savedFile, setSavedFile] = useState(false);
  const [validated, setValidated] = useState(false);
  const [reloaded, setReloaded] = useState(false);
  const [healthy, setHealthy] = useState(false);
  const [actionName, setActionName] = useState('');
  const [selected, setSelected] = useState('');
  const [version, setVersion] = useState<Document>();
  const [result, setResult] = useState<CommandResult>();
  const [error, setError] = useMessageState('');
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<'reload' | 'clear' | 'restore'>();
  const mounted = useRef(true);
  const requests = useRef(new Set<{ cancel(): void }>());
  useEffect(() => {
    mounted.current = true;
    const request = GetFileHistory(workspace, document.path);
    request
      .then((value) => {
        if (mounted.current) {
          setHistory(value);
          setEnabled(value.enabled);
          setValidate(value.validate);
          setReload(value.reload);
          setHealth(value.health_check || '');
        }
      })
      .catch((e) => {
        if (mounted.current) setError(e);
      });
    return () => {
      mounted.current = false;
      request.cancel();
      requests.current.forEach((value) => value.cancel());
    };
  }, [workspace, document.path]);
  useEffect(() => {
    if (!selected) {
      setVersion(undefined);
      return;
    }
    let ended = false;
    setVersion(undefined);
    const request = ReadFileVersion(workspace, document.path, selected);
    request
      .then((value) => {
        if (!ended) setVersion(value);
      })
      .catch((e) => {
        if (!ended) setError(e);
      });
    return () => {
      ended = true;
      request.cancel();
    };
  }, [workspace, document.path, selected]);
  useEffect(() => {
    setValidated(false);
    setReloaded(false);
    setHealthy(false);
    setSavedFile(false);
  }, [
    document.content,
    document.revision,
    document.encoding,
    document.line_ending,
    document.bom,
    validate,
    reload,
    health,
  ]);
  const changed =
    history &&
    (history.enabled !== enabled ||
      history.validate !== validate ||
      history.reload !== reload ||
      (history.health_check || '') !== health);
  async function operation<T>(request: Promise<T> & { cancel(): void }, apply: (value: T) => void) {
    setBusy(true);
    setError('');
    requests.current.add(request);
    try {
      const value = await request;
      if (mounted.current) apply(value);
    } catch (e) {
      if (mounted.current) setError(e);
    } finally {
      requests.current.delete(request);
      if (mounted.current) setBusy(false);
    }
  }
  async function execute(action: 'validate' | 'reload' | 'health', saving = false) {
    setBusy(true);
    setError('');
    setResult(undefined);
    setActionName(
      action === 'validate'
        ? translate('files:validation')
        : action === 'reload'
          ? 'reload'
          : translate('files:healthCheck'),
    );
    if (action === 'validate') {
      setValidated(false);
      setReloaded(false);
      setHealthy(false);
    }
    if (action === 'reload') {
      setReloaded(false);
      setHealthy(false);
    }
    try {
      if (saving && !(await onSave())) throw uiMessage('files:fileNotSavedResolveTheSaveErrorOr');
      if (!mounted.current) return;
      setSavedFile(true);
      if (saving) {
        const request = GetFileHistory(workspace, document.path);
        requests.current.add(request);
        try {
          const latest = await request;
          if (mounted.current) setHistory(latest);
        } finally {
          requests.current.delete(request);
        }
      }
      const script = action === 'reload' ? reload : action === 'health' ? health : validate;
      const request = RunFileAction(workspace, document.path, action, script);
      requests.current.add(request);
      let value: CommandResult;
      try {
        value = await request;
      } finally {
        requests.current.delete(request);
      }
      if (!mounted.current) return;
      setResult(value);
      const passed = !value.error && value.exit_code === 0 && !value.truncated;
      if (action === 'validate') setValidated(passed);
      if (action === 'health') setHealthy(passed);
      if (action === 'reload') {
        setReloaded(passed);
        if (passed && health.trim()) {
          await execute('health');
          return;
        }
      }
      if (!passed)
        setError(
          uiMessage('files:failedTheLiveFileHasBeenSavedFix', {
            value1:
              action === 'validate'
                ? uiMessage('files:validation')
                : action === 'health'
                  ? uiMessage('files:healthCheck')
                  : 'reload',
          }),
        );
    } catch (e) {
      if (mounted.current) setError(e);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  function restore() {
    if (version) {
      onRestore(version);
      onClose();
    }
  }
  return (
    <Modal
      isOpen
      onClose={() => !busy && onClose()}
      isDismissable={!busy}
      size="5xl"
      className="app-dialog file-conflict-dialog"
      scrollBehavior="inside"
    >
      <ModalContent>
        <ModalHeader>{translate('files:configurationChangesAndHistory')}</ModalHeader>
        <ModalBody>
          <p className="file-path">
            {target} · {document.path}
          </p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={enabled}
              disabled={!history || busy}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            {translate('files:encryptHistoryBeforeSavingChanges')}
          </label>
          <div className="file-compare-sides">
            <label className="form-field">
              {translate('files:validationCommand')}
              <textarea
                rows={3}
                value={validate}
                maxLength={8192}
                disabled={!history || busy}
                onChange={(event) => setValidate(event.target.value)}
                spellCheck={false}
              />
            </label>
            <label className="form-field">
              {translate('files:reloadCommand')}
              <textarea
                rows={3}
                value={reload}
                maxLength={8192}
                disabled={!history || busy}
                onChange={(event) => setReload(event.target.value)}
                spellCheck={false}
              />
            </label>
          </div>
          <label className="form-field">
            {translate('files:healthCheckCommandOptional')}
            <textarea
              rows={2}
              value={health}
              maxLength={8192}
              disabled={!history || busy}
              onChange={(event) => setHealth(event.target.value)}
              spellCheck={false}
            />
          </label>
          <div className="button-row" role="status">
            <span>
              {savedFile
                ? translate('files:liveFileSaved')
                : dirty
                  ? translate('files:draftNotSaved')
                  : translate('files:fileSaved')}
            </span>
            <span>
              →{' '}
              {validated
                ? translate('files:validationPassed')
                : translate('files:awaitingValidation')}
            </span>
            <span>
              →{' '}
              {reloaded
                ? translate('files:reloadCompleted')
                : translate('files:awaitingReloadConfirmation')}
            </span>
            {health.trim() && (
              <span>
                →{' '}
                {healthy
                  ? translate('files:healthCheckPassed')
                  : translate('files:awaitingHealthCheck')}
              </span>
            )}
          </div>
          <div className="button-row">
            <Button
              size="sm"
              isDisabled={!changed || busy}
              onPress={() =>
                void operation(
                  ConfigureFileWorkflow(
                    workspace,
                    document.path,
                    enabled,
                    validate,
                    reload,
                    health,
                  ),
                  () =>
                    setHistory((previous) => ({
                      enabled,
                      validate,
                      reload,
                      health_check: health,
                      versions: previous?.versions || [],
                    })),
                )
              }
            >
              {translate('files:saveSettings')}
            </Button>
            <Button
              size="sm"
              color="primary"
              isDisabled={busy || !history || !!changed || !validate.trim()}
              onPress={() => void execute('validate', true)}
            >
              {translate('files:saveAndValidate')}
            </Button>
            <Button
              size="sm"
              variant="light"
              isDisabled={busy || !history || !!changed || !validate.trim() || dirty}
              onPress={() => void execute('validate')}
            >
              {translate('files:validateSavedFile')}
            </Button>
            <Button
              size="sm"
              variant="light"
              isDisabled={busy || !history || !!changed || !reload.trim() || dirty || !validated}
              onPress={() => setConfirmation('reload')}
            >
              {translate('files:confirmReload')}
            </Button>
            <Button
              size="sm"
              variant="light"
              isDisabled={busy || !history || !!changed || !health.trim() || dirty}
              onPress={() => void execute('health')}
            >
              {translate('files:healthCheck')}
            </Button>
          </div>
          {result && (
            <section>
              <p
                className={
                  errorMessage(eventError(result)) || result.exit_code !== 0 || result.truncated
                    ? 'error'
                    : 'session-status'
                }
              >
                {actionName} ·{' '}
                {errorMessage(eventError(result)) ||
                  translate('files:exitCodeS', {
                    value1: result.exit_code,
                    value2: (result.duration_ms / 1000).toFixed(2),
                  })}
                {result.truncated && translate('files:outputTruncatedSuccessCannotBeConfirmed')}
              </p>
              <pre>{result.stdout}</pre>
              <pre className="error">{result.stderr}</pre>
            </section>
          )}
          {!!history?.versions?.length && (
            <>
              <SelectControl
                aria-label={translate('files:versionHistory')}
                value={selected}
                disabled={busy}
                onChange={(event) => setSelected(event.target.value)}
              >
                <option value="">{translate('files:selectHistoricalVersion')}</option>
                {[...history.versions].reverse().map((item) => (
                  <option key={item.id} value={item.id}>
                    {new Date(item.time).toLocaleString(currentLocale())} · {item.size}{' '}
                    {translate('files:bytes2')}
                  </option>
                ))}
              </SelectControl>
              <ReadonlyDiffView
                left={version?.content}
                right={document.content}
                leftLabel={translate('files:versionHistory')}
                rightLabel={translate('files:currentDraft')}
              />
              {version && (
                <div className="button-row">
                  <span className="muted">
                    {translate('files:leftHistoricalVersionRightCurrentDraft')}
                  </span>
                  <Button
                    size="sm"
                    isDisabled={busy}
                    onPress={() => (dirty ? setConfirmation('restore') : restore())}
                  >
                    {translate('files:loadThisVersionIntoDraft')}
                  </Button>
                </div>
              )}
            </>
          )}
          {confirmation && (
            <section className="inspection-detail">
              <p>
                {confirmation === 'reload'
                  ? translate('files:confirmExecutingReloadOnTheCurrentSSHDestination')
                  : confirmation === 'clear'
                    ? translate('files:clearAllLocalHistoryAndOperationSettingsFor')
                    : translate('files:replaceTheUnsavedDraftWithThisHistoricalVersion')}
              </p>
              {confirmation === 'reload' && <pre>{reload}</pre>}
              <div className="button-row">
                <Button size="sm" variant="light" onPress={() => setConfirmation(undefined)}>
                  {translate('files:cancel')}
                </Button>
                <Button
                  size="sm"
                  color="danger"
                  isDisabled={busy}
                  onPress={() => {
                    const action = confirmation;
                    setConfirmation(undefined);
                    if (action === 'reload') void execute('reload');
                    else if (action === 'restore') restore();
                    else
                      void operation(ClearFileHistory(workspace, document.path), () => {
                        setHistory({ enabled: true, validate: '', reload: '', versions: [] });
                        setEnabled(true);
                        setValidate('');
                        setReload('');
                        setHealth('');
                        setSelected('');
                      });
                  }}
                >
                  {translate('files:confirm')}
                </Button>
              </div>
            </section>
          )}
        </ModalBody>
        <ModalFooter>
          <Button
            variant="light"
            isDisabled={busy || !history}
            onPress={() => setConfirmation('clear')}
          >
            {translate('files:clearHistoryAndSettings')}
          </Button>
          <Button variant="light" isDisabled={busy} onPress={onClose}>
            {translate('files:close')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
