import Modal from './Modal';
import { t as translate } from '../i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { useEffect, useRef, useState } from 'react';
import { ModalContent, Input } from '@heroui/react';
import Icon from './Icon';
import { commandResults, commandKinds, type CommandKind } from '../lib/commands';

export type WorkbenchCommand = {
  id: string;
  label: string;
  detail?: string;
  shortcut?: string;
  search?: string;
  kind: CommandKind;
  run(): void;
};

export default function CommandPalette({
  commands,
  onClose,
  error,
  initialScope = 'all',
  initialQuery = '',
}: {
  commands: WorkbenchCommand[];
  onClose(): void;
  error?: string;
  initialScope?: 'all' | CommandKind;
  initialQuery?: string;
}) {
  useTranslation();
  const [query, setQuery] = useState(initialQuery);
  const [selected, setSelected] = useState(0);
  const [scope, setScope] = useState(initialScope);
  const list = useRef<HTMLDivElement>(null);
  const filtered = commandResults(commands, query, scope);
  useEffect(() => {
    list.current?.querySelector(`#command-${selected}`)?.scrollIntoView({ block: 'nearest' });
  }, [selected]);
  function run(index: number) {
    const command = filtered[index];
    if (command) {
      onClose();
      command.run();
    }
  }
  return (
    <Modal
      isOpen
      onClose={onClose}
      hideCloseButton
      className="app-dialog command-palette"
      placement="top"
      aria-label={translate('common:commandSearch2')}
    >
      <ModalContent
        onKeyDownCapture={(e) => {
          if (e.nativeEvent.isComposing) {
            e.stopPropagation();
            return;
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <Input
          autoFocus
          aria-label={translate('common:searchConnectionsAndCommands')}
          placeholder={translate('common:searchConnectionsWorkspacesAndCommands')}
          value={query}
          onValueChange={(value) => {
            setQuery(value);
            setSelected(0);
          }}
          startContent={<Icon name="search" />}
          role="combobox"
          aria-expanded="true"
          aria-controls="command-results"
          aria-activedescendant={filtered.length ? `command-${selected}` : undefined}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              setSelected(
                (prev) =>
                  (prev + (e.key === 'ArrowDown' ? 1 : -1) + filtered.length) %
                  (filtered.length || 1),
              );
            }
            if (e.key === 'Enter') {
              e.preventDefault();
              run(selected);
            }
          }}
        />
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div
          className="protocol-filters command-scopes"
          role="group"
          aria-label={translate('common:searchScope')}
        >
          {(['all', ...commandKinds] as const).map((kind) => (
            <button
              key={kind}
              aria-pressed={scope === kind}
              onClick={() => {
                setScope(kind);
                setSelected(0);
              }}
            >
              {kind === 'all'
                ? translate('common:all')
                : kind === 'workspace'
                  ? translate('common:workspaces2')
                  : kind === 'connection'
                    ? translate('common:connect')
                    : translate('common:commands')}
            </button>
          ))}
        </div>
        <div
          className="command-results"
          ref={list}
          role="listbox"
          id="command-results"
          aria-label={translate('common:searchResults')}
        >
          {commandKinds.map((kind) => (
            <div
              key={kind}
              role="group"
              aria-label={
                kind === 'workspace'
                  ? translate('common:workspaces2')
                  : kind === 'connection'
                    ? translate('common:connect')
                    : translate('common:commands')
              }
            >
              {filtered.some((c) => c.kind === kind) && (
                <div className="command-group-heading" aria-hidden="true">
                  {kind === 'workspace'
                    ? translate('common:workspaces2')
                    : kind === 'connection'
                      ? translate('common:connect')
                      : translate('common:commands')}
                </div>
              )}
              {filtered.map((c, i) =>
                c.kind !== kind ? null : (
                  <div
                    role="option"
                    aria-selected={i === selected}
                    id={`command-${i}`}
                    key={c.id}
                    className={`command-result ${i === selected ? 'selected' : ''}`}
                    onMouseMove={() => setSelected(i)}
                    onClick={() => run(i)}
                  >
                    <Icon
                      name={
                        c.kind === 'workspace'
                          ? 'terminal'
                          : c.kind === 'connection'
                            ? 'connections'
                            : 'chevron'
                      }
                      width="16"
                    />
                    <span>
                      {c.label}
                      {c.detail && <small>{c.detail}</small>}
                    </span>
                    {c.shortcut && c.shortcut !== translate('common:unassigned') && (
                      <kbd>{c.shortcut}</kbd>
                    )}
                  </div>
                ),
              )}
            </div>
          ))}
          {filtered.length === 0 && (
            <p className="sidebar-empty">{translate('common:noMatchingResults')}</p>
          )}
        </div>
      </ModalContent>
    </Modal>
  );
}
