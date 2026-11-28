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
  alternateName?: string;
  priority?: number;
  queryOnly?: boolean;
  kind: CommandKind;
  run(): void;
};

function scopeLabel(scope: 'all' | CommandKind) {
  if (scope === 'all') return translate('common:all');
  if (scope === 'workspace') return translate('common:workspaces2');
  if (scope === 'connection') return translate('common:connect');
  return translate('common:commands');
}

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
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const filtered = commandResults(commands, query, scope);
  const activeIndex = Math.min(selected, Math.max(0, filtered.length - 1));
  useEffect(() => {
    list.current?.querySelector(`#command-${activeIndex}`)?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, query, scope]);
  function run(index: number) {
    const command = filtered[index];
    if (command) {
      onClose();
      command.run();
    }
  }
  function option(command: WorkbenchCommand, index: number) {
    return (
      <div
        role="option"
        aria-selected={index === activeIndex}
        id={`command-${index}`}
        key={command.id}
        className={`command-result${index === activeIndex ? ' selected' : ''}`}
        onMouseMove={() => setSelected(index)}
        onClick={() => run(index)}
      >
        <Icon
          name={
            command.kind === 'workspace'
              ? 'terminal'
              : command.kind === 'connection'
                ? 'connections'
                : 'chevron'
          }
          width="16"
        />
        <span>
          {command.label}
          {command.detail && <small>{command.detail}</small>}
        </span>
        {command.shortcut && command.shortcut !== translate('common:unassigned') && (
          <kbd>{command.shortcut}</kbd>
        )}
      </div>
    );
  }
  return (
    <Modal
      isOpen
      onClose={onClose}
      hideCloseButton
      disableAnimation
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
          ref={input}
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
          aria-activedescendant={filtered.length ? `command-${activeIndex}` : undefined}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              const step = e.key === 'ArrowDown' ? 1 : -1;
              setSelected((activeIndex + step + filtered.length) % (filtered.length || 1));
            }
            if (e.key === 'Enter') {
              e.preventDefault();
              run(activeIndex);
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
                input.current?.focus();
              }}
            >
              {scopeLabel(kind)}
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
          {query.trim() || scope !== 'all'
            ? filtered.map(option)
            : commandKinds.map((kind) => {
                const options = filtered.map((command, index) =>
                  command.kind === kind ? option(command, index) : null,
                );
                return options.some(Boolean) ? (
                  <div key={kind} role="group" aria-label={scopeLabel(kind)}>
                    <div className="command-group-heading" aria-hidden="true">
                      {scopeLabel(kind)}
                    </div>
                    {options}
                  </div>
                ) : null;
              })}
          {filtered.length === 0 && (
            <p className="sidebar-empty">{translate('common:noMatchingResults')}</p>
          )}
        </div>
      </ModalContent>
    </Modal>
  );
}
