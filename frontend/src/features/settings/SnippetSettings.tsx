import Modal from '../../components/Modal';
import { t as translate, currentLocale } from '../../i18n/index.ts';
import { useMessageState } from '../../i18n/useMessageState.ts';
import { useTranslation } from 'react-i18next';
import Tooltip from '../../components/Tooltip';

import { useCallback, useEffect, useState } from 'react';
import { Button, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@heroui/react';
import {
  ListSnippets,
  SaveSnippet,
  DeleteSnippet,
} from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { Snippet } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import ErrorNotice from '../../components/ErrorNotice';
export default function SnippetSettings() {
  useTranslation();
  const [items, setItems] = useState<Snippet[]>([]);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Snippet>();
  const [deleting, setDeleting] = useState<Snippet>();
  const [error, setError] = useMessageState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      setItems((await ListSnippets()) || []);
      setError('');
    } catch (e) {
      setError(e);
    }
  }, [setError]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <div className="settings-section">
      <h2>{translate('settings:commandSnippets')}</h2>
      <div className="button-row">
        <input
          aria-label={translate('settings:searchCommandSnippets')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Button
          size="sm"
          onPress={() => {
            setError('');
            setEditing({ id: '', name: '', group: '', body: '' });
          }}
        >
          {translate('settings:newSnippet')}
        </Button>
      </div>
      {!editing && !deleting && <ErrorNotice message={error} onDismiss={() => setError('')} />}
      {items
        .filter((s) => `${s.name} ${s.group}`.toLowerCase().includes(query.toLowerCase()))
        .sort(
          (a, b) =>
            a.group.localeCompare(b.group, currentLocale()) ||
            a.name.localeCompare(b.name, currentLocale()),
        )
        .map((s) => (
          <div className="settings-row" key={s.id}>
            <span>
              {s.name}
              {s.group && <small className="muted"> · {s.group}</small>}
            </span>
            <div className="button-row">
              <Button
                size="sm"
                variant="light"
                onPress={() => {
                  setError('');
                  setEditing(s);
                }}
              >
                {translate('settings:edit')}
              </Button>
              <Button
                size="sm"
                variant="light"
                onPress={() => {
                  setError('');
                  setDeleting(s);
                }}
              >
                {translate('settings:delete')}
              </Button>
            </div>
          </div>
        ))}
      <Modal
        isOpen={!!editing}
        onClose={() => {
          if (!busy) {
            setEditing(undefined);
            setError('');
          }
        }}
        className="app-dialog"
        scrollBehavior="inside"
      >
        <ModalContent>
          <ModalHeader>
            {editing?.id ? translate('settings:editSnippet') : translate('settings:newSnippet')}
          </ModalHeader>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!editing) return;
              setBusy(true);
              setError('');
              try {
                await SaveSnippet(editing);
                setEditing(undefined);
                await load();
              } catch (e) {
                setError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            <ModalBody>
              {editing && (
                <>
                  <label className="form-field">
                    {translate('settings:name')}
                    <input
                      autoFocus
                      required
                      maxLength={128}
                      value={editing.name}
                      onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    />
                  </label>
                  <label className="form-field">
                    {translate('settings:group')}
                    <input
                      maxLength={128}
                      value={editing.group}
                      onChange={(e) => setEditing({ ...editing, group: e.target.value })}
                    />
                  </label>
                  <Tooltip
                    content={translate('settings:useForNamedParameters', { name: '{{name}}' })}
                  >
                    <label className="form-field">
                      {translate('settings:body')}
                      <textarea
                        aria-label={translate('settings:snippetBody')}
                        required
                        spellCheck={false}
                        rows={8}
                        value={editing.body}
                        onChange={(e) => setEditing({ ...editing, body: e.target.value })}
                      />
                    </label>
                  </Tooltip>
                </>
              )}
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
              <Button type="submit" color="primary" isLoading={busy}>
                {translate('settings:saveSnippet')}
              </Button>
            </ModalFooter>
          </form>
        </ModalContent>
      </Modal>
      <Modal
        isOpen={!!deleting}
        onClose={() => {
          if (!busy) {
            setDeleting(undefined);
            setError('');
          }
        }}
        className="app-dialog"
      >
        <ModalContent>
          <ModalHeader>{translate('settings:deleteSnippet')}</ModalHeader>
          <ModalBody>
            <p>{deleting?.name}</p>
            <ErrorNotice message={error} onDismiss={() => setError('')} />
          </ModalBody>
          <ModalFooter>
            <Button
              variant="light"
              isDisabled={busy}
              onPress={() => {
                setDeleting(undefined);
                setError('');
              }}
            >
              {translate('settings:cancel')}
            </Button>
            <Button
              color="danger"
              isLoading={busy}
              onPress={async () => {
                if (!deleting) return;
                setBusy(true);
                try {
                  await DeleteSnippet(deleting.id);
                  setDeleting(undefined);
                  await load();
                } catch (e) {
                  setError(e);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {translate('settings:deleteSnippet')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}
