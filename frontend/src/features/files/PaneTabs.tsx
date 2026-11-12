import { t as translate } from '../../i18n/index.ts';
import { useTranslation } from 'react-i18next';
import Tooltip from '../../components/Tooltip';
import Icon from '../../components/Icon';
import { commandAttentionLabels, type CommandAttention } from '../terminal/commandAttention';

export default function PaneTabs({
  pane,
  items,
  selected,
  focused,
  hidden,
  column,
  creating,
  onSelect,
  onClose,
  onNew,
  newShortcut,
  closeShortcut,
}: {
  pane: number;
  items: {
    id: string;
    label: string;
    context?: string;
    terminal: boolean;
    dirty?: boolean;
    closingDisabled?: boolean;
    attention?: CommandAttention;
  }[];
  selected: string;
  focused: boolean;
  hidden: boolean;
  column: number;
  creating: boolean;
  onSelect(id: string): void;
  onClose(id: string): void;
  onNew(): void;
  newShortcut: string;
  closeShortcut: string;
}) {
  useTranslation();
  return (
    <div
      className={`inner-tabs pane-tabs ${focused ? 'focused-pane' : ''}`}
      role="tablist"
      aria-label={translate('files:paneTabs', {
        value1: pane === 0 ? translate('files:main') : translate('files:right'),
      })}
      hidden={hidden}
      style={{ gridColumn: column, gridRow: 1 }}
      onKeyDown={(e) => {
        if (
          e.nativeEvent.isComposing ||
          (e.target as HTMLElement).getAttribute('role') !== 'tab' ||
          !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)
        )
          return;
        e.preventDefault();
        const tabs = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role=tab]'));
        const index = tabs.indexOf(e.target as HTMLElement);
        const next =
          e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? items.length - 1
              : (index + (e.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length;
        onSelect(items[next].id);
        requestAnimationFrame(() => tabs[next]?.focus());
      }}
    >
      {items.map((item) => (
        <div
          key={item.id}
          className={selected === item.id ? 'selected' : ''}
          onMouseDown={(event) => {
            if (event.button === 1) event.preventDefault();
          }}
          onAuxClick={(event) => {
            if (event.button !== 1) return;
            event.preventDefault();
            event.stopPropagation();
            if (!item.closingDisabled) onClose(item.id);
          }}
        >
          <Tooltip content={item.terminal ? item.label : item.id}>
            <button
              role="tab"
              aria-label={item.terminal ? item.label : item.id}
              aria-selected={selected === item.id}
              tabIndex={selected === item.id ? 0 : -1}
              onClick={() => onSelect(item.id)}
            >
              {item.terminal && <Icon name="terminal" width="14" />}
              <span className="pane-tab-label">{item.label}</span>
              {item.context && <span className="pane-tab-context">· {item.context}</span>}
              {item.attention && (
                <span className={`command-attention ${item.attention}`}>
                  {commandAttentionLabels[item.attention]}
                </span>
              )}
              {item.dirty && (
                <span className="dirty-dot" aria-label={translate('files:unsaved')}>
                  ●
                </span>
              )}
            </button>
          </Tooltip>
          <Tooltip content={translate('files:close2', { value1: closeShortcut })}>
            <button
              className="pane-tab-close"
              aria-label={translate('files:close3', {
                value1: item.terminal ? '' : translate('files:file'),
                value2: item.label,
              })}
              disabled={item.closingDisabled}
              onClick={() => onClose(item.id)}
            >
              <Icon name="close" width="12" />
            </button>
          </Tooltip>
        </div>
      ))}
      <Tooltip content={translate('files:newTerminal', { value1: newShortcut })}>
        <button
          aria-label={translate('files:newTerminalInPane', {
            value1: pane === 0 ? translate('files:main') : translate('files:right'),
          })}
          disabled={creating}
          onClick={onNew}
        >
          <Icon name="plus" width="15" />
        </button>
      </Tooltip>
    </div>
  );
}
