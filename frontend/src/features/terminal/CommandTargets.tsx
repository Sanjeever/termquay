import { t as translate } from '../../i18n/index.ts';
import { useMessageState } from '../../i18n/useMessageState.ts';
import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import { Button } from '@heroui/react';
import SelectControl from '../../components/SelectControl';
import { GetConnectionFilters } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { ConnectionFilter } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import type {
  Connection,
  ConnectionPreference,
  Group,
} from '../../../bindings/github.com/Sanjeever/termquay/internal/store/models';
import { catalogConnections } from '../connections/catalog';

export type CommandTarget = {
  id: string;
  name: string;
  address: string;
  connection?: Connection;
  preference?: ConnectionPreference;
  disconnected?: boolean;
};
export default function CommandTargets({
  targets,
  groups = [],
  selected,
  onChange,
  onConnect,
  busy,
}: {
  targets: CommandTarget[];
  groups?: Group[];
  selected: Set<string>;
  onChange(value: Set<string>): void;
  onConnect?(target: CommandTarget): void;
  busy: boolean;
}) {
  useTranslation();
  const [search, setSearch] = useState('');
  const [environment, setEnvironment] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [saved, setSaved] = useState<ConnectionFilter[]>([]);
  const [scope, setScope] = useState<ConnectionFilter>();
  const [error, setError] = useMessageState('');
  useEffect(() => {
    let ended = false;
    const request = GetConnectionFilters();
    request
      .then((values) => {
        if (!ended) setSaved(values || []);
      })
      .catch((e) => {
        if (!ended) setError(e);
      });
    return () => {
      ended = true;
      request.cancel();
    };
  }, []);
  const preferences = Object.fromEntries(
    targets
      .filter((target) => target.connection)
      .map((target) => [target.connection!.id, target.preference]),
  );
  const connections = catalogConnections(
    targets.flatMap((target) => (target.connection ? [target.connection] : [])),
    groups,
    preferences,
    {
      view: scope?.view || 'all',
      group: scope?.group || '',
      protocol: scope?.protocol || 'all',
      search,
      environment,
      tags,
      sort: 'name',
    },
  );
  const visibleIDs = new Set(connections.map((value) => value.id));
  const visible = targets.filter((target) =>
    target.connection
      ? visibleIDs.has(target.connection.id)
      : !scope &&
        !environment &&
        !tags.length &&
        `${target.name} ${target.address}`.toLowerCase().includes(search.toLowerCase()),
  );
  const allTags = [...new Set(targets.flatMap((target) => target.preference?.tags || []))].sort();
  return (
    <div className="command-target-picker">
      <input
        className="command-target-search"
        aria-label={translate('terminal:searchSSHHosts')}
        placeholder={translate('terminal:searchHostOrAddress')}
        value={search}
        disabled={busy}
        onChange={(event) => setSearch(event.target.value)}
      />
      <details className="command-target-filters">
        <summary>
          {translate('terminal:filterHosts')}
          {environment || tags.length || scope ? translate('terminal:applied') : ''}
        </summary>
        <div className="form-field">
          <SelectControl
            aria-label={translate('terminal:destinationEnvironment')}
            value={environment}
            disabled={busy}
            onChange={(event) => setEnvironment(event.target.value)}
          >
            <option value="">{translate('terminal:allEnvironments')}</option>
            <option value="production">{translate('terminal:production')}</option>
            <option value="staging">{translate('terminal:staging')}</option>
            <option value="development">{translate('terminal:development')}</option>
          </SelectControl>
          <SelectControl
            aria-label={translate('terminal:destinationTags')}
            value=""
            disabled={busy}
            onChange={(event) => {
              if (event.target.value) setTags([...tags, event.target.value]);
            }}
          >
            <option value="">{translate('terminal:addTagFilter')}</option>
            {allTags
              .filter((tag) => !tags.includes(tag))
              .map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
          </SelectControl>
          {tags.map((tag) => (
            <button
              key={tag}
              className="session-tool"
              disabled={busy}
              onClick={() => setTags(tags.filter((value) => value !== tag))}
            >
              {tag} ×
            </button>
          ))}
          {!!saved.length && (
            <SelectControl
              aria-label={translate('terminal:selectDestinationsUsingASavedFilter')}
              value={scope?.name || ''}
              disabled={busy}
              onChange={(event) => {
                const item = saved.find((value) => value.name === event.target.value);
                setScope(item);
                setSearch(item?.search || '');
                setEnvironment(item?.environment || '');
                setTags(item?.tags || []);
              }}
            >
              <option value="">{translate('terminal:savedFilters')}</option>
              {saved.map((item) => (
                <option key={item.name} value={item.name}>
                  {item.name}
                </option>
              ))}
            </SelectControl>
          )}
        </div>
      </details>
      <div className="command-target-selection">
        <button
          disabled={busy || !visible.length}
          onClick={() => onChange(new Set([...selected, ...visible.map((value) => value.id)]))}
        >
          {translate('terminal:selectAllFilteredResults')}
        </button>
        <button disabled={busy || !selected.size} onClick={() => onChange(new Set())}>
          {translate('terminal:clear')}
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="command-target-list">
        {targets
          .filter((target) => visible.includes(target) || selected.has(target.id))
          .map((target) => (
            <div
              className={`command-target-row ${selected.has(target.id) ? 'selected' : ''}`}
              key={target.id}
            >
              <label>
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={selected.has(target.id)}
                  onChange={(event) => {
                    const next = new Set(selected);
                    if (event.target.checked) next.add(target.id);
                    else next.delete(target.id);
                    onChange(next);
                  }}
                />
                <span>
                  <span className="command-target-name">
                    {target.name}
                    {target.preference?.environment && (
                      <strong className={`connection-environment ${target.preference.environment}`}>
                        {(
                          {
                            production: translate('terminal:production'),
                            staging: translate('terminal:staging'),
                            development: translate('terminal:development'),
                          } as Record<string, string>
                        )[target.preference.environment] || target.preference.environment}
                      </strong>
                    )}
                  </span>
                  <small className="muted" title={target.address}>
                    {target.address}
                  </small>
                  <small className="muted">
                    {target.disconnected
                      ? translate('terminal:notConnected')
                      : translate('terminal:connected')}
                  </small>
                </span>
              </label>
              {target.disconnected && onConnect && (
                <Button
                  size="sm"
                  variant="light"
                  isDisabled={busy}
                  onPress={() => onConnect(target)}
                >
                  {translate('terminal:connect')}
                </Button>
              )}
            </div>
          ))}
        {!targets.length && <p className="muted">{translate('terminal:noSSHConnections')}</p>}
        {!!targets.length && !visible.length && !selected.size && (
          <p className="muted">{translate('terminal:noMatchingHosts')}</p>
        )}
      </div>
      {!!selected.size && (
        <div className="button-row" role="status">
          {['production', 'staging', 'development', ''].map((environment) => {
            const count = targets.filter(
              (target) =>
                selected.has(target.id) && (target.preference?.environment || '') === environment,
            ).length;
            return count ? (
              <span key={environment} className={environment === 'production' ? 'error' : 'muted'}>
                {(
                  {
                    production: translate('terminal:production'),
                    staging: translate('terminal:staging'),
                    development: translate('terminal:development'),
                  } as Record<string, string>
                )[environment] || translate('terminal:noEnvironmentSet')}{' '}
                {count} {translate('terminal:hosts')}
              </span>
            ) : null;
          })}
        </div>
      )}
    </div>
  );
}
