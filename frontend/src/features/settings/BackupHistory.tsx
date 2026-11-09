import { t } from '../../i18n/index.ts';
import { useMessageState } from '../../i18n/useMessageState.ts';
import { useTranslation } from 'react-i18next';
import { errorMessage } from "../../lib/errors";
import { useEffect, useRef, useState } from 'react';
import { Button, Input } from '@heroui/react';
import { GetBackupDeviceAliases, GetSnapshotDetails, ListSavedSnapshots, SetBackupDeviceAlias } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { SnapshotDetails } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import type { RemoteSnapshot } from '../../../bindings/github.com/Sanjeever/termquay/internal/backup/models';
import SelectControl from '../../components/SelectControl';
import ErrorNotice from '../../components/ErrorNotice';
import SnapshotPruneDialog from './SnapshotPruneDialog';

export default function BackupHistory({ deviceID, deviceName, recoverySaved, revision, onRestore }: {
  deviceID: string; deviceName: string; recoverySaved: boolean; revision: string; onRestore(path: string): void;
}) {
  useTranslation();
  const [items, setItems] = useState<RemoteSnapshot[]>([]);
  const [aliases, setAliases] = useState<Record<string, string | undefined>>({});
  const [details, setDetails] = useState<Record<string, SnapshotDetails>>({});
  const cached = useRef<Record<string, SnapshotDetails>>({});
  const [detailErrors, setDetailErrors] = useMessageState({});
  const [error, setError] = useMessageState('');
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [scope, setScope] = useState('all');
  const [deviceLimit, setDeviceLimit] = useState(10);
  const [historyLimits, setHistoryLimits] = useState<Record<string, number>>({});
  const [aliasEdit, setAliasEdit] = useState<{ id: string; name: string }>();
  const [savingAlias, setSavingAlias] = useState(false);
  const [pruning,setPruning]=useState(false);

  useEffect(() => {
    let disposed = false;
    setLoading(true); setError(''); setDetailErrors({});
    const listing = ListSavedSnapshots();
    const names = GetBackupDeviceAliases();
    Promise.all([listing, names]).then(([items, names]) => {
      if (disposed) return;
      setItems(items || []); setAliases(names || {});
    }).catch(error => { if (!disposed) setError(error); }).finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; listing.cancel(); names.cancel(); };
  }, [revision, refresh]);

  const groups = new Map<string, RemoteSnapshot[]>();
  for (const item of items) {
    if ((scope === 'other' && item.device_id === deviceID) || (scope === 'local' && item.device_id !== deviceID)) continue;
    const snapshots = groups.get(item.device_id) || [];
    snapshots.push(item); groups.set(item.device_id, snapshots);
  }
  const visible = Array.from(groups.entries()).slice(0, deviceLimit);
  const latestPaths = visible.map(([, snapshots]) => snapshots[0].path).join('\n');
  useEffect(() => {
    if (!recoverySaved || loading) return;
    let disposed = false;
    let request: ReturnType<typeof GetSnapshotDetails> | undefined;
    async function readDetails() {
      for (const path of latestPaths.split('\n').filter(Boolean)) {
        if (cached.current[path]) continue;
        try {
          request = GetSnapshotDetails(path, '');
          const value = await request;
          if (disposed) return;
          cached.current[path] = value;
          setDetails(previous => ({ ...previous, [path]: value }));
        } catch (error) {
          if (disposed) return;
          setDetailErrors(previous => ({ ...previous, [path]: errorMessage(error) }));
        }
      }
    }
    void readDetails();
    return () => { disposed = true; request?.cancel(); };
  }, [latestPaths, loading, recoverySaved, revision, refresh]);

  async function saveAlias() {
    if (!aliasEdit || savingAlias) return;
    setSavingAlias(true); setError('');
    try {
      await SetBackupDeviceAlias(aliasEdit.id, aliasEdit.name);
      setAliases(previous => ({ ...previous, [aliasEdit.id]: aliasEdit.name.trim() })); setAliasEdit(undefined);
    } catch (error) { setError(error); }
    finally { setSavingAlias(false); }
  }
  return <section className="backup-section">
    <div className="backup-section-heading"><h3>{t('settings:deviceBackups')}</h3><div className="button-row"><SelectControl aria-label={t('settings:filterBackupDevices')} value={scope} onChange={event => setScope(event.target.value)}><option value="all">{t('settings:allDevices')}</option><option value="other">{t('settings:otherDevices')}</option><option value="local">{t('settings:thisDevice')}</option></SelectControl><Button size="sm" variant="light" onPress={()=>setPruning(true)}>{t('settings:pruneHistory')}</Button><Button size="sm" variant="light" isDisabled={loading} onPress={() => setRefresh(value => value + 1)}>{t('settings:refresh')}</Button></div></div>
    <ErrorNotice message={error}><button className="session-tool" onClick={()=>setRefresh(value=>value+1)}>{t('settings:reload')}</button></ErrorNotice>
    {loading ? <p className="muted" role="status">{t('settings:readingBackups')}</p> : !error && !groups.size && <p className="muted">{scope === 'other' ? t('settings:noBackupsFromOtherDevices') : t('settings:noBackups')}</p>}
    {!loading && <ul className="backup-devices">{visible.map(([id, snapshots]) => {
      const latest = snapshots[0];
      const detail = details[latest.path];
      const name = aliases[id] || detail?.device_name || (id === deviceID ? deviceName : t('settings:device', { value1: id.slice(0, 8) }));
      const historyLimit = historyLimits[id] || 10;
      return <li key={id} className="backup-device">
        <div className="backup-device-row"><div className="backup-device-info"><div><strong>{name}</strong>{id === deviceID && <span className="muted">{t('settings:thisDevice')}</span>}</div><time dateTime={detail?.created_at || latest.modified}>{new Date(detail?.created_at || latest.modified).toLocaleString()}</time>
          {detail ? <span className="muted">{detail.connections} {t('settings:connections')}{detail.credentials_included === false ? t('settings:noCredentialsIncluded') : t('settings:credentials', { value1: detail.credentials })}{detail.credentials_included == null ? t('settings:credentialScopeUnknown') : ''}</span> : <span className="muted">{detailErrors[latest.path] ? t('settings:couldNotReadSummaryIndividualRecoveryIsAvailable') : recoverySaved ? t('settings:unlockingSummary') : t('settings:enterTheBackupPasswordWhenRestoring')}</span>}
        </div><div className="button-row"><Button size="sm" variant="light" aria-label={t('settings:labelDevice', { value1: name })} onPress={() => setAliasEdit({ id, name: aliases[id] || '' })}>{t('settings:label')}</Button><Button size="sm" variant="bordered" onPress={() => onRestore(latest.path)}>{t('settings:restore')}</Button></div></div>
        {detailErrors[latest.path] && <details className="backup-details-error"><summary>{t('settings:couldNotReadSummary')}</summary><p role="alert" className="error">{detailErrors[latest.path]}</p></details>}
        {aliasEdit?.id === id && <form className="backup-alias-form" onSubmit={event => { event.preventDefault(); void saveAlias(); }}><Input aria-label={t('settings:deviceLabel')} placeholder={t('settings:localDeviceLabel')} size="sm" maxLength={100} value={aliasEdit.name} onValueChange={name => setAliasEdit({ id, name })} isDisabled={savingAlias} autoFocus/><Button size="sm" type="submit" isLoading={savingAlias}>{t('settings:save')}</Button><Button size="sm" variant="light" isDisabled={savingAlias} onPress={() => setAliasEdit(undefined)}>{t('settings:cancel')}</Button></form>}
        <details className="backup-history"><summary>{t('settings:history')}{snapshots.length} {t('settings:copies')}</summary><ul className="snapshot-list">{snapshots.slice(0, historyLimit).map(snapshot => <li key={snapshot.path}><div><time dateTime={snapshot.modified}>{new Date(snapshot.modified).toLocaleString()}</time><span>{Math.ceil(snapshot.size / 1024)} KiB</span></div><Button size="sm" variant="light" onPress={() => onRestore(snapshot.path)}>{t('settings:restore')}</Button></li>)}</ul>{snapshots.length > historyLimit && <Button size="sm" variant="light" onPress={() => setHistoryLimits(previous => ({ ...previous, [id]: historyLimit + 20 }))}>{t('settings:moreHistory')}</Button>}</details>
      </li>;
    })}</ul>}
    {groups.size > deviceLimit && <Button size="sm" variant="light" onPress={() => setDeviceLimit(value => value + 10)}>{t('settings:moreDevices')}</Button>}
    {pruning&&<SnapshotPruneDialog deviceID={deviceID} names={{...aliases,[deviceID]:deviceName}} onClose={()=>setPruning(false)} onChanged={()=>setRefresh(value=>value+1)}/>}
  </section>;
}
