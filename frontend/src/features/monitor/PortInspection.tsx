import { t as translate, currentLocale } from '../../i18n/index.ts';
import { useMessageState } from '../../i18n/useMessageState.ts';
import { useTranslation } from 'react-i18next';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@heroui/react';
import { Browser } from '@wailsio/runtime';
import {
  ListLinuxPorts,
  ReadLinuxProcessDetails,
  ProbeNetworkTCP,
  StartTunnel,
} from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type {
  LinuxPortList,
  LinuxProcessDetails,
} from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import SelectControl from '../../components/SelectControl';

export default function PortInspection({
  workspace,
  onDirectory,
  onService,
}: {
  workspace: string;
  onDirectory?(path: string): void;
  onService(unit: string): void;
}) {
  useTranslation();
  const [list, setList] = useState<LinuxPortList>();
  const [filter, setFilter] = useState('');
  const [revision, setRevision] = useState(0);
  const [error, setError] = useMessageState('');
  const [details, setDetails] = useState<{ pid: number; value: LinuxProcessDetails }>();
  const [source, setSource] = useState('remote');
  const [host, setHost] = useState('127.0.0.1');
  const [port, setPort] = useState(8080);
  const [probe, setProbe] = useState('');
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const requests = useRef(new Set<{ cancel(): void }>());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const activeRequests = requests.current;
    return () => {
      mounted.current = false;
      activeRequests.forEach((value) => value.cancel());
    };
  }, []);
  useEffect(() => {
    let ended = false;
    setError('');
    setList(undefined);
    const request = ListLinuxPorts(workspace);
    request
      .then((value) => {
        if (!ended) setList(value);
      })
      .catch((e) => {
        if (!ended) setError(e);
      });
    return () => {
      ended = true;
      request.cancel();
    };
  }, [workspace, revision, setError]);
  async function operate<T>(request: Promise<T> & { cancel(): void }, apply: (value: T) => void) {
    setBusy(true);
    setError('');
    requests.current.add(request);
    try {
      const value = await request;
      if (mounted.current) apply(value);
    } catch (e) {
      if (mounted.current) setError(e);
    } finally {
      requests.current.delete(request);
      if (mounted.current) setBusy(false);
    }
  }
  const items = (list?.items || []).filter((item) =>
    `${item.address} ${item.protocol} ${item.process}`.toLowerCase().includes(filter.toLowerCase()),
  );
  return (
    <>
      <div className="inspection-toolbar">
        <input
          aria-label={translate('monitor:filterListeningPorts')}
          placeholder={translate('monitor:portAddressOrProcess')}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
        <Button size="sm" variant="light" onPress={() => setRevision((value) => value + 1)}>
          {translate('monitor:refresh')}
        </Button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {list?.warning && <p className="error">{list.warning}</p>}
      {list && (
        <p className="session-status">
          {items.length} {translate('monitor:listeningPorts2')}
          {new Date(list.time).toLocaleTimeString(currentLocale())}
          {list.truncated && translate('monitor:truncated')}{' '}
          {translate('monitor:processInformationLimitedByRemotePermissions')}
        </p>
      )}
      <div className="inspection-table-scroll">
        <table className="inspection-table inspection-ports">
          <thead>
            <tr>
              <th>{translate('monitor:address')}</th>
              <th>{translate('monitor:protocol')}</th>
              <th>{translate('monitor:state')}</th>
              <th>{translate('monitor:processes2')}</th>
              <th>{translate('monitor:actions')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <tr key={`${item.protocol}:${item.address}:${index}`}>
                <td>{item.address}</td>
                <td>{item.protocol}</td>
                <td>{item.state}</td>
                <td>
                  {item.pids?.length
                    ? item.pids.map((pid) => (
                        <button
                          key={pid}
                          className="inspection-pick"
                          disabled={busy}
                          onClick={() => {
                            setDetails(undefined);
                            void operate(ReadLinuxProcessDetails(workspace, pid), (value) =>
                              setDetails({ pid, value }),
                            );
                          }}
                        >
                          PID {pid}
                        </button>
                      ))
                    : translate('monitor:unknown')}
                </td>
                <td>
                  {item.protocol === 'tcp' && (
                    <Button
                      size="sm"
                      variant="bordered"
                      isDisabled={busy}
                      onPress={() => {
                        const target = ['*', '0.0.0.0'].includes(item.host)
                          ? '127.0.0.1'
                          : item.host === '::'
                            ? '::1'
                            : item.host;
                        setAddress('');
                        void operate(
                          StartTunnel(workspace, {
                            kind: 'local',
                            bind_host: '127.0.0.1',
                            bind_port: 0,
                            target_host: target,
                            target_port: item.port,
                            allow_public: false,
                          }),
                          (value) => setAddress(value.info.address),
                        );
                      }}
                    >
                      {translate('monitor:localForwarding')}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {details && (
        <section className="inspection-detail">
          <strong>PID {details.pid}</strong>
          <p className="file-path">{details.value.executable}</p>
          {details.value.directory && (
            <Button
              size="sm"
              variant="light"
              onPress={() => onDirectory?.(details.value.directory)}
            >
              {translate('monitor:openDirectory2')}
              {details.value.directory}
            </Button>
          )}
          {details.value.service && (
            <Button size="sm" variant="light" onPress={() => onService(details.value.service)}>
              {translate('monitor:viewService')}
              {details.value.service}
            </Button>
          )}
          {details.value.errors?.map((message, index) => (
            <p key={index} className="error">
              {message}
            </p>
          ))}
        </section>
      )}
      {address && (
        <div className="button-row">
          <span className="file-path">{address}</span>
          <Button
            size="sm"
            variant="light"
            onPress={() => {
              navigator.clipboard.writeText(address).catch((e) => setError(e));
            }}
          >
            {translate('monitor:copyAddress')}
          </Button>
          {['http', 'https'].map((scheme) => (
            <Button
              key={scheme}
              size="sm"
              variant="light"
              onPress={() => {
                Browser.OpenURL(`${scheme}://${address}`).catch((e) => setError(e));
              }}
            >
              {scheme.toUpperCase()}
            </Button>
          ))}
        </div>
      )}
      <form
        className="inspection-toolbar"
        onSubmit={(event) => {
          event.preventDefault();
          setProbe('');
          const label = `${source === 'local' ? translate('monitor:localMachine') : translate('monitor:sSHDestination')} → ${host}:${port}`;
          void operate(ProbeNetworkTCP(workspace, source, host, port), (elapsed) =>
            setProbe(
              translate('monitor:tCPReachableMs', { value1: label, value2: elapsed.toFixed(1) }),
            ),
          );
        }}
      >
        <SelectControl
          aria-label={translate('monitor:tCPProbeSource')}
          disabled={busy}
          value={source}
          onChange={(event) => {
            setSource(event.target.value);
            setProbe('');
          }}
        >
          <option value="remote">{translate('monitor:probeFromSSHDestination')}</option>
          <option value="local">{translate('monitor:probeFromLocalMachineDirect')}</option>
        </SelectControl>
        <input
          aria-label={translate('monitor:probeHost')}
          required
          maxLength={255}
          value={host}
          disabled={busy}
          onChange={(event) => {
            setHost(event.target.value);
            setProbe('');
          }}
        />
        <input
          aria-label={translate('monitor:probePort')}
          type="number"
          min={1}
          max={65535}
          required
          value={port}
          disabled={busy}
          onChange={(event) => {
            setPort(Number(event.target.value));
            setProbe('');
          }}
        />
        <Button size="sm" type="submit" isLoading={busy} variant="light">
          {translate('monitor:tCPProbe')}
        </Button>
      </form>
      {probe && <p role="status">{probe}</p>}
    </>
  );
}
