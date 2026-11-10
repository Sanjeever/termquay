import { t as translate } from '../../i18n/index.ts';
import { useTranslation } from 'react-i18next';
import Tooltip from '../Tooltip';
import Icon from '../Icon';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { DropdownTrigger, DropdownMenu, DropdownItem } from '@heroui/react';
import { Dropdown } from '../Popover';
import {
  commandAttentionLabels,
  type CommandAttention,
} from '../../features/terminal/commandAttention';

export default function WorkspaceTabs({
  items,
  active,
  onSelect,
  onClose,
  onNew,
  onRename,
  onMove,
  onSearch,
  newAction,
  disableNew = false,
}: {
  items: {
    id: string;
    name: string;
    environment?: string;
    rdp?: unknown;
    dirty?: boolean;
    attention?: CommandAttention;
    tool?: boolean;
    detail?: string;
  }[];
  active: string;
  onSelect(id: string, keyboard?: boolean): void;
  onClose(id: string, keyboard?: boolean): void;
  onNew(): void;
  onRename(id: string, name: string): void;
  onMove(id: string, target: string): void;
  onSearch(): void;
  newAction?: ReactNode;
  disableNew?: boolean;
}) {
  useTranslation();
  const [renaming, setRenaming] = useState<string>();
  const [name, setName] = useState('');
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current
      ?.querySelector('[aria-selected=true]')
      ?.closest('.workspace-tab')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active]);
  function rename(id: string, value: string) {
    setName(value);
    setRenaming(id);
  }
  function finishRename() {
    if (renaming && name.trim()) onRename(renaming, name.trim());
    setRenaming(undefined);
  }
  function focusTab(id: string) {
    requestAnimationFrame(() =>
      list.current
        ?.querySelector<HTMLElement>(`[data-workspace-id="${CSS.escape(id)}"] [role=tab]`)
        ?.focus(),
    );
  }
  const tabs = [
    {
      id: '',
      name: translate('common:connectionCenter'),
      rdp: undefined,
      dirty: false,
      tool: false,
    },
    ...items,
  ];
  return (
    <div className="workspace-tab-strip">
      <div
        className="workspace-tabs"
        ref={list}
        role="tablist"
        aria-label={translate('common:workspaceTabs')}
      >
        {tabs.map((item, index) => (
          <div
            className={`workspace-tab ${index === 0 ? 'connection-center-tab' : ''} ${active === item.id ? 'active' : ''}`}
            key={item.id}
            data-workspace-id={item.id}
            draggable={index !== 0 && !item.tool && renaming !== item.id}
            onDragStart={(e) => {
              e.dataTransfer.setData('application/x-termquay-workspace', item.id);
              e.dataTransfer.effectAllowed = 'move';
            }}
            onDragOver={(e) => {
              if (
                index &&
                !item.tool &&
                e.dataTransfer.types.includes('application/x-termquay-workspace')
              ) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
              }
            }}
            onDrop={(e) => {
              e.preventDefault();
              const source = e.dataTransfer.getData('application/x-termquay-workspace');
              if (index && !item.tool && items.some((w) => w.id === source && !w.tool))
                onMove(source, item.id);
            }}
          >
            {renaming === item.id ? (
              <input
                className="workspace-rename"
                aria-label={translate('common:temporaryWorkspaceName')}
                autoFocus
                maxLength={64}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={finishRename}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.nativeEvent.isComposing) return;
                  if (e.key === 'Enter') {
                    finishRename();
                    focusTab(item.id);
                  }
                  if (e.key === 'Escape') {
                    setRenaming(undefined);
                    focusTab(item.id);
                  }
                }}
              />
            ) : (
              <Tooltip
                content={
                  'detail' in item && item.detail ? `${item.name} · ${item.detail}` : item.name
                }
              >
                <button
                  role="tab"
                  aria-selected={active === item.id}
                  tabIndex={active === item.id ? 0 : -1}
                  onClick={() => onSelect(item.id)}
                  onDoubleClick={() => {
                    if (index && !item.tool) rename(item.id, item.name);
                  }}
                  onKeyDown={(e) => {
                    if (e.nativeEvent.isComposing) return;
                    if (index && !item.tool && e.key === 'F2') {
                      e.preventDefault();
                      rename(item.id, item.name);
                      return;
                    }
                    if (
                      index &&
                      !item.tool &&
                      e.altKey &&
                      e.shiftKey &&
                      ['ArrowLeft', 'ArrowRight'].includes(e.key)
                    ) {
                      e.preventDefault();
                      const target = tabs[index + (e.key === 'ArrowRight' ? 1 : -1)];
                      if (target?.id && !target.tool) {
                        onMove(item.id, target.id);
                        focusTab(item.id);
                      }
                      return;
                    }
                    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
                      e.preventDefault();
                      const next =
                        e.key === 'Home'
                          ? 0
                          : e.key === 'End'
                            ? tabs.length - 1
                            : (index + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) %
                              tabs.length;
                      if (tabs[next].id !== active) onSelect(tabs[next].id, true);
                      focusTab(tabs[next].id);
                    }
                  }}
                >
                  <Icon
                    name={
                      index === 0
                        ? 'connections'
                        : item.tool
                          ? 'list'
                          : item.rdp
                            ? 'desktop'
                            : 'terminal'
                    }
                  />
                  <span>{item.name}</span>
                  {'environment' in item && item.environment && (
                    <span className={`connection-environment ${item.environment}`}>
                      {
                        (
                          {
                            production: translate('common:production'),
                            staging: translate('common:staging'),
                            development: translate('common:development'),
                          } as Record<string, string>
                        )[item.environment]
                      }
                    </span>
                  )}
                  {'attention' in item && item.attention && (
                    <span className={`command-attention ${item.attention}`}>
                      {commandAttentionLabels[item.attention]}
                    </span>
                  )}
                  {item.dirty && (
                    <span aria-label={translate('common:unsavedFiles')} className="dirty-dot">
                      ●
                    </span>
                  )}
                </button>
              </Tooltip>
            )}
            {index !== 0 && (
              <>
                {!item.tool && (
                  <Dropdown>
                    <DropdownTrigger>
                      <button
                        className="tab-close"
                        aria-label={translate('common:workspaceMenu', { value1: item.name })}
                      >
                        <Icon name="more" width="13" height="13" />
                      </button>
                    </DropdownTrigger>
                    <DropdownMenu
                      aria-label={translate('common:workspaceActions')}
                      onAction={(key) => {
                        if (key === 'rename') rename(item.id, item.name);
                        if (key === 'left' && index > 1) onMove(item.id, tabs[index - 1].id);
                        if (key === 'right' && index < tabs.length - 1 && !tabs[index + 1].tool)
                          onMove(item.id, tabs[index + 1].id);
                      }}
                      disabledKeys={[
                        ...(index <= 1 ? ['left'] : []),
                        ...(index === tabs.length - 1 || tabs[index + 1]?.tool ? ['right'] : []),
                      ]}
                    >
                      <DropdownItem key="rename">
                        {translate('common:renameTemporarily')}
                      </DropdownItem>
                      <DropdownItem key="left">
                        {translate('common:moveWorkspaceLeft')}
                      </DropdownItem>
                      <DropdownItem key="right">
                        {translate('common:moveWorkspaceRight')}
                      </DropdownItem>
                    </DropdownMenu>
                  </Dropdown>
                )}
                <button
                  className="tab-close"
                  aria-label={translate('common:closeWorkspace2', { value1: item.name })}
                  onClick={(e) => onClose(item.id, e.detail === 0)}
                >
                  <Icon name="close" width="13" height="13" />
                </button>
              </>
            )}
          </div>
        ))}
      </div>
      <div className="workspace-tab-actions">
        {newAction || (
          <Tooltip content={translate('common:newConnection')}>
            <button
              className="icon-button"
              aria-label={translate('common:newConnection')}
              disabled={disableNew}
              onClick={onNew}
            >
              <Icon name="plus" />
            </button>
          </Tooltip>
        )}
        {items.length > 0 && (
          <Tooltip content={translate('common:openWorkspaces')}>
            <button
              className="icon-button"
              aria-label={translate('common:openWorkspaces')}
              onClick={onSearch}
            >
              <Icon name="list" />
            </button>
          </Tooltip>
        )}
      </div>
    </div>
  );
}
