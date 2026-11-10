import Modal from '../../components/Modal';
import { eventError } from '../../lib/errors.ts';
import { t as translate, currentLocale } from '../../i18n/index.ts';
import { message as uiMessage } from '../../i18n/messages.ts';
import { useMessageState } from '../../i18n/useMessageState.ts';
import { useTranslation } from 'react-i18next';
import { useEffect, useRef, useState } from 'react';
import { Button, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react';
import {
  ChangeLinuxServiceState,
  ListLinuxProcesses,
  ListLinuxServices,
  ReadLinuxProcessDetails,
  ReadLinuxServiceDetails,
  ReadLinuxServiceLog,
} from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type {
  LinuxProcess,
  LinuxProcessDetails,
  LinuxProcessList,
  LinuxServiceDetails,
  LinuxServiceList,
} from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import type { CommandResult } from '../../../bindings/github.com/Sanjeever/termquay/internal/ssh/models';
import ErrorNotice from '../../components/ErrorNotice';
import SelectControl from '../../components/SelectControl';
import Tooltip from '../../components/Tooltip';

import { bytes } from '../files/transferFormat';
import PortInspection from './PortInspection';

type Navigation = {
  onDirectory?(path: string): void;
  onFile?(path: string): Promise<void>;
  onService(unit: string): void;
};

function ProcessDetails({
  workspace,
  process,
  onDirectory,
  onService,
}: { workspace: string; process: LinuxProcess } & Navigation) {
  useTranslation();
  const [details, setDetails] = useState<LinuxProcessDetails>();
  const [error, setError] = useMessageState('');
  useEffect(() => {
    let ended = false;
    const request = ReadLinuxProcessDetails(workspace, process.pid);
    request
      .then((value) => {
        if (!ended) setDetails(value);
      })
      .catch((e) => {
        if (!ended) setError(e);
      });
    return () => {
      ended = true;
      request.cancel();
    };
  }, [workspace, process.pid]);
  return (
    <section
      className="inspection-detail"
      aria-label={translate('monitor:processDetails', { value1: process.pid })}
    >
      <div className="session-status">
        PID {process.pid} {translate('monitor:parentProcess')}
        {process.parent} · {process.user} {translate('monitor:runningFor')}
        {process.elapsed}
      </div>
      <pre className="inspection-command">{process.command}</pre>
      <ErrorNotice message={error} />
      {!details && !error && (
        <p role="status" className="muted">
          {translate('monitor:readingProcessDetails')}
        </p>
      )}
      {details && (
        <>
          {details.executable && (
            <p className="file-path">
              {translate('monitor:executable')}
              {details.executable}
            </p>
          )}
          {details.directory && (
            <div className="inspection-path">
              <span className="file-path">
                {translate('monitor:workingDirectory')}
                {details.directory}
              </span>
              {onDirectory && details.directory.startsWith('/') && (
                <Button size="sm" variant="light" onPress={() => onDirectory(details.directory)}>
                  {translate('monitor:openDirectory')}
                </Button>
              )}
            </div>
          )}
          {details.service && (
            <Button size="sm" variant="light" onPress={() => onService(details.service)}>
              {translate('monitor:viewService')}
              {details.service}
            </Button>
          )}
          {(details.errors || []).map((message, index) => (
            <p key={index} role="status" className="error">
              {message}
            </p>
          ))}
        </>
      )}
    </section>
  );
}

function ProcessInspection({
  workspace,
  initialOrder,
  ...navigation
}: { workspace: string; initialOrder: 'cpu' | 'memory' } & Navigation) {
  useTranslation();
  const [order, setOrder] = useState(initialOrder);
  const [filter, setFilter] = useState('');
  const [revision, setRevision] = useState(0);
  const [list, setList] = useState<LinuxProcessList>();
  const [selected, setSelected] = useState<LinuxProcess>();
  const [error, setError] = useMessageState('');
  const [busy, setBusy] = useState(true);
  useEffect(() => {
    let ended = false;
    setBusy(true);
    setError('');
    setList(undefined);
    setSelected(undefined);
    const request = ListLinuxProcesses(workspace, order);
    request
      .then((value) => {
        if (!ended) setList(value);
      })
      .catch((e) => {
        if (!ended) setError(e);
      })
      .finally(() => {
        if (!ended) setBusy(false);
      });
    return () => {
      ended = true;
      request.cancel();
    };
  }, [workspace, order, revision]);
  const query = filter.toLowerCase();
  const items = (list?.items || []).filter((process) =>
    `${process.pid} ${process.user} ${process.command}`.toLowerCase().includes(query),
  );
  return (
    <>
      <div className="inspection-toolbar">
        <SelectControl
          aria-label={translate('monitor:processSorting')}
          value={order}
          onChange={(event) => setOrder(event.target.value as 'cpu' | 'memory')}
        >
          <option value="cpu">{translate('monitor:sortByCPU')}</option>
          <option value="memory">{translate('monitor:sortByMemory')}</option>
        </SelectControl>
        <input
          aria-label={translate('monitor:filterProcessesAlreadyRead')}
          placeholder={translate('monitor:filterProcessesAlreadyRead')}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          maxLength={256}
        />
        <Button
          size="sm"
          variant="light"
          isLoading={busy}
          onPress={() => setRevision((value) => value + 1)}
        >
          {translate('monitor:refresh')}
        </Button>
      </div>
      <ErrorNotice message={error} />
      {list?.warning && (
        <p role="status" className="error">
          {list.warning}
        </p>
      )}
      {list && (
        <div className="session-status" role="status">
          {items.length} / {list.items?.length || 0} {translate('monitor:processes')}
          {new Date(list.time).toLocaleTimeString(currentLocale())}
          {list.truncated && translate('monitor:resultsTruncatedChangeSortingToViewOtherHigh')}
        </div>
      )}
      <div className="inspection-table-scroll">
        <table className="inspection-table inspection-processes">
          <thead>
            <tr>
              <th>PID</th>
              <th>{translate('monitor:user')}</th>
              <th>
                <Tooltip content={translate('monitor:averageCPUUsageOverTheProcessLifetimeFrom')}>
                  <span>CPU %</span>
                </Tooltip>
              </th>
              <th>{translate('monitor:memory')}</th>
              <th>{translate('monitor:commandLine')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((process) => (
              <tr key={process.pid} className={selected?.pid === process.pid ? 'selected' : ''}>
                <td>
                  <button
                    className="inspection-pick"
                    aria-label={translate('monitor:viewProcess', { value1: process.pid })}
                    aria-pressed={selected?.pid === process.pid}
                    onClick={() => setSelected(process)}
                  >
                    {process.pid}
                  </button>
                </td>
                <td>{process.user}</td>
                <td>{process.cpu.toFixed(1)}</td>
                <td>
                  <Tooltip
                    content={translate('monitor:physicalMemoryUsage', {
                      value1: process.memory.toFixed(1),
                    })}
                  >
                    <span>{bytes(process.rss)}</span>
                  </Tooltip>
                </td>
                <td>
                  <button
                    className="inspection-process-command"
                    aria-label={translate('monitor:viewProcessDetails', { value1: process.pid })}
                    onClick={() => setSelected(process)}
                  >
                    {process.command}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {list && !items.length && (
        <p className="sidebar-empty">{translate('monitor:noMatchingProcesses')}</p>
      )}
      {selected && (
        <ProcessDetails
          key={`${workspace}:${revision}:${selected.pid}`}
          workspace={workspace}
          process={selected}
          {...navigation}
        />
      )}
    </>
  );
}

const serviceProperties = () =>
  [
    ['Description', translate('monitor:description')],
    ['LoadState', translate('monitor:loadState')],
    ['ActiveState', translate('monitor:activeState')],
    ['SubState', translate('monitor:substate')],
    ['UnitFileState', translate('monitor:startOnBoot')],
    ['Result', translate('monitor:result')],
    ['MainPID', translate('monitor:mainProcess')],
    ['ExecMainStatus', translate('monitor:exitStatus')],
    ['ExecMainStartTimestamp', translate('monitor:startedAt')],
    ['User', translate('monitor:runAsUser')],
  ] as const;
const serviceActions = {
  get start() {
    return translate('monitor:start');
  },
  get stop() {
    return translate('monitor:stop');
  },
  get restart() {
    return translate('monitor:restart');
  },
  get reload() {
    return translate('monitor:reload');
  },
  get enable() {
    return translate('monitor:enableOnBoot');
  },
  get disable() {
    return translate('monitor:disableOnBoot');
  },
} as const;

function ServiceDetails({
  workspace,
  unit,
  onDirectory,
  onFile,
  onChanged,
}: { workspace: string; unit: string; onChanged(): void } & Navigation) {
  useTranslation();
  const [details, setDetails] = useState<LinuxServiceDetails>();
  const [log, setLog] = useState<CommandResult>();
  const [error, setError] = useMessageState('');
  const [logError, setLogError] = useMessageState('');
  const [revision, setRevision] = useState(0);
  const [action, setAction] = useState<keyof typeof serviceActions>();
  const [changing, setChanging] = useState(false);
  const [actionError, setActionError] = useMessageState('');
  const mutation = useRef<ReturnType<typeof ChangeLinuxServiceState>>();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      mutation.current?.cancel();
    };
  }, []);
  useEffect(() => {
    let ended = false;
    setDetails(undefined);
    setLog(undefined);
    setError('');
    setLogError('');
    const request = ReadLinuxServiceDetails(workspace, unit);
    const logs = ReadLinuxServiceLog(workspace, unit);
    request
      .then((value) => {
        if (!ended) setDetails(value);
      })
      .catch((e) => {
        if (!ended) setError(e);
      });
    logs
      .then((value) => {
        if (!ended) setLog(value);
      })
      .catch((e) => {
        if (!ended) setLogError(e);
      });
    return () => {
      ended = true;
      request.cancel();
      logs.cancel();
    };
  }, [workspace, unit, revision]);
  async function changeState() {
    if (!action || mutation.current) return;
    setChanging(true);
    setActionError('');
    const request = ChangeLinuxServiceState(workspace, unit, action);
    mutation.current = request;
    try {
      const result = await request;
      if (!mounted.current) return;
      setAction(undefined);
      if (result.error || result.exit_code !== 0)
        setActionError(
          `${eventError(result) || result.stderr.trim() || uiMessage('monitor:serviceOperationFailedExitCode', { value1: result.exit_code })}${result.exit_code < 0 ? uiMessage('monitor:remoteStateUnknownVerifyServiceStateDoNot') : ''}${result.truncated ? uiMessage('monitor:outputTruncated') : ''}`,
        );
      else if (result.stderr.trim()) setActionError(result.stderr.trim());
    } catch (e) {
      if (mounted.current) {
        setAction(undefined);
        setActionError(uiMessage('monitor:refreshToVerifyServiceState', { value1: e }));
      }
    } finally {
      mutation.current = undefined;
      if (mounted.current) {
        setChanging(false);
        setRevision((value) => value + 1);
        onChanged();
      }
    }
  }
  const properties = details?.properties || {};
  return (
    <section
      className="inspection-detail"
      aria-label={translate('monitor:details', { value1: unit })}
    >
      <div className="inspection-toolbar">
        <strong>{unit}</strong>
        <Button
          size="sm"
          variant="light"
          isDisabled={changing}
          onPress={() => setRevision((value) => value + 1)}
        >
          {translate('monitor:refreshDetailsAndLogs')}
        </Button>
      </div>
      {details && (
        <div className="button-row">
          {(Object.keys(serviceActions) as (keyof typeof serviceActions)[]).map((value) => (
            <Button
              key={value}
              size="sm"
              variant="light"
              isDisabled={changing || (value === 'reload' && properties.CanReload !== 'yes')}
              onPress={() => {
                setAction(value);
                setActionError('');
              }}
            >
              {serviceActions[value]}
            </Button>
          ))}
        </div>
      )}
      {action && details && (
        <section
          className="inspection-detail"
          aria-label={translate('monitor:confirmServiceOperation')}
        >
          <p>
            {details.target} · {unit} · {serviceActions[action]}
          </p>
          <code>
            systemctl {action} -- '{unit}'
          </code>
          <div className="button-row">
            <Button
              size="sm"
              variant="light"
              isDisabled={changing}
              onPress={() => setAction(undefined)}
            >
              {translate('monitor:cancel')}
            </Button>
            <Button
              size="sm"
              color="danger"
              isLoading={changing}
              onPress={() => void changeState()}
            >
              {translate('monitor:confirmExecution')}
            </Button>
          </div>
        </section>
      )}
      <ErrorNotice message={actionError} />
      <ErrorNotice message={error} />
      {details?.warning && (
        <p className="error" role="status">
          {details.warning}
        </p>
      )}
      {!details && !error && (
        <p role="status" className="muted">
          {translate('monitor:readingServiceDetails')}
        </p>
      )}
      {details && (
        <>
          <dl className="inspection-properties">
            {serviceProperties()
              .filter(([key]) => properties[key] !== '')
              .map(([key, label]) => (
                <div key={key}>
                  <dt>{label}</dt>
                  <dd>{properties[key] || '—'}</dd>
                </div>
              ))}
          </dl>
          {properties.FragmentPath && (
            <div className="inspection-path">
              <span className="file-path">{properties.FragmentPath}</span>
              {onFile && properties.FragmentPath.startsWith('/') && (
                <Button
                  size="sm"
                  variant="light"
                  onPress={() => {
                    void onFile(properties.FragmentPath!).catch((e) => setError(e));
                  }}
                >
                  {translate('monitor:openServiceFile')}
                </Button>
              )}
            </div>
          )}
          {properties.WorkingDirectory && (
            <div className="inspection-path">
              <span className="file-path">{properties.WorkingDirectory}</span>
              {onDirectory && properties.WorkingDirectory.startsWith('/') && (
                <Button
                  size="sm"
                  variant="light"
                  onPress={() => onDirectory(properties.WorkingDirectory!)}
                >
                  {translate('monitor:openWorkingDirectory')}
                </Button>
              )}
            </div>
          )}
        </>
      )}
      <details className="inspection-journal" open>
        <summary>{translate('monitor:recentLogs')}</summary>
        <ErrorNotice message={logError} />
        {!log && !logError && (
          <p role="status" className="muted">
            {translate('monitor:readingLogs')}
          </p>
        )}
        {log?.stderr && (
          <p className="error" role="status">
            {log.stderr}
          </p>
        )}
        {log && <pre className="remote-log-content">{log.stdout}</pre>}
        {log?.truncated && (
          <p className="error" role="status">
            {translate('monitor:logOutputTruncated')}
          </p>
        )}
      </details>
    </section>
  );
}

function ServiceInspection({
  workspace,
  initialUnit,
  ...navigation
}: { workspace: string; initialUnit: string } & Navigation) {
  useTranslation();
  const [filter, setFilter] = useState(initialUnit);
  const [query, setQuery] = useState(initialUnit);
  const [revision, setRevision] = useState(0);
  const [list, setList] = useState<LinuxServiceList>();
  const [selected, setSelected] = useState(initialUnit);
  const [error, setError] = useMessageState('');
  const [busy, setBusy] = useState(true);
  useEffect(() => {
    let ended = false;
    setBusy(true);
    setError('');
    setList(undefined);
    const request = ListLinuxServices(workspace, query);
    request
      .then((value) => {
        if (!ended) setList(value);
      })
      .catch((e) => {
        if (!ended) setError(e);
      })
      .finally(() => {
        if (!ended) setBusy(false);
      });
    return () => {
      ended = true;
      request.cancel();
    };
  }, [workspace, query, revision]);
  return (
    <>
      <form
        className="inspection-toolbar"
        onSubmit={(event) => {
          event.preventDefault();
          setSelected('');
          setQuery(filter);
          setRevision((value) => value + 1);
        }}
      >
        <input
          aria-label={translate('monitor:filterByServiceNameWildcardsSupported')}
          placeholder={translate('monitor:serviceNameWildcardsSupported')}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          maxLength={256}
        />
        <Button size="sm" type="submit" variant="light" isLoading={busy}>
          {translate('monitor:refresh')}
        </Button>
      </form>
      <ErrorNotice message={error} />
      {list?.warning && (
        <p className="error" role="status">
          {list.warning}
        </p>
      )}
      {list && (
        <div className="session-status" role="status">
          {list.items?.length || 0} {translate('monitor:loadedServices')}
          {new Date(list.time).toLocaleTimeString(currentLocale())}
          {list.truncated && translate('monitor:resultsTruncatedNarrowTheFilter')}
        </div>
      )}
      <div className="inspection-table-scroll">
        <table className="inspection-table inspection-services">
          <thead>
            <tr>
              <th>{translate('monitor:service')}</th>
              <th>{translate('monitor:activeState')}</th>
              <th>{translate('monitor:description')}</th>
            </tr>
          </thead>
          <tbody>
            {(list?.items || []).map((service) => (
              <tr key={service.unit} className={selected === service.unit ? 'selected' : ''}>
                <td>
                  <Tooltip content={service.unit}>
                    <button
                      className="inspection-pick"
                      aria-label={translate('monitor:viewService2', { value1: service.unit })}
                      aria-pressed={selected === service.unit}
                      onClick={() => setSelected(service.unit)}
                    >
                      {service.unit}
                    </button>
                  </Tooltip>
                </td>
                <td className={service.active === 'failed' ? 'error' : ''}>{service.active}</td>
                <td>
                  <span className="inspection-description">{service.description}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {list && !list.items?.length && (
        <p className="sidebar-empty">{translate('monitor:noMatchingLoadedServices')}</p>
      )}
      {selected && (
        <ServiceDetails
          key={`${workspace}:${selected}`}
          workspace={workspace}
          unit={selected}
          onChanged={() => setRevision((value) => value + 1)}
          {...navigation}
        />
      )}
    </>
  );
}

export default function LinuxInspectionDialog({
  workspace,
  initialOrder,
  initialUnit = '',
  onDirectory,
  onFile,
  onClose,
}: {
  workspace: string;
  initialOrder: 'cpu' | 'memory' | 'services';
  initialUnit?: string;
  onDirectory?(path: string): void;
  onFile?(path: string): Promise<void>;
  onClose(): void;
}) {
  useTranslation();
  const [tab, setTab] = useState(initialOrder === 'services' ? 'services' : 'processes');
  const [service, setService] = useState(initialUnit);
  function openDirectory(path: string) {
    onDirectory?.(path);
    onClose();
  }
  async function openFile(path: string) {
    await onFile?.(path);
    onClose();
  }
  function openService(unit: string) {
    setService(unit);
    setTab('services');
  }
  return (
    <Modal
      isOpen
      onClose={onClose}
      size="5xl"
      scrollBehavior="inside"
      className="app-dialog linux-inspection-dialog"
    >
      <ModalContent>
        <ModalHeader>{translate('monitor:processesServicesAndPorts')}</ModalHeader>
        <ModalBody className="inspection-body">
          <div
            className="protocol-filters"
            role="group"
            aria-label={translate('monitor:diagnosticType')}
          >
            <button aria-pressed={tab === 'processes'} onClick={() => setTab('processes')}>
              {translate('monitor:processes2')}
            </button>
            <button
              aria-pressed={tab === 'services'}
              onClick={() => {
                setService('');
                setTab('services');
              }}
            >
              {translate('monitor:service')}
            </button>
            <button aria-pressed={tab === 'ports'} onClick={() => setTab('ports')}>
              {translate('monitor:ports')}
            </button>
          </div>
          {tab === 'ports' && (
            <PortInspection
              workspace={workspace}
              onDirectory={onDirectory ? openDirectory : undefined}
              onService={openService}
            />
          )}
          {tab !== 'ports' && (
            <>
              {tab === 'processes' ? (
                <ProcessInspection
                  workspace={workspace}
                  initialOrder={initialOrder === 'memory' ? 'memory' : 'cpu'}
                  onDirectory={onDirectory ? openDirectory : undefined}
                  onFile={onFile ? openFile : undefined}
                  onService={openService}
                />
              ) : (
                <ServiceInspection
                  key={service}
                  workspace={workspace}
                  initialUnit={service}
                  onDirectory={onDirectory ? openDirectory : undefined}
                  onFile={onFile ? openFile : undefined}
                  onService={openService}
                />
              )}
            </>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="light" onPress={onClose}>
            {translate('monitor:close')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
