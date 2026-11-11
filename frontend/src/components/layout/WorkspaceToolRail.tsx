import type { ComponentProps, Ref } from 'react';
import { t } from '../../i18n/index.ts';
import { useTranslation } from 'react-i18next';
import Icon from '../Icon';
import Tooltip from '../Tooltip';

type Tool = {
  id: string;
  label: string;
  icon: ComponentProps<typeof Icon>['name'];
  active?: boolean;
  disabled?: boolean;
  buttonRef?: Ref<HTMLButtonElement>;
  onClick(): void;
};

export default function WorkspaceToolRail({ tools }: { tools: Tool[] }) {
  useTranslation();
  return (
    <nav
      className="workspace-tool-rail"
      aria-label={t('files:sSHWorkspaceTools')}
      onKeyDown={(event) => {
        if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
        const buttons = Array.from(
          event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
        );
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (index < 0) return;
        event.preventDefault();
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? buttons.length - 1
              : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }}
    >
      {tools.map((tool) => (
        <Tooltip key={tool.id} content={tool.label}>
          <button
            ref={tool.buttonRef}
            className="icon-button workspace-tool"
            aria-label={tool.label}
            aria-pressed={tool.active}
            disabled={tool.disabled}
            onClick={tool.onClick}
          >
            <Icon name={tool.icon} />
          </button>
        </Tooltip>
      ))}
    </nav>
  );
}
