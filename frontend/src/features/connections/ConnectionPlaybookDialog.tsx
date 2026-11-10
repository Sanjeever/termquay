import Modal from '../../components/Modal';
import { t as translate } from '../../i18n/index.ts';
import { useMessageState } from '../../i18n/useMessageState.ts';
import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import { Button, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react';
import {
  GetConnectionPlaybook,
  SaveConnectionPlaybook,
  ListCommandTasks,
  ListSnippets,
  ListServiceEntries,
} from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type {
  ConnectionPlaybook,
  ConnectionResource,
} from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import SelectControl from '../../components/SelectControl';

const kinds: Record<string, string> = {
  get file() {
    return translate('connections:configurationFile');
  },
  get directory() {
    return translate('connections:directory');
  },
  get log() {
    return translate('connections:logs');
  },
  get service() {
    return translate('connections:systemdService');
  },
  get container() {
    return translate('connections:dockerContainer');
  },
  get snippet() {
    return translate('connections:commandSnippet');
  },
  get task() {
    return translate('connections:multiHostTask');
  },
  get tunnel() {
    return translate('connections:remoteService');
  },
};
type PlaybookDraft = Omit<ConnectionPlaybook, 'resources'> & { resources: ConnectionResource[] };
export default function ConnectionPlaybookDialog({
  connection,
  onOpen,
  onClose,
}: {
  connection: { id: string; name: string; protocol: string };
  onOpen(resource: ConnectionResource): Promise<void>;
  onClose(): void;
}) {
  useTranslation();
  const [book, setBook] = useState<PlaybookDraft>();
  const [saved, setSaved] = useState('');
  const [editing, setEditing] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useMessageState('');
  const [references, setReferences] = useState<Record<string, { id: string; name: string }[]>>({});
  useEffect(() => {
    let ended = false;
    const request = GetConnectionPlaybook(connection.id);
    request
      .then((value) => {
        if (!ended) {
          const draft = { ...value, resources: value.resources || [] };
          setBook(draft);
          setSaved(JSON.stringify(draft));
          setEditing(!draft.notes && !draft.resources.length);
        }
      })
      .catch((e) => {
        if (!ended) setError(e);
      });
    return () => {
      ended = true;
      request.cancel();
    };
  }, [connection.id]);
  useEffect(() => {
    if (!editing || connection.protocol !== 'ssh') return;
    let ended = false;
    const requests = [ListSnippets(), ListCommandTasks(), ListServiceEntries()] as const;
    Promise.all(requests)
      .then(([snippets, tasks, tunnels]) => {
        if (!ended)
          setReferences({
            snippet: snippets || [],
            task: tasks || [],
            tunnel: (tunnels || [])
              .filter((item) => item.connection_id === connection.id)
              .map((item) => ({ id: item.name, name: item.name })),
          });
      })
      .catch((e) => {
        if (!ended) setError(e);
      });
    return () => {
      ended = true;
      requests.forEach((request) => request.cancel());
    };
  }, [editing, connection.id, connection.protocol]);
  const dirty = !!book && JSON.stringify(book) !== saved;
  function close() {
    if (busy) return;
    if (dirty) setDiscard(true);
    else onClose();
  }
  function update(index: number, resource: ConnectionResource) {
    setBook(
      (previous) =>
        previous && {
          ...previous,
          resources: previous.resources.map((item, i) => (i === index ? resource : item)),
        },
    );
  }
  async function save() {
    if (!book) return;
    setBusy(true);
    setError('');
    try {
      await SaveConnectionPlaybook(connection.id, book);
      setSaved(JSON.stringify(book));
      setEditing(false);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function open(resource: ConnectionResource) {
    setBusy(true);
    setError('');
    try {
      await onOpen(resource);
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      isOpen
      size="3xl"
      scrollBehavior="inside"
      className="app-dialog"
      onClose={close}
      isDismissable={!busy}
    >
      <ModalContent>
        <ModalHeader>
          {connection.name} {translate('connections:playbook2')}
        </ModalHeader>
        <ModalBody>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {!book && !error && <p role="status">{translate('connections:reading')}</p>}
          {book && (
            <>
              {editing ? (
                <label className="form-field">
                  {translate('connections:notes')}
                  <textarea
                    rows={6}
                    value={book.notes}
                    maxLength={16384}
                    disabled={busy}
                    onChange={(event) => setBook({ ...book, notes: event.target.value })}
                  />
                </label>
              ) : (
                book.notes && <pre className="playbook-notes">{book.notes}</pre>
              )}
              {book.resources.map((resource, index) =>
                editing ? (
                  <div className="playbook-resource" key={index}>
                    <input
                      aria-label={translate('connections:resourceName', { value1: index + 1 })}
                      placeholder={translate('connections:name')}
                      maxLength={128}
                      value={resource.name}
                      disabled={busy}
                      onChange={(event) => update(index, { ...resource, name: event.target.value })}
                    />
                    <SelectControl
                      aria-label={translate('connections:resourceType', { value1: index + 1 })}
                      value={resource.kind}
                      disabled={busy}
                      onChange={(event) =>
                        update(index, { ...resource, kind: event.target.value, target: '' })
                      }
                    >
                      {Object.entries(kinds).map(([kind, label]) => (
                        <option key={kind} value={kind}>
                          {label}
                        </option>
                      ))}
                    </SelectControl>
                    {references[resource.kind] ? (
                      <SelectControl
                        aria-label={translate('connections:resourceDestination', {
                          value1: index + 1,
                        })}
                        value={resource.target}
                        disabled={busy}
                        onChange={(event) =>
                          update(index, {
                            ...resource,
                            target: event.target.value,
                            name:
                              resource.name ||
                              references[resource.kind].find(
                                (item) => item.id === event.target.value,
                              )?.name ||
                              '',
                          })
                        }
                      >
                        <option value="">{translate('connections:selectDestination')}</option>
                        {resource.target &&
                          !references[resource.kind].some(
                            (item) => item.id === resource.target,
                          ) && (
                            <option value={resource.target}>
                              {translate('connections:originalReferenceNoLongerValid')}
                            </option>
                          )}
                        {references[resource.kind].map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                          </option>
                        ))}
                      </SelectControl>
                    ) : (
                      <input
                        aria-label={translate('connections:resourceDestination', {
                          value1: index + 1,
                        })}
                        placeholder={
                          ['file', 'directory', 'log'].includes(resource.kind)
                            ? translate('connections:absolutePath')
                            : translate('connections:serviceOrContainerName')
                        }
                        value={resource.target}
                        maxLength={4096}
                        disabled={busy}
                        onChange={(event) =>
                          update(index, { ...resource, target: event.target.value })
                        }
                      />
                    )}
                    <Button
                      size="sm"
                      variant="light"
                      isDisabled={busy}
                      onPress={() =>
                        setBook({
                          ...book,
                          resources: book.resources.filter((_, i) => i !== index),
                        })
                      }
                    >
                      {translate('connections:remove')}
                    </Button>
                  </div>
                ) : (
                  <button
                    className="playbook-link"
                    key={index}
                    disabled={busy || connection.protocol !== 'ssh'}
                    onClick={() => void open(resource)}
                  >
                    <strong>{resource.name}</strong>
                    <span className="muted">
                      {kinds[resource.kind]} ·{' '}
                      {['snippet', 'task'].includes(resource.kind) ? '' : resource.target}
                    </span>
                  </button>
                ),
              )}
              {editing && connection.protocol === 'ssh' && (
                <Button
                  size="sm"
                  variant="light"
                  className="self-start"
                  isDisabled={busy || book.resources.length >= 32}
                  onPress={() =>
                    setBook({
                      ...book,
                      resources: [...book.resources, { kind: 'file', name: '', target: '' }],
                    })
                  }
                >
                  {translate('connections:addQuickResource')}
                </Button>
              )}
              {discard && (
                <section className="inspection-detail">
                  <p>{translate('connections:discardUnsavedPlaybookChanges')}</p>
                  <div className="button-row">
                    <Button size="sm" variant="light" onPress={() => setDiscard(false)}>
                      {translate('connections:continueEditing')}
                    </Button>
                    <Button size="sm" color="danger" onPress={onClose}>
                      {translate('connections:discardChanges')}
                    </Button>
                  </div>
                </section>
              )}
            </>
          )}
        </ModalBody>
        <ModalFooter>
          {editing ? (
            <Button
              color="primary"
              isLoading={busy}
              isDisabled={!book || !dirty}
              onPress={() => void save()}
            >
              {translate('connections:save')}
            </Button>
          ) : (
            <Button variant="light" isDisabled={!book || busy} onPress={() => setEditing(true)}>
              {translate('connections:edit')}
            </Button>
          )}
          <Button variant="light" isDisabled={busy} onPress={close}>
            {translate('connections:close')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
