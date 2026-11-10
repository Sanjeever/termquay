import Modal from '../../components/Modal';
import { eventError, errorMessage } from '../../lib/errors.ts';
import { t as translate, currentLocale } from '../../i18n/index.ts';
import { useMessageState } from '../../i18n/useMessageState.ts';
import { useTranslation } from 'react-i18next';
import { useEffect, useRef, useState } from 'react';
import { Button, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react';
import {
  CaptureDiagnosticSnapshot,
  ListDiagnosticSnapshots,
  ReadDiagnosticSnapshot,
  SaveDiagnosticSnapshot,
  DeleteDiagnosticSnapshot,
  ExportDiagnosticSnapshot,
} from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type {
  DiagnosticCaptureOptions,
  DiagnosticSection,
  DiagnosticSnapshot,
  DiagnosticSnapshotInfo,
} from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import SelectControl from '../../components/SelectControl';

import ReadonlyDiffView from '../files/ReadonlyDiffView';

const initialOptions: DiagnosticCaptureOptions = {
  system: true,
  file_systems: true,
  processes: false,
  ports: true,
  containers: false,
  docker_socket: '/var/run/docker.sock',
  services: [],
  service_logs: false,
  logs: [],
};
const lines = (value: string) =>
  value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
type Snapshot = Omit<DiagnosticSnapshot, 'sections'> & { sections: DiagnosticSection[] };
export default function DiagnosticSnapshotsDialog({
  targets,
  initial,
  onClose,
}: {
  targets: { id: string; name: string }[];
  initial?: string;
  onClose(): void;
}) {
  useTranslation();
  const [workspace, setWorkspace] = useState(initial || targets[0]?.id || '');
  const [options, setOptions] = useState(initialOptions);
  const [services, setServices] = useState('');
  const [logs, setLogs] = useState('');
  const [items, setItems] = useState<DiagnosticSnapshotInfo[]>([]);
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [baseline, setBaseline] = useState<Snapshot>();
  const [baselineID, setBaselineID] = useState('');
  const [section, setSection] = useState('');
  const [expanded, setExpanded] = useState(-1);
  const [selected, setSelected] = useState(new Set<number>());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useMessageState('');
  const [saved, setSaved] = useState('');
  const [deleting, setDeleting] = useState(false);
  const pending = useRef<{ cancel(): void }>();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    void refresh().catch((e) => {
      if (mounted.current) setError(e);
    });
    return () => {
      mounted.current = false;
      pending.current?.cancel();
    };
  }, []);
  async function refresh() {
    const value = await ListDiagnosticSnapshots();
    if (mounted.current) setItems(value || []);
  }
  async function operation<T>(request: Promise<T> & { cancel(): void }, apply: (value: T) => void) {
    setBusy(true);
    setError('');
    pending.current = request;
    try {
      const value = await request;
      if (mounted.current) apply(value);
    } catch (e) {
      if (mounted.current) setError(e);
    } finally {
      if (pending.current === request) pending.current = undefined;
      if (mounted.current) setBusy(false);
    }
  }
  function show(value: DiagnosticSnapshot, isSaved: boolean) {
    setSnapshot({ ...value, sections: value.sections || [] });
    setSelected(new Set((value.sections || []).map((_, index) => index)));
    setExpanded(-1);
    setSection('');
    setSaved(isSaved ? JSON.stringify([value.info.id, value.info.name]) : '');
    if (value.info.id === baselineID) {
      setBaseline(undefined);
      setBaselineID('');
    }
  }
  function capture() {
    void operation(
      CaptureDiagnosticSnapshot(workspace, {
        ...options,
        services: lines(services),
        logs: lines(logs),
      }),
      (value) => {
        if (snapshot) {
          setBaseline(snapshot);
          setBaselineID(snapshot.info.id);
        }
        show(
          {
            ...value,
            info: {
              ...value.info,
              name: `${(targets.find((target) => target.id === workspace)?.name || translate('monitor:host')).slice(0, 24)} · ${new Date(value.info.time).toLocaleString(currentLocale())}`,
            },
          },
          false,
        );
      },
    );
  }
  useEffect(() => {
    if (!baselineID || baselineID === baseline?.info.id) return;
    let ended = false;
    const request = ReadDiagnosticSnapshot(baselineID);
    request
      .then((value) => {
        if (!ended) {
          setBaseline({ ...value, sections: value.sections || [] });
          setSection('');
        }
      })
      .catch((e) => {
        if (!ended) {
          setError(e);
          setBaseline(undefined);
        }
      });
    return () => {
      ended = true;
      request.cancel();
    };
  }, [baselineID]);
  const sectionName = (item: DiagnosticSection) =>
    (
      {
        system: translate('monitor:systemAndResources'),
        filesystems: translate('monitor:filesystems'),
        processes: translate('monitor:processes2'),
        ports: translate('monitor:listeningPorts'),
        containers: translate('monitor:dockerContainers'),
      } as Record<string, string>
    )[item.kind] || item.name;
  const key = (item: DiagnosticSection) => `${item.kind}:${item.name}`;
  const before = new Map((baseline?.sections || []).map((item) => [key(item), item]));
  const after = new Map((snapshot?.sections || []).map((item) => [key(item), item]));
  const keys = [...new Set([...before.keys(), ...after.keys()])];
  const oldSection = before.get(section),
    newSection = after.get(section);
  const snapshotSignature = snapshot ? JSON.stringify([snapshot.info.id, snapshot.info.name]) : '';
  const same = (name: string) => {
    const left = before.get(name),
      right = after.get(name);
    return (
      !!left &&
      !!right &&
      left.content === right.content &&
      left.error === right.error &&
      left.truncated === right.truncated
    );
  };
  return (
    <Modal
      isOpen
      size="5xl"
      className="app-dialog"
      scrollBehavior="inside"
      isDismissable={!busy}
      onClose={() => {
        pending.current?.cancel();
        onClose();
      }}
    >
      <ModalContent>
        <ModalHeader>{translate('monitor:diagnosticSnapshots')}</ModalHeader>
        <ModalBody>
          <div className="file-compare-sides">
            <label className="form-field">
              {translate('monitor:collectionHost')}
              <SelectControl
                value={workspace}
                disabled={busy}
                onChange={(event) => setWorkspace(event.target.value)}
              >
                <option value="">{translate('monitor:selectAConnectedSSHWorkspace')}</option>
                {targets.map((target) => (
                  <option key={target.id} value={target.id}>
                    {target.name}
                  </option>
                ))}
              </SelectControl>
            </label>
            <label className="form-field">
              {translate('monitor:savedSnapshots')}
              <SelectControl
                value={saved && snapshot ? snapshot.info.id : ''}
                disabled={busy}
                onChange={(event) => {
                  if (event.target.value)
                    void operation(ReadDiagnosticSnapshot(event.target.value), (value) =>
                      show(value, true),
                    );
                }}
              >
                <option value="">{translate('monitor:selectLocalSnapshot')}</option>
                {[...items].reverse().map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {new Date(item.time).toLocaleString(currentLocale())}
                  </option>
                ))}
              </SelectControl>
            </label>
          </div>
          <details open={!snapshot}>
            <summary>{translate('monitor:collectionContents')}</summary>
            <div className="button-row">
              {(
                [
                  ['system', translate('monitor:systemAndResources')],
                  ['file_systems', translate('monitor:filesystems')],
                  ['processes', translate('monitor:processArguments')],
                  ['ports', translate('monitor:listeningPorts')],
                  ['containers', translate('monitor:dockerContainers')],
                ] as const
              ).map(([name, label]) => (
                <label key={name} className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={options[name]}
                    disabled={busy}
                    onChange={(event) => setOptions({ ...options, [name]: event.target.checked })}
                  />
                  {label}
                </label>
              ))}
            </div>
            {options.containers && (
              <label className="form-field">
                Docker socket
                <input
                  value={options.docker_socket}
                  disabled={busy}
                  maxLength={4096}
                  onChange={(event) =>
                    setOptions({ ...options, docker_socket: event.target.value })
                  }
                />
              </label>
            )}
            <div className="file-compare-sides">
              <label className="form-field">
                {translate('monitor:serviceNamesOnePerLineUpTo8')}
                <textarea
                  rows={3}
                  value={services}
                  maxLength={2048}
                  disabled={busy}
                  onChange={(event) => setServices(event.target.value)}
                />
              </label>
              <label className="form-field">
                {translate('monitor:absoluteLogPathsOnePerLineUpTo')}
                <textarea
                  rows={3}
                  value={logs}
                  maxLength={32768}
                  disabled={busy}
                  onChange={(event) => setLogs(event.target.value)}
                />
              </label>
            </div>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={options.service_logs}
                disabled={busy}
                onChange={(event) => setOptions({ ...options, service_logs: event.target.checked })}
              />
              {translate('monitor:includeRecentLogsForSelectedServices')}
            </label>
            <Button
              size="sm"
              isLoading={busy}
              isDisabled={busy || !targets.some((target) => target.id === workspace)}
              onPress={capture}
            >
              {translate('monitor:collectSnapshot')}
            </Button>
          </details>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {snapshot && (
            <>
              <label className="form-field">
                {translate('monitor:snapshotName')}
                <input
                  value={snapshot.info.name}
                  maxLength={128}
                  disabled={busy}
                  onChange={(event) =>
                    setSnapshot({
                      ...snapshot,
                      info: { ...snapshot.info, name: event.target.value },
                    })
                  }
                />
              </label>
              <p className="file-path">
                {snapshot.info.target} ·{' '}
                {new Date(snapshot.info.time).toLocaleString(currentLocale())}
              </p>
              <p className="muted">
                {translate('monitor:reviewEachItemBeforeSelectingExportContentsLogs')}
              </p>
              {snapshot.sections.map((item, index) => (
                <section className="inspection-detail" key={`${key(item)}:${index}`}>
                  <div className="button-row">
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={selected.has(index)}
                        disabled={busy}
                        onChange={(event) =>
                          setSelected((previous) => {
                            const next = new Set(previous);
                            if (event.target.checked) next.add(index);
                            else next.delete(index);
                            return next;
                          })
                        }
                      />
                      {sectionName(item)}
                    </label>
                    <span
                      className={
                        errorMessage(eventError(item)) || item.truncated ? 'error' : 'muted'
                      }
                    >
                      {errorMessage(eventError(item))
                        ? translate('monitor:collectionFailedOrIncomplete')
                        : item.truncated
                          ? translate('monitor:partialTruncated')
                          : translate('monitor:collected')}{' '}
                      · {new Date(item.time).toLocaleTimeString(currentLocale())}
                    </span>
                    <button
                      className="session-tool"
                      aria-expanded={expanded === index}
                      onClick={() => setExpanded(expanded === index ? -1 : index)}
                    >
                      {translate('monitor:viewContents')}
                    </button>
                  </div>
                  {expanded === index && (
                    <>
                      {errorMessage(eventError(item)) && (
                        <p className="error">{errorMessage(eventError(item))}</p>
                      )}
                      <pre className="diagnostic-content">{item.content}</pre>
                    </>
                  )}
                </section>
              ))}
              <div className="button-row">
                <Button
                  size="sm"
                  variant="light"
                  isDisabled={busy || !snapshot.info.name.trim() || saved === snapshotSignature}
                  onPress={() =>
                    void operation(SaveDiagnosticSnapshot(snapshot), () => {
                      setSaved(snapshotSignature);
                      void refresh().catch((e) => setError(e));
                    })
                  }
                >
                  {saved === snapshotSignature
                    ? translate('monitor:savedEncrypted')
                    : translate('monitor:saveEncryptedSnapshot')}
                </Button>
                <Button
                  size="sm"
                  variant="light"
                  isDisabled={busy || !selected.size}
                  onPress={() =>
                    void operation(ExportDiagnosticSnapshot(snapshot, [...selected]), () => {})
                  }
                >
                  {translate('monitor:exportSelectedItems')}
                </Button>
                {items.some((item) => item.id === snapshot.info.id) && (
                  <Button
                    size="sm"
                    variant="light"
                    color="danger"
                    isDisabled={busy}
                    onPress={() => setDeleting(true)}
                  >
                    {translate('monitor:removeSavedSnapshot')}
                  </Button>
                )}
              </div>
              <label className="form-field">
                {translate('monitor:compareWithAnotherSnapshot')}
                <SelectControl
                  value={baselineID}
                  disabled={busy}
                  onChange={(event) => {
                    setBaselineID(event.target.value);
                    if (!event.target.value) setBaseline(undefined);
                  }}
                >
                  <option value="">{translate('monitor:selectComparisonSnapshot')}</option>
                  {baseline && !items.some((item) => item.id === baseline.info.id) && (
                    <option value={baseline.info.id}>
                      {baseline.info.name} {translate('monitor:currentRun')}
                    </option>
                  )}
                  {items
                    .filter((item) => item.id !== snapshot.info.id)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} · {item.target}
                      </option>
                    ))}
                </SelectControl>
              </label>
              {baseline && (
                <>
                  <p className="file-path">
                    {translate('monitor:previous')}
                    {baseline.info.target} ·{' '}
                    {new Date(baseline.info.time).toLocaleString(currentLocale())}
                  </p>
                  {baseline.info.identity !== snapshot.info.identity && (
                    <p className="muted">
                      {translate('monitor:theSnapshotsHaveDifferentSourceIdentities')}
                    </p>
                  )}
                  <SelectControl
                    aria-label={translate('monitor:selectSnapshotComparisonItem')}
                    value={section}
                    onChange={(event) => setSection(event.target.value)}
                  >
                    <option value="">
                      {translate('monitor:selectItem')}
                      {keys.filter((name) => !same(name)).length} {translate('monitor:changes')}
                    </option>
                    {keys.map((name) => (
                      <option key={name} value={name}>
                        {sectionName((after.get(name) || before.get(name))!)} ·{' '}
                        {same(name)
                          ? translate('monitor:unchanged')
                          : translate('monitor:changedOrMissing')}
                      </option>
                    ))}
                  </SelectControl>
                  {section && (
                    <ReadonlyDiffView
                      left={
                        oldSection
                          ? [
                              errorMessage(eventError(oldSection)),
                              oldSection.truncated ? translate('monitor:partialTruncated') : '',
                              oldSection.content,
                            ]
                              .filter(Boolean)
                              .join('\n')
                          : undefined
                      }
                      right={
                        newSection
                          ? [
                              errorMessage(eventError(newSection)),
                              newSection.truncated ? translate('monitor:partialTruncated') : '',
                              newSection.content,
                            ]
                              .filter(Boolean)
                              .join('\n')
                          : undefined
                      }
                      leftLabel={translate('monitor:previousSnapshot')}
                      rightLabel={translate('monitor:currentSnapshot')}
                    />
                  )}
                </>
              )}
            </>
          )}
          {deleting && snapshot && (
            <section className="inspection-detail">
              <p>
                {translate('monitor:removeLocalEncryptedSnapshot')}
                {snapshot.info.name}”？
              </p>
              <div className="button-row">
                <Button size="sm" variant="light" onPress={() => setDeleting(false)}>
                  {translate('monitor:cancel')}
                </Button>
                <Button
                  size="sm"
                  color="danger"
                  isDisabled={busy}
                  onPress={() =>
                    void operation(DeleteDiagnosticSnapshot(snapshot.info.id), () => {
                      setItems((previous) =>
                        previous.filter((item) => item.id !== snapshot.info.id),
                      );
                      setSaved('');
                      setDeleting(false);
                    })
                  }
                >
                  {translate('monitor:remove')}
                </Button>
              </div>
            </section>
          )}
        </ModalBody>
        <ModalFooter>
          <Button
            variant="light"
            onPress={() => {
              pending.current?.cancel();
              onClose();
            }}
          >
            {busy ? translate('monitor:cancelAndClose') : translate('monitor:close')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
