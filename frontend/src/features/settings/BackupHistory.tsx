import { errorMessage } from "../../lib/errors";
import { useEffect, useRef, useState } from 'react';
import { Button, Input } from '@heroui/react';
import { GetBackupDeviceAliases, GetSnapshotDetails, ListSavedSnapshots, SetBackupDeviceAlias } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { SnapshotDetails } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import type { RemoteSnapshot } from '../../../bindings/github.com/Sanjeever/termquay/internal/backup/models';
import SelectControl from '../../components/SelectControl';
import ErrorNotice from '../../components/ErrorNotice';

export default function BackupHistory({ deviceID, deviceName, recoverySaved, revision, onRestore }: {
  deviceID: string; deviceName: string; recoverySaved: boolean; revision: string; onRestore(path: string): void;
}) {
  const [items, setItems] = useState<RemoteSnapshot[]>([]);
  const [aliases, setAliases] = useState<Record<string, string | undefined>>({});
  const [details, setDetails] = useState<Record<string, SnapshotDetails>>({});
  const cached = useRef<Record<string, SnapshotDetails>>({});
  const [detailErrors, setDetailErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [scope, setScope] = useState('all');
  const [deviceLimit, setDeviceLimit] = useState(10);
  const [historyLimits, setHistoryLimits] = useState<Record<string, number>>({});
  const [aliasEdit, setAliasEdit] = useState<{ id: string; name: string }>();
  const [savingAlias, setSavingAlias] = useState(false);

  useEffect(() => {
    let disposed = false;
    setLoading(true); setError(''); setDetailErrors({});
    const listing = ListSavedSnapshots();
    const names = GetBackupDeviceAliases();
    Promise.all([listing, names]).then(([items, names]) => {
      if (disposed) return;
      setItems(items || []); setAliases(names || {});
    }).catch(error => { if (!disposed) setError(errorMessage(error)); }).finally(() => { if (!disposed) setLoading(false); });
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
    } catch (error) { setError(errorMessage(error)); }
    finally { setSavingAlias(false); }
  }
  return <section className="backup-section">
    <div className="backup-section-heading"><h3>设备备份</h3><div className="button-row"><SelectControl aria-label="筛选备份设备" value={scope} onChange={event => setScope(event.target.value)}><option value="all">所有设备</option><option value="other">其他设备</option><option value="local">本机</option></SelectControl><Button size="sm" variant="light" isDisabled={loading} onPress={() => setRefresh(value => value + 1)}>刷新</Button></div></div>
    <ErrorNotice message={error}><button className="session-tool" onClick={()=>setRefresh(value=>value+1)}>重新读取</button></ErrorNotice>
    {loading ? <p className="muted" role="status">正在读取备份…</p> : !error && !groups.size && <p className="muted">{scope === 'other' ? '暂无其他设备的备份' : '暂无备份'}</p>}
    {!loading && <ul className="backup-devices">{visible.map(([id, snapshots]) => {
      const latest = snapshots[0];
      const detail = details[latest.path];
      const name = aliases[id] || detail?.device_name || (id === deviceID ? deviceName : `设备 ${id.slice(0, 8)}`);
      const historyLimit = historyLimits[id] || 10;
      return <li key={id} className="backup-device">
        <div className="backup-device-row"><div className="backup-device-info"><div><strong>{name}</strong>{id === deviceID && <span className="muted">本机</span>}</div><time dateTime={detail?.created_at || latest.modified}>{new Date(detail?.created_at || latest.modified).toLocaleString()}</time>
          {detail ? <span className="muted">{detail.connections} 个连接 · {detail.credentials_included === false ? '未携带凭据' : `${detail.credentials} 项凭据`}{detail.credentials_included == null ? ' · 携带范围未知' : ''}</span> : <span className="muted">{detailErrors[latest.path] ? '摘要读取失败，可单独恢复' : recoverySaved ? '正在解锁摘要…' : '恢复时输入备份密码'}</span>}
        </div><div className="button-row"><Button size="sm" variant="light" aria-label={`备注设备 ${name}`} onPress={() => setAliasEdit({ id, name: aliases[id] || '' })}>备注</Button><Button size="sm" variant="bordered" onPress={() => onRestore(latest.path)}>恢复</Button></div></div>
        {detailErrors[latest.path] && <details className="backup-details-error"><summary>摘要读取失败</summary><p role="alert" className="error">{detailErrors[latest.path]}</p></details>}
        {aliasEdit?.id === id && <form className="backup-alias-form" onSubmit={event => { event.preventDefault(); void saveAlias(); }}><Input aria-label="设备备注" placeholder="本机备注名称" size="sm" maxLength={100} value={aliasEdit.name} onValueChange={name => setAliasEdit({ id, name })} isDisabled={savingAlias} autoFocus/><Button size="sm" type="submit" isLoading={savingAlias}>保存</Button><Button size="sm" variant="light" isDisabled={savingAlias} onPress={() => setAliasEdit(undefined)}>取消</Button></form>}
        <details className="backup-history"><summary>历史记录 · {snapshots.length} 份</summary><ul className="snapshot-list">{snapshots.slice(0, historyLimit).map(snapshot => <li key={snapshot.path}><div><time dateTime={snapshot.modified}>{new Date(snapshot.modified).toLocaleString()}</time><span>{Math.ceil(snapshot.size / 1024)} KiB</span></div><Button size="sm" variant="light" onPress={() => onRestore(snapshot.path)}>恢复</Button></li>)}</ul>{snapshots.length > historyLimit && <Button size="sm" variant="light" onPress={() => setHistoryLimits(previous => ({ ...previous, [id]: historyLimit + 20 }))}>更多历史记录</Button>}</details>
      </li>;
    })}</ul>}
    {groups.size > deviceLimit && <Button size="sm" variant="light" onPress={() => setDeviceLimit(value => value + 10)}>更多设备</Button>}
  </section>;
}
