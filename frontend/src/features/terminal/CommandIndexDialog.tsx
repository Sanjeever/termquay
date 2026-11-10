import Modal from '../../components/Modal';
import { t as translate, currentLocale } from '../../i18n/index.ts';
import { message as uiMessage } from '../../i18n/messages.ts';
import { useMessageState } from '../../i18n/useMessageState.ts';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { Button, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react';
import { SaveSnippet } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { CommandIndexEntry } from './shellIntegration';

export default function CommandIndexDialog({
  entries,
  enabled,
  pending,
  canEnable,
  onEnable,
  onGoTo,
  onOutput,
  onClose,
}: {
  entries: CommandIndexEntry[];
  enabled: boolean;
  pending: boolean;
  canEnable: boolean;
  onEnable(): void;
  onGoTo(id: number): boolean;
  onOutput(id: number): string;
  onClose(): void;
}) {
  useTranslation();
  const [filter, setFilter] = useState('');
  const [error, setError] = useMessageState('');
  const [snippet, setSnippet] = useState<CommandIndexEntry>();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const filtered = entries
    .filter((entry) =>
      `${entry.command || ''} ${entry.directory} ${entry.exitCode ?? ''}`
        .toLowerCase()
        .includes(filter.toLowerCase()),
    )
    .slice()
    .reverse();
  async function copy(value: () => string) {
    try {
      await navigator.clipboard.writeText(value());
      setError('');
    } catch (e) {
      setError(e);
    }
  }
  return (
    <>
      <Modal
        isOpen
        onClose={onClose}
        size="4xl"
        className="app-dialog session-commands-dialog"
        scrollBehavior="inside"
      >
        <ModalContent>
          <ModalHeader>{translate('terminal:commandsInThisSession')}</ModalHeader>
          <ModalBody>
            {!enabled && (
              <div className="command-recording-setup">
                <div>
                  <p>
                    {pending
                      ? translate('terminal:waitingForShellCommandRecording')
                      : translate(
                          'terminal:enablingRecordsSubsequentCommandsUntilThisTerminalCloses',
                        )}
                  </p>
                  {pending && (
                    <p className="muted">
                      {translate('terminal:executeTheReviewedIntegrationCommandInTheTerminal')}
                    </p>
                  )}
                </div>
                <Button size="sm" variant="bordered" isDisabled={!canEnable} onPress={onEnable}>
                  {pending
                    ? translate('terminal:enableAgain')
                    : translate('terminal:enableCommandRecording')}
                </Button>
              </div>
            )}
            {!!entries.length && (
              <input
                className="command-index-search"
                aria-label={translate('terminal:searchThisSessionSCommands')}
                placeholder={translate('terminal:searchCommandDirectoryOrExitCode')}
                autoFocus
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              />
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            {!!entries.length && (
              <div className="command-index-table">
                <table>
                  <thead>
                    <tr>
                      <th>{translate('terminal:commandDirectory')}</th>
                      <th>{translate('terminal:time')}</th>
                      <th>{translate('terminal:resultDuration')}</th>
                      <th>{translate('terminal:actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((entry) => (
                      <tr key={entry.id}>
                        <td>
                          <button
                            className="command-index-command"
                            disabled={!entry.canLocate}
                            onClick={() => {
                              if (onGoTo(entry.id)) onClose();
                              else setError(uiMessage('terminal:outputEvictedFromTerminalBuffer'));
                            }}
                          >
                            {entry.command || translate('terminal:commandTextUnavailable')}
                          </button>
                          <div className="muted file-path">
                            {entry.directory || translate('terminal:unknownDirectory')}
                            {!entry.canLocate && translate('terminal:outputCleared')}
                          </div>
                        </td>
                        <td>{new Date(entry.startedAt).toLocaleTimeString(currentLocale())}</td>
                        <td className={entry.exitCode && entry.exitCode !== '0' ? 'error' : ''}>
                          {entry.duration === undefined ? (
                            translate('terminal:executing')
                          ) : (
                            <>
                              {entry.exitCode === undefined
                                ? translate('terminal:unknownExitStatus')
                                : entry.exitCode === '0'
                                  ? translate('terminal:succeeded')
                                  : translate('terminal:failed', { value1: entry.exitCode })}
                              <div className="muted">{(entry.duration / 1000).toFixed(2)}s</div>
                            </>
                          )}
                        </td>
                        <td>
                          <div className="button-row">
                            {entry.command && (
                              <>
                                <button
                                  className="session-tool"
                                  onClick={() => void copy(() => entry.command!)}
                                >
                                  {translate('terminal:copyCommand')}
                                </button>
                                <button
                                  className="session-tool"
                                  onClick={() => {
                                    setName('');
                                    setSnippet(entry);
                                    setError('');
                                  }}
                                >
                                  {translate('terminal:saveSnippet')}
                                </button>
                              </>
                            )}
                            <button
                              className="session-tool"
                              disabled={!entry.canCopyOutput}
                              onClick={() => void copy(() => onOutput(entry.id))}
                            >
                              {translate('terminal:copyOutput')}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {!!entries.length && !filtered.length && (
              <p className="muted">{translate('terminal:noMatchingCommands')}</p>
            )}
            {!entries.length && enabled && (
              <p className="command-index-empty muted" role="status">
                {translate('terminal:waitingForNextCommand')}
              </p>
            )}
            {!!entries.length && (
              <p className="muted">
                {translate('terminal:recordsAreClearedWhenThisTerminalClosesOutput')}
              </p>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={onClose}>
              {translate('terminal:close')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
      <Modal
        isOpen={!!snippet}
        onClose={() => !busy && setSnippet(undefined)}
        className="app-dialog"
      >
        <ModalContent>
          <ModalHeader>{translate('terminal:saveCommandSnippet')}</ModalHeader>
          <ModalBody>
            <label className="form-field">
              {translate('terminal:name')}
              <input
                autoFocus
                value={name}
                maxLength={128}
                disabled={busy}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <pre className="paste-preview">{snippet?.command}</pre>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="light" isDisabled={busy} onPress={() => setSnippet(undefined)}>
              {translate('terminal:cancel')}
            </Button>
            <Button
              color="primary"
              isLoading={busy}
              isDisabled={!name.trim()}
              onPress={async () => {
                if (!snippet?.command) return;
                setBusy(true);
                try {
                  await SaveSnippet({
                    id: '',
                    name: name.trim(),
                    group: '',
                    body: snippet.command,
                  });
                  setSnippet(undefined);
                  setError('');
                } catch (e) {
                  setError(e);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {translate('terminal:save')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}
