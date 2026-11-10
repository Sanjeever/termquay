import Modal from '../../components/Modal';
import { t as translate } from '../../i18n/index.ts';
import { useMessageState } from '../../i18n/useMessageState.ts';
import { useTranslation } from 'react-i18next';

import SelectControl from '../../components/SelectControl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@heroui/react';
import {
  PreviewDirectorySyncFiltered,
  CancelDirectorySyncPreview,
  ExecuteDirectorySync,
  GetSyncPresets,
  SaveSyncPreset,
  DeleteSyncPreset,
} from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type {
  DirectorySyncPreview,
  SyncPreset,
} from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import { CompareDirectorySyncFile } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';

const states: Record<string, string> = {
  get new() {
    return translate('files:new');
  },
  get update() {
    return translate('files:updated');
  },
  get same() {
    return translate('files:unchanged');
  },
  get conflict() {
    return translate('files:conflictUnsupported');
  },
};
export default function DirectorySyncDialog({
  id,
  remote,
  connectionID,
  onClose,
}: {
  id: string;
  remote: string;
  connectionID: string;
  onClose(): void;
}) {
  useTranslation();
  const [direction, setDirection] = useState('upload');
  const [preview, setPreview] = useState<DirectorySyncPreview>();
  const [selected, setSelected] = useState(new Set<string>());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useMessageState('');
  const [page, setPage] = useState(0);
  const [local, setLocal] = useState('');
  const [compareBusy, setCompareBusy] = useState('');
  const [compared, setCompared] = useState<Record<string, boolean>>({});
  const comparePending = useRef<ReturnType<typeof CompareDirectorySyncFile>>();
  useEffect(() => {
    setCompared({});
  }, [preview?.id]);
  const [remotePath, setRemotePath] = useState(remote);
  const [exclude, setExclude] = useState('');
  const [presetName, setPresetName] = useState('');
  const [presets, setPresets] = useState<SyncPreset[]>([]);
  const exclusions = () =>
    exclude
      .split('\n')
      .map((value) => value.trim())
      .filter(Boolean);
  useEffect(() => {
    if (connectionID)
      GetSyncPresets(connectionID)
        .then((values) => setPresets(values || []))
        .catch((e) => setError(e));
  }, [connectionID, setError]);
  const pending = useRef<ReturnType<typeof PreviewDirectorySyncFiltered>>();
  const disposed = useRef(false);
  const latest = useRef(preview);
  latest.current = preview;
  async function compareFile(path: string) {
    if (!preview || compareBusy) return;
    setCompareBusy(path);
    const request = CompareDirectorySyncFile(preview.id, path);
    comparePending.current = request;
    try {
      const result = await request;
      if (disposed.current || comparePending.current !== request) return;
      setCompared((previous) => ({ ...previous, [path]: result.equal }));
      setPreview((previous) =>
        previous
          ? {
              ...previous,
              entries: (previous.entries || []).map((entry) =>
                entry.path === path ? { ...entry, state: result.state } : entry,
              ),
            }
          : previous,
      );
    } catch (error) {
      if (!disposed.current && comparePending.current === request) setError(error);
    } finally {
      if (comparePending.current === request) {
        comparePending.current = undefined;
        setCompareBusy('');
      }
    }
  }
  useEffect(
    () => () => {
      disposed.current = true;
      pending.current?.cancel();
      comparePending.current?.cancel();
      if (latest.current) void CancelDirectorySyncPreview(latest.current.id);
    },
    [],
  );
  const allowed = useMemo(() => {
    const blocked = new Set<string>();
    const changes = new Set<string>();
    for (const e of preview?.entries || []) {
      const parents = e.path.split('/');
      parents.pop();
      while (parents.length) {
        const parent = parents.join('/');
        if (e.state === 'conflict') blocked.add(parent);
        if (e.state === 'new' || e.state === 'update') changes.add(parent);
        parents.pop();
      }
    }
    return new Set(
      (preview?.entries || [])
        .filter(
          (e) =>
            e.state !== 'conflict' &&
            (!e.directory || !blocked.has(e.path)) &&
            (e.state === 'new' || e.state === 'update' || (e.directory && changes.has(e.path))),
        )
        .map((e) => e.path),
    );
  }, [preview]);
  function invalidate() {
    comparePending.current?.cancel();
    comparePending.current = undefined;
    setCompareBusy('');
    if (preview) CancelDirectorySyncPreview(preview.id).catch((e) => setError(e));
    setPreview(undefined);
    setSelected(new Set());
    setCompared({});
  }
  async function scan() {
    setBusy(true);
    setError('');
    try {
      if (preview) await CancelDirectorySyncPreview(preview.id);
      setPreview(undefined);
      setSelected(new Set());
      setPage(0);
      const request = PreviewDirectorySyncFiltered(
        id,
        direction,
        local.trim(),
        remotePath,
        exclusions(),
      );
      pending.current = request;
      const value = await request;
      if (!disposed.current && value.id) {
        setPreview(value);
        setLocal(value.local);
      }
    } catch (e) {
      if (!disposed.current) setError(e);
    } finally {
      pending.current = undefined;
      if (!disposed.current) setBusy(false);
    }
  }
  return (
    <Modal
      isOpen
      onClose={() => {
        pending.current?.cancel();
        onClose();
      }}
      className="app-dialog directory-sync-dialog"
      scrollBehavior="inside"
    >
      <ModalContent>
        <ModalHeader>{translate('files:directorySync')}</ModalHeader>
        <ModalBody>
          <label className="form-field">
            {translate('files:direction')}
            <SelectControl
              value={direction}
              onChange={(e) => {
                setDirection(e.target.value);
                invalidate();
              }}
              disabled={busy}
            >
              <option value="upload">{translate('files:localRemote')}</option>
              <option value="download">{translate('files:remoteLocal')}</option>
            </SelectControl>
          </label>
          <label className="form-field">
            {translate('files:localDirectory')}
            <input
              aria-label={translate('files:localSyncDirectory')}
              value={local}
              onChange={(e) => {
                setLocal(e.target.value);
                invalidate();
              }}
              disabled={busy}
            />
          </label>
          <label className="form-field">
            {translate('files:remoteDirectory')}
            <input
              aria-label={translate('files:remoteSyncDirectory')}
              value={remotePath}
              onChange={(e) => {
                setRemotePath(e.target.value);
                invalidate();
              }}
              disabled={busy}
            />
          </label>
          <details>
            <summary>{translate('files:exclusionRulesAndPresets')}</summary>
            <div className="connection-options-fields">
              <label className="form-field">
                {translate('files:exclusionRules')}
                <textarea
                  aria-label={translate('files:syncExclusionRulesOnePerLine')}
                  rows={3}
                  placeholder={'.git\nnode_modules\n*.log'}
                  value={exclude}
                  onChange={(e) => {
                    setExclude(e.target.value);
                    invalidate();
                  }}
                  disabled={busy}
                />
              </label>
              {!!presets.length && (
                <label className="form-field">
                  {translate('files:savedPresets')}
                  <SelectControl
                    aria-label={translate('files:syncPreset')}
                    value=""
                    disabled={busy}
                    onChange={(e) => {
                      const preset = presets.find((p) => p.name === e.target.value);
                      if (preset) {
                        invalidate();
                        setPresetName(preset.name);
                        setLocal(preset.local);
                        setRemotePath(preset.remote);
                        setDirection(preset.direction);
                        setExclude((preset.exclude || []).join('\n'));
                      }
                    }}
                  >
                    <option value="">{translate('files:selectPreset')}</option>
                    {presets.map((p) => (
                      <option key={p.name}>{p.name}</option>
                    ))}
                  </SelectControl>
                </label>
              )}
              {connectionID && (
                <>
                  <label className="form-field">
                    {translate('files:presetName')}
                    <input
                      aria-label={translate('files:syncPresetName')}
                      value={presetName}
                      maxLength={128}
                      disabled={busy}
                      onChange={(e) => setPresetName(e.target.value)}
                    />
                  </label>
                  <div className="button-row">
                    <Button
                      size="sm"
                      variant="light"
                      isDisabled={busy || !presetName.trim() || !local}
                      onPress={async () => {
                        setBusy(true);
                        try {
                          await SaveSyncPreset({
                            name: presetName,
                            connection_id: connectionID,
                            local,
                            remote: remotePath,
                            direction,
                            exclude: exclusions(),
                          });
                          setPresets((await GetSyncPresets(connectionID)) || []);
                          setError('');
                        } catch (e) {
                          setError(e);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      {translate('files:savePreset')}
                    </Button>
                    <Button
                      size="sm"
                      variant="light"
                      isDisabled={busy || !presets.some((p) => p.name === presetName)}
                      onPress={async () => {
                        setBusy(true);
                        try {
                          await DeleteSyncPreset(connectionID, presetName);
                          setPresets((await GetSyncPresets(connectionID)) || []);
                          setPresetName('');
                        } catch (e) {
                          setError(e);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      {translate('files:deletePreset')}
                    </Button>
                  </div>
                </>
              )}
            </div>
          </details>
          <Button size="sm" variant="bordered" isDisabled={busy} onPress={() => void scan()}>
            {preview
              ? translate('files:previewAgain')
              : local.trim()
                ? translate('files:previewDifferences')
                : translate('files:selectLocalDirectoryAndPreview')}
          </Button>
          {busy && <p role="status">{translate('files:scanning')}</p>}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {preview && (
            <>
              <div className="button-row">
                <Button size="sm" variant="light" onPress={() => setSelected(new Set(allowed))}>
                  {translate('files:selectAllSyncableItems')}
                </Button>
                <Button size="sm" variant="light" onPress={() => setSelected(new Set())}>
                  {translate('files:clearSelection')}
                </Button>
                <span className="muted">
                  {selected.size} / {preview.entries?.length || 0}
                </span>
              </div>
              <table className="sync-preview">
                <thead>
                  <tr>
                    <th>{translate('files:select')}</th>
                    <th>{translate('files:path')}</th>
                    <th>{translate('files:difference')}</th>
                    <th>{translate('files:bytes')}</th>
                    <th>{translate('files:contents')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(preview.entries || []).slice(page * 100, (page + 1) * 100).map((e) => (
                    <tr key={e.path}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={translate('files:sync', { value1: e.path })}
                          disabled={!allowed.has(e.path)}
                          checked={selected.has(e.path)}
                          onChange={(event) =>
                            setSelected((prev) => {
                              const next = new Set(prev);
                              if (event.target.checked) next.add(e.path);
                              else next.delete(e.path);
                              return next;
                            })
                          }
                        />
                      </td>
                      <td className="file-path">
                        {e.path}
                        {e.directory ? '/' : ''}
                      </td>
                      <td>{states[e.state]}</td>
                      <td>{e.directory ? '' : e.size}</td>
                      <td>
                        {!e.directory && ['same', 'update'].includes(e.state) && (
                          <button
                            className="session-tool"
                            disabled={busy || !!compareBusy}
                            onClick={() => void compareFile(e.path)}
                          >
                            {compareBusy === e.path
                              ? translate('files:comparing')
                              : compared[e.path] === undefined
                                ? translate('files:compareContents')
                                : compared[e.path]
                                  ? translate('files:identicalContents')
                                  : translate('files:differentContents')}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(preview.entries?.length || 0) > 100 && (
                <div className="button-row">
                  <Button size="sm" isDisabled={page === 0} onPress={() => setPage((p) => p - 1)}>
                    {translate('files:previousPage')}
                  </Button>
                  <span>
                    {page + 1} / {Math.ceil((preview.entries?.length || 0) / 100)}
                  </span>
                  <Button
                    size="sm"
                    isDisabled={(page + 1) * 100 >= (preview.entries?.length || 0)}
                    onPress={() => setPage((p) => p + 1)}
                  >
                    {translate('files:nextPage')}
                  </Button>
                </div>
              )}
            </>
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
            {translate('files:cancel')}
          </Button>
          <Button
            color="primary"
            isDisabled={!preview || !selected.size || busy || !!compareBusy}
            onPress={async () => {
              if (!preview) return;
              setBusy(true);
              try {
                await ExecuteDirectorySync(preview.id, [...selected]);
                onClose();
              } catch (e) {
                setError(e);
              } finally {
                if (!disposed.current) setBusy(false);
              }
            }}
          >
            {translate('files:applySelectedDifferences')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
