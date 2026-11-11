import Modal from '../../components/Modal';
import { eventError, errorMessage } from '../../lib/errors.ts';
import { t as translate, currentLocale } from '../../i18n/index.ts';
import { message as uiMessage } from '../../i18n/messages.ts';
import { useMessageState } from '../../i18n/useMessageState.ts';
import { useTranslation } from 'react-i18next';
import Tooltip from '../../components/Tooltip';

import SelectControl from '../../components/SelectControl';
import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  GetConnectionFilters,
  SaveConnectionFilters,
} from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { ConnectionFilter } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import {
  Button,
  DropdownTrigger,
  DropdownMenu,
  DropdownItem,
  Input,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  PopoverTrigger,
  PopoverContent,
} from '@heroui/react';
import { Dropdown, Popover } from '../../components/Popover';
import {
  DeleteConnection,
  DuplicateConnection,
  SetConnectionPreference,
  ClearRecentConnections,
  SaveGroup,
  DeleteGroup,
  MoveConnectionsToGroup,
  MoveGroup,
} from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type {
  Connection,
  ConnectionPreference,
  Group,
} from '../../../bindings/github.com/Sanjeever/termquay/internal/store/models';
import Icon from '../../components/Icon';
import ErrorNotice from '../../components/ErrorNotice';
import ImportConnectionsDialog from './ImportConnectionsDialog';
import { catalogConnections, type CatalogSort } from './catalog';
import { selectItems } from '../../lib/selection';
import CredentialAssignDialog from './CredentialAssignDialog';
import useConnectionLatency from './useConnectionLatency';
import ConnectionLatency from './ConnectionLatency';

export default function ConnectionCenter({
  connections,
  groups,
  preferences,
  sessions,
  onOpen,
  onEdit,
  onNew,
  onReload,
  onPlaybook,
  onMultiHost,
  busy,
  loading,
  loadError,
  systemRDP,
  localTerminalAction,
  active,
  demoLatency,
}: {
  connections: Connection[];
  groups: Group[];
  onOpen(c: Connection, another?: boolean, client?: string): void;
  onEdit(c: Connection): void;
  onNew(temporary: boolean): void;
  onReload(): void;
  busy: boolean;
  preferences: Record<string, ConnectionPreference | undefined>;
  sessions: Record<string, string[]>;
  loading: boolean;
  loadError: string;
  systemRDP: boolean;
  onPlaybook?(connection: Connection): void;
  onMultiHost?(connections: string[]): void;
  localTerminalAction?: ReactNode;
  active: boolean;
  demoLatency?: ReturnType<typeof useConnectionLatency>['measurements'];
}) {
  useTranslation();
  const demo = demoLatency !== undefined;
  const [search, setSearch] = useState('');
  const [protocol, setProtocol] = useState('all');
  const [environment, setEnvironment] = useState('');
  const [tag, setTag] = useState('');
  const [filters, setFilters] = useState<ConnectionFilter[]>([]);
  const [filterName, setFilterName] = useState('');
  const [savingFilter, setSavingFilter] = useState(false);
  const [filterLoaded, setFilterLoaded] = useState(false);
  const [saveFilterOpen, setSaveFilterOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [view, setView] = useState('all');
  const [group, setGroup] = useState('');
  const [sort, setSort] = useState<CatalogSort>('name');
  const [descending, setDescending] = useState(false);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [selected, setSelected] = useState('');
  const [selection, setSelection] = useState<string[]>([]);
  const anchor = useRef('');
  const [moveOpen, setMoveOpen] = useState(false);
  const [credentialTargets, setCredentialTargets] = useState<Connection[]>();
  const [dropTarget, setDropTarget] = useState('');
  const [error, setError] = useMessageState('');
  const [groupDialog, setGroupDialog] = useState<{ value?: Group }>();
  const [deleting, setDeleting] = useState<{ id: string; name: string; group?: boolean }>();
  const [working, setWorking] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [duplicating, setDuplicating] = useState<Connection>();
  const [includeCredentials, setIncludeCredentials] = useState(false);
  const [menu, setMenu] = useState('');
  const [groupMenu, setGroupMenu] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const query = useDeferredValue(search);
  const selectedTags = tag.split(',').filter(Boolean);
  const filtered = !!(search || environment || tag || protocol !== 'all');
  function clearFilters() {
    setSearch('');
    setEnvironment('');
    setTag('');
    setProtocol('all');
  }
  const environmentLabel = (
    {
      production: translate('connections:production'),
      staging: translate('connections:staging'),
      development: translate('connections:development'),
    } as Record<string, string>
  )[environment];
  /* oxlint-disable react/exhaustive-deps -- Locale invalidates catalog ordering performed by the shared locale-aware helper. */
  const visible = useMemo(
    () =>
      catalogConnections(connections, groups, preferences, {
        view,
        group,
        protocol,
        search: query,
        sort,
        descending,
        environment,
        tags: tag.split(',').filter(Boolean),
      }),
    [
      connections,
      groups,
      preferences,
      view,
      group,
      protocol,
      query,
      sort,
      descending,
      environment,
      tag,
      currentLocale(),
    ],
  );
  /* oxlint-enable react/exhaustive-deps */
  const latency = useConnectionLatency(
    connections,
    active && !demo && !loading && !loadError,
    demo ? [] : visible,
  );
  const tags = [...new Set(Object.values(preferences).flatMap((value) => value?.tags || []))].sort(
    (a, b) => a.localeCompare(b, currentLocale()),
  );
  useEffect(() => {
    if (demo || loading || loadError) return;
    let ended = false;
    const request = GetConnectionFilters();
    request
      .then((values) => {
        if (!ended) {
          setFilters(values || []);
          setFilterLoaded(true);
        }
      })
      .catch((e) => {
        if (!ended) setError(e);
      });
    return () => {
      ended = true;
      request.cancel();
    };
  }, [demo, loading, loadError, setError]);
  async function saveFilters(next: ConnectionFilter[]) {
    setSavingFilter(true);
    setError('');
    try {
      await SaveConnectionFilters(next);
      setFilters(next);
      setSaveFilterOpen(false);
    } catch (e) {
      setError(e);
    } finally {
      setSavingFilter(false);
    }
  }
  const selectedSet = new Set(selection);
  const groupChildren = useMemo(() => {
    const children = new Map<string, Group[]>();
    for (const group of groups) {
      const siblings = children.get(group.parent_id) || [];
      siblings.push(group);
      children.set(group.parent_id, siblings);
    }
    for (const siblings of children.values()) siblings.sort((a, b) => a.sort_order - b.sort_order);
    return children;
  }, [groups]);
  const selectedIDs = visible.filter((c) => selectedSet.has(c.id)).map((c) => c.id);
  const selectedConnection =
    selectedIDs.length === 1 ? visible.find((c) => c.id === selectedIDs[0]) : undefined;
  function pick(id: string, toggle = false, range = false) {
    setSelection((prev) =>
      selectItems(
        visible.map((c) => c.id),
        prev,
        id,
        anchor.current,
        toggle,
        range,
      ),
    );
    setSelected(id);
    if (!range) anchor.current = id;
  }
  const scopeName = group
    ? group === 'ungrouped'
      ? translate('connections:ungrouped')
      : groups.find((g) => g.id === group)?.name || translate('connections:groups')
    : view === 'favorite'
      ? translate('connections:favorites')
      : view === 'recent'
        ? translate('connections:recentConnections')
        : translate('connections:allConnections');
  function scope(nextView: string, nextGroup = '') {
    setView(nextView);
    setGroup(nextGroup);
    setSelected('');
    setSelection([]);
    if (nextView === 'recent') {
      setSort('recent');
      setDescending(false);
    }
  }
  function sortBy(next: CatalogSort) {
    setSort(next);
    setDescending(next === sort ? !descending : false);
  }
  function sortHeading(value: CatalogSort, label: string, className = '') {
    return (
      <button
        className={`catalog-column-sort ${className}`}
        aria-label={translate('connections:sortBy', {
          value1: label,
          value2:
            sort === value && !descending
              ? translate('connections:descending')
              : translate('connections:ascending'),
        })}
        aria-pressed={sort === value}
        onClick={() => sortBy(value)}
      >
        {label}
        {sort === value && (
          <Icon
            name="chevron"
            width="10"
            height="10"
            style={{ transform: descending ? 'rotate(-90deg)' : 'rotate(90deg)' }}
          />
        )}
      </button>
    );
  }
  async function move(ids: string[], target: string) {
    if (working || demo) return;
    setWorking(true);
    setError('');
    try {
      await MoveConnectionsToGroup(ids, target);
      setMoveOpen(false);
      setSelection([]);
      onReload();
    } catch (e) {
      setError(e);
    } finally {
      setWorking(false);
    }
  }
  async function moveGroup(id: string, parent: string, before = '') {
    if (working || demo) return;
    setWorking(true);
    setError('');
    try {
      await MoveGroup(id, parent, before);
      onReload();
    } catch (e) {
      setError(e);
    } finally {
      setWorking(false);
    }
  }
  function dragOver(e: React.DragEvent, target: string) {
    if (demo) return;
    if (
      e.dataTransfer.types.some((t) =>
        ['application/x-termquay-connections', 'application/x-termquay-group'].includes(t),
      )
    ) {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      setDropTarget(target);
    }
  }
  function drop(e: React.DragEvent, target: string) {
    e.preventDefault();
    e.stopPropagation();
    if (demo) return;
    setDropTarget('');
    const source = e.dataTransfer.getData('application/x-termquay-group');
    if (source) {
      const g = groups.find((g) => g.id === target);
      void moveGroup(source, e.shiftKey && g ? g.parent_id : target, e.shiftKey && g ? g.id : '');
      return;
    }
    try {
      const ids = JSON.parse(e.dataTransfer.getData('application/x-termquay-connections'));
      if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string'))
        throw uiMessage('connections:invalidDraggedConnectionData');
      void move(ids, target);
    } catch (error) {
      setError(error);
    }
  }
  async function preference(id: string, favorite: boolean, environment: string) {
    if (demo) return;
    setError('');
    try {
      await SetConnectionPreference(id, favorite, environment);
      onReload();
    } catch (e) {
      setError(e);
    }
  }

  function tree(parent: string, depth = 0): React.ReactNode {
    return (groupChildren.get(parent) || []).map((g) => (
      <div key={g.id}>
        <div
          draggable={!working && !demo}
          onDragStart={(e) => {
            e.stopPropagation();
            e.dataTransfer.setData('application/x-termquay-group', g.id);
            e.dataTransfer.effectAllowed = 'move';
          }}
          onDragOver={(e) => dragOver(e, g.id)}
          onDragLeave={() => setDropTarget('')}
          onDrop={(e) => drop(e, g.id)}
          className={`group-row ${group === g.id ? 'selected' : ''} ${dropTarget === g.id ? 'drop-target' : ''}`}
          style={{ paddingLeft: 8 + depth * 12 }}
          onContextMenu={(e) => {
            e.preventDefault();
            scope('all', g.id);
            if (!demo) setGroupMenu(g.id);
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing || demo) return;
            if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
              e.preventDefault();
              setGroupMenu(g.id);
            }
          }}
        >
          {groupChildren.has(g.id) ? (
            <button
              className="group-expand"
              aria-label={translate('connections:group', {
                value1: collapsed.includes(g.id)
                  ? translate('connections:expand')
                  : translate('connections:collapse'),
                value2: g.name,
              })}
              aria-expanded={!collapsed.includes(g.id)}
              onClick={() =>
                setCollapsed((prev) =>
                  prev.includes(g.id) ? prev.filter((id) => id !== g.id) : [...prev, g.id],
                )
              }
            >
              <Icon
                name="chevron"
                width="11"
                height="11"
                style={{ transform: collapsed.includes(g.id) ? undefined : 'rotate(90deg)' }}
              />
            </button>
          ) : (
            <span className="group-expand" aria-hidden="true" />
          )}
          <Tooltip content={g.name}>
            <button
              className="group-name"
              aria-current={group === g.id ? 'page' : undefined}
              onClick={() => scope('all', g.id)}
            >
              <Icon name="files" width="15" height="15" />
              <span>{g.name}</span>
            </button>
          </Tooltip>
          <Dropdown
            isOpen={groupMenu === g.id}
            onOpenChange={(open) => setGroupMenu(open ? g.id : '')}
          >
            <DropdownTrigger>
              <button
                className="icon-button row-menu"
                disabled={working || demo}
                aria-label={translate('connections:groupActions', { value1: g.name })}
              >
                <Icon name="more" width="14" />
              </button>
            </DropdownTrigger>
            <DropdownMenu
              aria-label={translate('connections:groupActions', { value1: g.name })}
              onAction={(key) => {
                if (demo) return;
                setError('');
                const siblings = groups
                  .filter((s) => s.parent_id === g.parent_id)
                  .sort((a, b) => a.sort_order - b.sort_order);
                const index = siblings.findIndex((s) => s.id === g.id);
                if (key === 'edit') setGroupDialog({ value: g });
                if (key === 'root') void moveGroup(g.id, '');
                if (key === 'up' && index > 0)
                  void moveGroup(g.id, g.parent_id, siblings[index - 1].id);
                if (key === 'down' && index < siblings.length - 1)
                  void moveGroup(g.id, g.parent_id, siblings[index + 2]?.id || '');
                if (key === 'delete') setDeleting({ id: g.id, name: g.name, group: true });
              }}
            >
              <DropdownItem key="edit">
                {translate('connections:editChangeParentGroup')}
              </DropdownItem>
              <DropdownItem key="root" isDisabled={!g.parent_id}>
                {translate('connections:moveToRoot')}
              </DropdownItem>
              <DropdownItem
                key="up"
                isDisabled={
                  groups
                    .filter((s) => s.parent_id === g.parent_id)
                    .sort((a, b) => a.sort_order - b.sort_order)[0]?.id === g.id
                }
              >
                {translate('connections:moveGroupUp')}
              </DropdownItem>
              <DropdownItem
                key="down"
                isDisabled={
                  groups
                    .filter((s) => s.parent_id === g.parent_id)
                    .sort((a, b) => a.sort_order - b.sort_order)
                    .slice(-1)[0]?.id === g.id
                }
              >
                {translate('connections:moveGroupDown')}
              </DropdownItem>
              <DropdownItem key="delete" color="danger">
                {translate('connections:deleteGroup')}
              </DropdownItem>
            </DropdownMenu>
          </Dropdown>
        </div>
        {!collapsed.includes(g.id) && tree(g.id, depth + 1)}
      </div>
    ));
  }
  return (
    <div
      className="connection-center"
      onDragOver={(e) => {
        if ((e.target as HTMLElement).closest('.connection-groups')) dragOver(e, 'root');
      }}
      onDrop={(e) => {
        if ((e.target as HTMLElement).closest('.connection-groups')) drop(e, '');
      }}
    >
      <aside
        className="connection-groups"
        aria-label={translate('connections:connectionNavigation')}
      >
        <nav aria-label={translate('connections:connectionScope')}>
          {[
            ['all', translate('connections:allConnections')],
            ['favorite', translate('connections:favorites')],
            ['recent', translate('connections:recentConnections')],
          ].map(([value, label]) => (
            <button
              key={value}
              className={`group-filter ${!group && view === value ? 'selected' : ''}`}
              aria-current={!group && view === value ? 'page' : undefined}
              onClick={() => scope(value)}
            >
              {label}
              <span>
                {
                  connections.filter(
                    (c) =>
                      value === 'all' ||
                      (value === 'favorite'
                        ? preferences[c.id]?.favorite
                        : preferences[c.id]?.last_connected),
                  ).length
                }
              </span>
            </button>
          ))}
        </nav>
        <div className="sidebar-heading">
          <h2>{translate('connections:groups')}</h2>
          <Tooltip content={translate('connections:newGroup')}>
            <button
              className="icon-button"
              aria-label={translate('connections:newGroup')}
              disabled={demo}
              onClick={() => {
                setError('');
                setGroupDialog({});
              }}
            >
              <Icon name="plus" width="16" />
            </button>
          </Tooltip>
        </div>
        <div className="group-tree">
          {tree('')}
          <button
            className={`group-filter ${group === 'ungrouped' ? 'selected' : ''}`}
            onClick={() => scope('all', 'ungrouped')}
          >
            {translate('connections:ungrouped')}
          </button>
        </div>
      </aside>
      <section
        className="connection-catalog"
        aria-label={translate('connections:connectionList')}
        aria-busy={loading}
      >
        <div className="catalog-toolbar">
          <Tooltip content={scopeName}>
            <h1>{scopeName}</h1>
          </Tooltip>
          <Input
            aria-label={translate('connections:searchConnections')}
            placeholder={translate('connections:searchConnections')}
            size="sm"
            value={search}
            onValueChange={setSearch}
            startContent={<Icon name="search" width="14" />}
            isClearable
            onClear={() => setSearch('')}
          />
          <Button size="sm" variant="light" isDisabled={busy || demo} onPress={() => onNew(true)}>
            {translate('connections:quickConnect')}
          </Button>
          <div className="catalog-create">
            {localTerminalAction}
            <Button
              size="sm"
              color="primary"
              isDisabled={busy || demo}
              onPress={() => onNew(false)}
            >
              <Icon name="plus" width="14" />
              {translate('connections:newConnection')}
            </Button>
            <Dropdown>
              <DropdownTrigger>
                <Tooltip content={translate('connections:importConnections')}>
                  <button
                    className="icon-button"
                    disabled={busy || demo}
                    aria-label={translate('connections:importConnections')}
                  >
                    <Icon name="chevron" width="13" style={{ transform: 'rotate(90deg)' }} />
                  </button>
                </Tooltip>
              </DropdownTrigger>
              <DropdownMenu
                aria-label={translate('connections:importConnections')}
                items={[{ id: 'import', name: translate('connections:importConnections') }]}
                onAction={(key) => {
                  if (demo) return;
                  if (key === 'import') setImportOpen(true);
                }}
              >
                {(item) => <DropdownItem key={item.id}>{item.name}</DropdownItem>}
              </DropdownMenu>
            </Dropdown>
          </div>
        </div>
        <div className="catalog-filters">
          <div
            className="protocol-filters"
            role="group"
            aria-label={translate('connections:protocolFilter')}
          >
            {['all', 'ssh', 'rdp'].map((value) => (
              <button
                key={value}
                aria-pressed={protocol === value}
                onClick={() => setProtocol(value)}
              >
                {value === 'all' ? translate('connections:all') : value.toUpperCase()}
              </button>
            ))}
          </div>
          <Popover isOpen={filtersOpen} onOpenChange={setFiltersOpen} placement="bottom-start">
            <PopoverTrigger>
              <button className="session-tool" aria-expanded={filtersOpen}>
                <Icon name="filter" width="15" />
                {translate('connections:filters')}
                {(environment || selectedTags.length > 0) && (
                  <span>{(environment ? 1 : 0) + selectedTags.length}</span>
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent className="catalog-filter-panel">
              <SelectControl
                aria-label={translate('connections:environmentFilter')}
                value={environment}
                onChange={(event) => setEnvironment(event.target.value)}
              >
                <option value="">{translate('connections:allEnvironments')}</option>
                <option value="production">{translate('connections:production')}</option>
                <option value="staging">{translate('connections:staging')}</option>
                <option value="development">{translate('connections:development')}</option>
              </SelectControl>
              <SelectControl
                aria-label={translate('connections:addTagFilter')}
                value=""
                onChange={(event) => {
                  if (event.target.value && !selectedTags.includes(event.target.value))
                    setTag([...selectedTags, event.target.value].join(','));
                }}
              >
                <option value="">{translate('connections:tagFilter')}</option>
                {tags
                  .filter((value) => !selectedTags.includes(value))
                  .map((value) => (
                    <option key={value}>{value}</option>
                  ))}
              </SelectControl>
              {!!filters.length && (
                <SelectControl
                  aria-label={translate('connections:savedFilters')}
                  value=""
                  disabled={demo || savingFilter}
                  onChange={(event) => {
                    const item = filters.find((value) => value.name === event.target.value);
                    if (item) {
                      scope(item.view, item.group);
                      setProtocol(item.protocol);
                      setEnvironment(item.environment);
                      setTag((item.tags || []).join(','));
                      setSearch(item.search);
                      setFilterName(item.name);
                    }
                  }}
                >
                  <option value="">{translate('connections:savedFilters')}</option>
                  {filters.map((item) => (
                    <option key={item.name}>{item.name}</option>
                  ))}
                </SelectControl>
              )}
              <Button
                size="sm"
                variant="light"
                isDisabled={demo || !filterLoaded || savingFilter}
                onPress={() => {
                  setFiltersOpen(false);
                  setSaveFilterOpen(true);
                }}
              >
                {translate('connections:saveFilter')}
              </Button>
            </PopoverContent>
          </Popover>
        </div>
        {filtered && (
          <div
            className="catalog-active-filters"
            aria-label={translate('connections:activeFilters')}
          >
            {protocol !== 'all' && (
              <button
                className="filter-chip"
                aria-label={translate('connections:removeFilter', {
                  value1: protocol.toUpperCase(),
                })}
                onClick={() => setProtocol('all')}
              >
                {protocol.toUpperCase()}
                <Icon name="close" width="12" />
              </button>
            )}
            {environment && (
              <button
                className="filter-chip"
                aria-label={translate('connections:removeFilter', { value1: environmentLabel })}
                onClick={() => setEnvironment('')}
              >
                {environmentLabel}
                <Icon name="close" width="12" />
              </button>
            )}
            {selectedTags.map((value) => (
              <button
                key={value}
                className="filter-chip"
                aria-label={translate('connections:removeTagFilter', { value1: value })}
                onClick={() => setTag(selectedTags.filter((item) => item !== value).join(','))}
              >
                {value}
                <Icon name="close" width="12" />
              </button>
            ))}
            {search && (
              <button
                className="filter-chip"
                aria-label={translate('connections:removeFilter', { value1: search })}
                onClick={() => setSearch('')}
              >
                <Icon name="search" width="12" />
                <span>{search}</span>
                <Icon name="close" width="12" />
              </button>
            )}
            <button className="session-tool" onClick={clearFilters}>
              {translate('connections:clearFilters')}
            </button>
          </div>
        )}
        {saveFilterOpen && (
          <Modal
            isOpen
            onClose={() => !savingFilter && setSaveFilterOpen(false)}
            className="app-dialog"
          >
            <ModalContent>
              <ModalHeader>{translate('connections:saveCurrentFilter')}</ModalHeader>
              <ModalBody>
                <Input
                  label={translate('connections:name')}
                  value={filterName}
                  onValueChange={setFilterName}
                  maxLength={128}
                  isDisabled={savingFilter}
                />
                {error && (
                  <p className="error" role="alert">
                    {error}
                  </p>
                )}
              </ModalBody>
              <ModalFooter>
                <Button
                  variant="light"
                  isDisabled={savingFilter}
                  onPress={() => setSaveFilterOpen(false)}
                >
                  {translate('connections:cancel')}
                </Button>
                {filters.some((item) => item.name === filterName.trim()) && (
                  <Button
                    color="danger"
                    variant="light"
                    isDisabled={savingFilter}
                    onPress={() =>
                      void saveFilters(filters.filter((item) => item.name !== filterName.trim()))
                    }
                  >
                    {translate('connections:deleteThisFilter')}
                  </Button>
                )}
                <Button
                  color="primary"
                  isLoading={savingFilter}
                  isDisabled={!filterName.trim()}
                  onPress={() =>
                    void saveFilters([
                      ...filters.filter((item) => item.name !== filterName.trim()),
                      {
                        name: filterName.trim(),
                        view,
                        group,
                        protocol,
                        environment,
                        tags: selectedTags,
                        search,
                      },
                    ])
                  }
                >
                  {translate('connections:save')}
                </Button>
              </ModalFooter>
            </ModalContent>
          </Modal>
        )}
        {errorMessage(eventError(latency)) && (
          <p role="alert" className="error">
            {errorMessage(eventError(latency))}
          </p>
        )}
        {!groupDialog && !deleting && !duplicating && !moveOpen && (
          <ErrorNotice message={error} onDismiss={() => setError('')} />
        )}
        <div
          className="connection-list"
          aria-label={translate('connections:savedConnections')}
          ref={list}
        >
          <div className="connection-columns">
            <div className="connection-name-columns">
              <span />
              {sortHeading('name', translate('connections:name'))}
              {sortHeading(
                'address',
                translate('connections:address'),
                'connection-address-heading',
              )}
              {sortHeading('username', translate('connections:username'), 'connection-user')}
              {sortHeading('protocol', translate('connections:protocol'), 'connection-protocol')}
              <span className="connection-state-heading">{translate('connections:status')}</span>
            </div>
            <Tooltip
              content={
                demo
                  ? translate('connections:demoSample')
                  : translate('connections:refreshTCPConnectionTimesForTheCurrentList')
              }
            >
              <button
                className="latency-heading"
                aria-label={translate('connections:refreshTCPLatencyForTheCurrentList')}
                aria-disabled={demo}
                aria-busy={latency.refreshing || undefined}
                onClick={() => {
                  if (!demo) latency.refresh();
                }}
              >
                <Icon
                  name="refresh"
                  width="12"
                  height="12"
                  className={latency.refreshing ? 'latency-refreshing' : undefined}
                />
                {translate('connections:tCPLatency')}
              </button>
            </Tooltip>
            <span />
          </div>
          {visible.map((c, index) => (
            <div
              key={c.id}
              draggable={!working && !demo}
              onDragStart={(e) => {
                e.dataTransfer.setData(
                  'application/x-termquay-connections',
                  JSON.stringify(selectedIDs.includes(c.id) ? selectedIDs : [c.id]),
                );
                e.dataTransfer.effectAllowed = 'move';
              }}
              className={`connection-row ${selectedIDs.includes(c.id) ? 'selected' : ''}`}
              onContextMenu={(e) => {
                e.preventDefault();
                if (!selectedIDs.includes(c.id)) pick(c.id);
                if (!demo) setMenu(c.id);
              }}
            >
              <Tooltip
                content={`${c.name}\n${c.protocol.toUpperCase()} · ${c.username}@${c.host}:${c.port}`}
              >
                <button
                  className="connection-name"
                  aria-pressed={selectedIDs.includes(c.id)}
                  tabIndex={
                    visible.some((c) => c.id === selected)
                      ? selected === c.id
                        ? 0
                        : -1
                      : index === 0
                        ? 0
                        : -1
                  }
                  onClick={(e) => pick(c.id, e.ctrlKey || e.metaKey, e.shiftKey)}
                  onDoubleClick={() => !busy && (!demo || c.protocol === 'ssh') && onOpen(c)}
                  onKeyDown={(e) => {
                    if (e.nativeEvent.isComposing) return;
                    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
                      e.preventDefault();
                      setSelection(visible.map((c) => c.id));
                    }
                    if (e.key === ' ') {
                      e.preventDefault();
                      pick(c.id, true, e.shiftKey);
                    }
                    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
                      e.preventDefault();
                      const next =
                        e.key === 'Home'
                          ? 0
                          : e.key === 'End'
                            ? visible.length - 1
                            : Math.max(
                                0,
                                Math.min(
                                  visible.length - 1,
                                  index + (e.key === 'ArrowDown' ? 1 : -1),
                                ),
                              );
                      pick(visible[next].id, false, e.shiftKey);
                      list.current
                        ?.querySelectorAll<HTMLElement>('.connection-name')
                        [next]?.focus();
                    }
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      if (!busy && (!demo || c.protocol === 'ssh')) onOpen(c);
                    }
                    if (demo) return;
                    if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
                      e.preventDefault();
                      setSelected(c.id);
                      setMenu(c.id);
                    }
                    if (e.key === 'F2' && !busy) {
                      e.preventDefault();
                      onEdit(c);
                    }
                    if (e.key === 'Delete') {
                      e.preventDefault();
                      setError('');
                      setDeleting({ id: c.id, name: c.name });
                    }
                  }}
                >
                  <Icon name={c.protocol === 'rdp' ? 'desktop' : 'terminal'} width="16" />
                  <strong>
                    {preferences[c.id]?.favorite && (
                      <span aria-label={translate('connections:favorite')}>★ </span>
                    )}
                    {c.name}
                    {preferences[c.id]?.environment && (
                      <em className={`connection-environment ${preferences[c.id]?.environment}`}>
                        {
                          (
                            {
                              production: translate('connections:production'),
                              staging: translate('connections:staging'),
                              development: translate('connections:development'),
                            } as Record<string, string>
                          )[preferences[c.id]?.environment || '']
                        }
                      </em>
                    )}
                  </strong>
                  <span className="connection-address-text">
                    <span className="connection-inline-user">{c.username}@</span>
                    {c.host}:{c.port}
                  </span>
                  <span className="connection-user">{c.username}</span>
                  <small className="connection-protocol">{c.protocol.toUpperCase()}</small>
                  <small className="connection-session-state">
                    {sessions[c.id]?.length ? (
                      <span>
                        {[...new Set(sessions[c.id])]
                          .map(
                            (state) =>
                              `${state} ${sessions[c.id].filter((s) => s === state).length}`,
                          )
                          .join(' / ')}
                      </span>
                    ) : null}
                  </small>
                </button>
              </Tooltip>
              <ConnectionLatency
                name={c.name}
                demo={demo}
                measurement={(demoLatency || latency.measurements)[c.id]}
                onRefresh={() => latency.refresh(c.id)}
              />
              <Dropdown isOpen={menu === c.id} onOpenChange={(open) => setMenu(open ? c.id : '')}>
                <DropdownTrigger>
                  <button
                    className="icon-button row-menu"
                    disabled={demo}
                    aria-label={translate('connections:connectionActions', { value1: c.name })}
                    onFocus={() => setSelected(c.id)}
                  >
                    <Icon name="more" />
                  </button>
                </DropdownTrigger>
                <DropdownMenu
                  aria-label={translate('connections:connectionActions', { value1: c.name })}
                  disabledKeys={busy ? ['open', 'another', 'edit', 'duplicate'] : []}
                  onAction={(key) => {
                    if (demo) return;
                    if (key === 'open') onOpen(c);
                    if (key === 'another') onOpen(c, true);
                    if (key === 'system') onOpen(c, true, 'system');
                    if (key === 'playbook') onPlaybook?.(c);
                    if (key === 'edit') onEdit(c);
                    if (key === 'duplicate') {
                      setError('');
                      setIncludeCredentials(false);
                      setDuplicating(c);
                    }
                    if (key === 'delete') {
                      setError('');
                      setDeleting({ id: c.id, name: c.name });
                    }
                  }}
                >
                  <DropdownItem key="open">
                    {translate('connections:connectLocateWorkspace')}
                  </DropdownItem>
                  <DropdownItem key="another">
                    {translate('connections:openAnotherWorkspace')}
                  </DropdownItem>
                  <DropdownItem
                    key="system"
                    className={c.protocol === 'rdp' ? '' : 'hidden'}
                    isDisabled={busy || !systemRDP || c.protocol !== 'rdp'}
                  >
                    {translate('connections:useSystemClient')}
                  </DropdownItem>
                  <DropdownItem key="playbook" className={onPlaybook ? '' : 'hidden'}>
                    {translate('connections:playbook')}
                  </DropdownItem>
                  <DropdownItem key="edit">{translate('connections:editConnection')}</DropdownItem>
                  <DropdownItem key="duplicate">
                    {translate('connections:copyConfiguration')}
                  </DropdownItem>
                  <DropdownItem key="delete" color="danger">
                    {translate('connections:deleteConnection')}
                  </DropdownItem>
                </DropdownMenu>
              </Dropdown>
            </div>
          ))}
        </div>
        {loading ? (
          <p className="sidebar-empty" role="status">
            {translate('connections:readingConnections')}
          </p>
        ) : loadError ? (
          <div className="sidebar-empty">
            <p className="error">{translate('connections:couldNotReadConnections')}</p>
            <Button size="sm" variant="light" onPress={onReload}>
              {translate('connections:retry')}
            </Button>
          </div>
        ) : (
          visible.length === 0 && (
            <div className="sidebar-empty">
              <span>
                {filtered || group
                  ? translate('connections:noMatchingConnections')
                  : view === 'favorite'
                    ? translate('connections:noFavorites')
                    : view === 'recent'
                      ? translate('connections:noRecentConnections')
                      : translate('connections:noConnections')}
              </span>
              {filtered && (
                <Button size="sm" variant="light" onPress={clearFilters}>
                  {translate('connections:clearFilters')}
                </Button>
              )}
            </div>
          )
        )}
        <div className="catalog-actions">
          <span className="catalog-result-count" role="status">
            {translate('connections:resultCount', {
              visible: visible.length,
              total: connections.length,
            })}
          </span>
          {onMultiHost &&
            selectedIDs.length > 0 &&
            selectedIDs.every((id) =>
              connections.some(
                (connection) => connection.id === id && connection.protocol === 'ssh',
              ),
            ) && (
              <Button
                size="sm"
                variant="light"
                isDisabled={busy || demo}
                onPress={() => onMultiHost(selectedIDs)}
              >
                {translate('connections:multiHostOperations')}
              </Button>
            )}
          {selectedConnection ? (
            <>
              <Button
                size="sm"
                color="primary"
                variant="flat"
                isDisabled={busy || (demo && selectedConnection.protocol !== 'ssh')}
                onPress={() => onOpen(selectedConnection)}
              >
                {translate('connections:connect')}
              </Button>
              <Button
                size="sm"
                variant="light"
                isDisabled={busy || demo}
                onPress={() => onEdit(selectedConnection)}
              >
                {translate('connections:edit')}
              </Button>
              <Button
                size="sm"
                variant="light"
                isDisabled={demo}
                aria-pressed={!!preferences[selectedConnection.id]?.favorite}
                onPress={() =>
                  void preference(
                    selectedConnection.id,
                    !preferences[selectedConnection.id]?.favorite,
                    preferences[selectedConnection.id]?.environment || '',
                  )
                }
              >
                {preferences[selectedConnection.id]?.favorite
                  ? translate('connections:removeFromFavorites')
                  : translate('connections:favorites')}
              </Button>
            </>
          ) : selectedIDs.length > 1 ? (
            <div className="catalog-batch">
              <label>
                <input
                  type="checkbox"
                  aria-label={translate('connections:selectAllVisibleConnections')}
                  checked={!!visible.length && selectedIDs.length === visible.length}
                  onChange={(e) => setSelection(e.target.checked ? visible.map((c) => c.id) : [])}
                />
                {translate('connections:selected')}
                {selectedIDs.length} {translate('connections:items')}
              </label>
              <Button
                size="sm"
                variant="light"
                isDisabled={working || demo}
                onPress={() => setMoveOpen(true)}
              >
                {translate('connections:moveToGroup')}
              </Button>
              <Button
                size="sm"
                variant="light"
                isDisabled={working || demo || selectedIDs.length > 256}
                onPress={() =>
                  setCredentialTargets(
                    connections.filter((connection) => selectedSet.has(connection.id)),
                  )
                }
              >
                {translate('connections:reuseCredentials')}
              </Button>
              <Tooltip content={translate('connections:deselect')}>
                <button
                  className="icon-button"
                  aria-label={translate('connections:deselect')}
                  onClick={() => setSelection([])}
                >
                  <Icon name="close" width="14" />
                </button>
              </Tooltip>
            </div>
          ) : null}
          <Dropdown>
            <DropdownTrigger>
              <Tooltip content={translate('connections:listOptions')}>
                <button className="icon-button" aria-label={translate('connections:listOptions')}>
                  <Icon name="sort" width="16" />
                </button>
              </Tooltip>
            </DropdownTrigger>
            <DropdownMenu
              aria-label={translate('connections:listOptions')}
              disabledKeys={demo ? ['clear'] : []}
              onAction={(key) => {
                if (key === 'recent') {
                  setSort('recent');
                  setDescending(false);
                }
                if (key === 'clear' && !demo)
                  void ClearRecentConnections()
                    .then(onReload)
                    .catch((e) => setError(e));
              }}
            >
              <DropdownItem key="recent" endContent={sort === 'recent' ? '✓' : null}>
                {translate('connections:sortByRecentConnections')}
              </DropdownItem>
              <DropdownItem key="clear" className={view === 'recent' ? '' : 'hidden'}>
                {translate('connections:clearRecentConnections')}
              </DropdownItem>
            </DropdownMenu>
          </Dropdown>
          <Tooltip content={translate('connections:refreshConnections')}>
            <button
              className="icon-button"
              disabled={loading || demo}
              aria-label={translate('connections:refreshConnections')}
              onClick={onReload}
            >
              <Icon name="refresh" width="15" />
            </button>
          </Tooltip>
        </div>
      </section>
      <Modal
        isOpen={moveOpen}
        onClose={() => {
          if (!working) {
            setMoveOpen(false);
            setError('');
          }
        }}
        className="app-dialog"
      >
        <ModalContent>
          <ModalHeader>
            {translate('connections:move')}
            {selectedIDs.length} {translate('connections:connections')}
          </ModalHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void move(selectedIDs, String(new FormData(e.currentTarget).get('target') || ''));
            }}
          >
            <ModalBody>
              <label className="form-field">
                {translate('connections:destinationGroup')}
                <SelectControl name="target" disabled={working}>
                  <option value="">{translate('connections:ungrouped')}</option>
                  {groups.map((g) => (
                    <option value={g.id} key={g.id}>
                      {g.name}
                    </option>
                  ))}
                </SelectControl>
              </label>
              {error && (
                <p role="alert" className="error">
                  {error}
                </p>
              )}
            </ModalBody>
            <ModalFooter>
              <Button
                variant="light"
                isDisabled={working}
                onPress={() => {
                  setMoveOpen(false);
                  setError('');
                }}
              >
                {translate('connections:cancel')}
              </Button>
              <Button type="submit" color="primary" isLoading={working}>
                {translate('connections:move2')}
              </Button>
            </ModalFooter>
          </form>
        </ModalContent>
      </Modal>
      {importOpen && (
        <ImportConnectionsDialog onClose={() => setImportOpen(false)} onImported={onReload} />
      )}
      {credentialTargets && (
        <CredentialAssignDialog
          connections={credentialTargets}
          onChanged={onReload}
          onClose={() => setCredentialTargets(undefined)}
        />
      )}
      <Modal
        isOpen={!!duplicating}
        onClose={() => {
          if (!working) {
            setDuplicating(undefined);
            setError('');
          }
        }}
        className="app-dialog"
      >
        <ModalContent>
          <ModalHeader>{translate('connections:copyConfiguration')}</ModalHeader>
          <ModalBody>
            <p>{duplicating?.name}</p>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={includeCredentials}
                onChange={(e) => setIncludeCredentials(e.target.checked)}
                disabled={working || !duplicating?.credential_id}
              />
              {translate('connections:includeSavedCredentials')}
            </label>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
          </ModalBody>
          <ModalFooter>
            <Button
              variant="light"
              isDisabled={working}
              onPress={() => {
                setDuplicating(undefined);
                setError('');
              }}
            >
              {translate('connections:cancel')}
            </Button>
            <Button
              color="primary"
              isLoading={working}
              onPress={async () => {
                if (!duplicating) return;
                setWorking(true);
                try {
                  const copy = await DuplicateConnection(duplicating.id, includeCredentials);
                  setSelected(copy.id);
                  setDuplicating(undefined);
                  onReload();
                } catch (e) {
                  setError(e);
                } finally {
                  setWorking(false);
                }
              }}
            >
              {translate('connections:copy')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
      <Modal
        isOpen={!!groupDialog}
        onClose={() => {
          if (!working) {
            setGroupDialog(undefined);
            setError('');
          }
        }}
        className="app-dialog"
      >
        <ModalContent>
          <ModalHeader>
            {groupDialog?.value
              ? translate('connections:editGroup')
              : translate('connections:newGroup')}
          </ModalHeader>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              setWorking(true);
              try {
                await SaveGroup({
                  id: groupDialog?.value?.id || '',
                  name: String(data.get('name')),
                  parent_id: String(data.get('parent')),
                  sort_order: groupDialog?.value?.sort_order ?? groups.length,
                });
                onReload();
                setGroupDialog(undefined);
              } catch (e) {
                setError(e);
              } finally {
                setWorking(false);
              }
            }}
          >
            <ModalBody>
              <Input
                name="name"
                label={translate('connections:groupName')}
                labelPlacement="outside"
                placeholder={translate('connections:groupName')}
                defaultValue={groupDialog?.value?.name}
                isRequired
                autoFocus
              />
              <label className="form-field">
                {translate('connections:parentGroup')}
                <SelectControl name="parent" defaultValue={groupDialog?.value?.parent_id || ''}>
                  <option value="">{translate('connections:rootGroup')}</option>
                  {groups
                    .filter((g) => g.id !== groupDialog?.value?.id)
                    .map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                </SelectControl>
              </label>
              {error && (
                <p role="alert" className="error">
                  {error}
                </p>
              )}
            </ModalBody>
            <ModalFooter>
              <Button
                variant="light"
                onPress={() => {
                  setGroupDialog(undefined);
                  setError('');
                }}
                isDisabled={working}
              >
                {translate('connections:cancel')}
              </Button>
              <Button type="submit" color="primary" isLoading={working}>
                {translate('connections:save')}
              </Button>
            </ModalFooter>
          </form>
        </ModalContent>
      </Modal>
      <Modal
        isOpen={!!deleting}
        onClose={() => {
          if (!working) {
            setDeleting(undefined);
            setError('');
          }
        }}
        className="app-dialog"
      >
        <ModalContent>
          <ModalHeader>
            {deleting?.group
              ? translate('connections:deleteGroup')
              : translate('connections:deleteConnection')}
          </ModalHeader>
          <ModalBody>
            <p>{translate('connections:confirmDeleteNamed', { name: deleting?.name })}</p>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
          </ModalBody>
          <ModalFooter>
            <Button
              variant="light"
              isDisabled={working}
              onPress={() => {
                setDeleting(undefined);
                setError('');
              }}
            >
              {translate('connections:cancel')}
            </Button>
            <Button
              color="danger"
              isLoading={working}
              onPress={async () => {
                if (!deleting) return;
                setWorking(true);
                try {
                  await (deleting.group ? DeleteGroup(deleting.id) : DeleteConnection(deleting.id));
                  if (group === deleting.id) setGroup('');
                  setDeleting(undefined);
                  setError('');
                  onReload();
                } catch (e) {
                  setError(e);
                } finally {
                  setWorking(false);
                }
              }}
            >
              {translate('connections:delete')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}
