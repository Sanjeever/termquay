import {
  Button,
  DropdownItem,
  DropdownMenu,
  DropdownSection,
  DropdownTrigger,
} from '@heroui/react';
import { useTranslation } from 'react-i18next';
import { t as translate } from '../../i18n/index.ts';
import type { LocalShell } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import { Dropdown } from '../../components/Popover';
import Tooltip from '../../components/Tooltip';
import Icon from '../../components/Icon';

export default function LocalTerminalLauncher({
  shells,
  shell,
  directory,
  recent,
  disabled,
  compact = false,
  onOpen,
  onChooseDirectory,
}: {
  shells: LocalShell[];
  shell?: string;
  directory?: string;
  recent: string[];
  disabled: boolean;
  compact?: boolean;
  onOpen(kind: string, directory?: string): void;
  onChooseDirectory(kind: string): void;
}) {
  useTranslation();
  const selected = shells.find((value) => value.id === shell) || shells[0];
  const unavailable = disabled || !selected;
  const label = translate('common:newLocalTerminal');
  return (
    <div className="local-terminal-launcher">
      <Tooltip content={directory ? `${label} · ${directory}` : label}>
        {compact ? (
          <button
            className="icon-button"
            aria-label={label}
            disabled={unavailable}
            onClick={() => selected && onOpen(selected.id)}
          >
            <Icon name="plus" />
          </button>
        ) : (
          <Button
            size="sm"
            variant="flat"
            isDisabled={unavailable}
            onPress={() => selected && onOpen(selected.id)}
          >
            <Icon name="terminal" width="14" />
            {translate('common:localTerminal')}
          </Button>
        )}
      </Tooltip>
      <Dropdown>
        <DropdownTrigger>
          <button
            className="icon-button"
            aria-label={translate('common:localTerminalOptions')}
            disabled={unavailable}
          >
            <Icon name="chevron" width="12" style={{ transform: 'rotate(90deg)' }} />
          </button>
        </DropdownTrigger>
        <DropdownMenu
          aria-label={translate('common:localTerminalOptions')}
          className="local-terminal-menu"
          onAction={(key) => {
            if (!selected) return;
            if (key === 'directory') onChooseDirectory(selected.id);
            else if (String(key).startsWith('shell:')) onOpen(String(key).slice(6));
            else onOpen(selected.id, recent[Number(String(key).slice(7))]);
          }}
        >
          <DropdownSection
            showDivider={recent.length > 0}
            items={[
              { id: 'directory', name: translate('common:openTerminalInDirectory') },
              ...shells.map((value) => ({ id: `shell:${value.id}`, name: value.name })),
            ]}
          >
            {(value) => <DropdownItem key={value.id}>{value.name}</DropdownItem>}
          </DropdownSection>
          <DropdownSection
            title={recent.length ? translate('common:recentDirectories') : undefined}
          >
            {recent.map((path, index) => (
              <DropdownItem key={`recent:${index}`} textValue={path} title={path}>
                <span className="file-path" title={path}>
                  {path}
                </span>
              </DropdownItem>
            ))}
          </DropdownSection>
        </DropdownMenu>
      </Dropdown>
    </div>
  );
}
