import { useEffect, useState } from 'react';
import { Button, Input } from '@heroui/react';
import { BackupWebDAVWithSelection, ConfirmRestoreSelection, ExportLocalSnapshot, PreviewLocalRestore, SavePortableUI, GetPortableUI, GetCatalog, ListSnapshots, PreviewRestore, TestWebDAV } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { RemoteSnapshot, WebDAVOptions } from '../../../bindings/github.com/Sanjeever/termquay/internal/backup/models';
import type { BackupSelection, RestorePreview } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import type { Connection } from '../../../bindings/github.com/Sanjeever/termquay/internal/store/models';
import { applyPortableUI, capturePortableUI } from './portable';
import { EnableAutomaticBackup, DisableAutomaticBackup } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type useAutomaticBackup from './useAutomaticBackup';

export default function BackupSettings({ onRestore, automaticBackup }: { onRestore(): void; automaticBackup: ReturnType<typeof useAutomaticBackup> }) {
  const [snapshots, setSnapshots] = useState<RemoteSnapshot[]>([]);
  const [preview, setPreview] = useState<RestorePreview>();
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [allConnections, setAllConnections] = useState(true);
  const [connectionIDs, setConnectionIDs] = useState<string[]>([]);
  const [restoreIDs, setRestoreIDs] = useState<string[]>([]);
  const [restoreSettings, setRestoreSettings] = useState(true);
  const [search, setSearch] = useState('');
  useEffect(() => { GetCatalog().then(value => setConnections(value.connections || [])).catch(e => setError(String(e))); }, []);

  async function run(form: HTMLFormElement, action: string, path = '') {
    const data = new FormData(form);
    const options: WebDAVOptions = { url: String(data.get('url')), username: String(data.get('username')), password: String(data.get('password')), directory: String(data.get('directory')) };
    setError(''); setResult(''); setBusy(true);
    try {
      const selection: BackupSelection = { connection_ids: allConnections ? [] : connectionIDs, credentials: data.get('credentials') === 'on', snippets: data.get('snippets') === 'on', settings: data.get('settings') === 'on' };
      if (['backup', 'local-export', 'automatic-enable'].includes(action)) { if (!allConnections && !connectionIDs.length) throw new Error('请选择要备份的连接'); if (selection.settings) await SavePortableUI(capturePortableUI()); }
      switch (action) {
        case 'test': await TestWebDAV(options); setResult('WebDAV 连接正常'); break;
        case 'automatic-enable': await EnableAutomaticBackup(options, String(data.get('recovery')), selection); await automaticBackup.refresh(); break;
        case 'automatic-disable': await DisableAutomaticBackup(); await automaticBackup.refresh(); break;
        case 'list': setSnapshots(await ListSnapshots(options)??[]); setLoaded(true); break;
        case 'backup': {
          const remote = await BackupWebDAVWithSelection(options, String(data.get('recovery')), selection);
          setResult(`快照已保存：${remote}`); setSnapshots(await ListSnapshots(options)??[]); setLoaded(true); break;
        }
        case 'local-export': { const filename = await ExportLocalSnapshot(String(data.get('recovery')), selection); if (filename) setResult(`快照已导出：${filename}`); break; }
        case 'preview': setRestoreIDs([]); setPreview(await PreviewRestore(options, path, String(data.get('recovery')))); break;
        case 'local-preview': { const value = await PreviewLocalRestore(String(data.get('recovery'))); setRestoreIDs([]); setPreview(value.id ? value : undefined); break; }
        case 'restore': case 'import': await ConfirmRestoreSelection(preview!.id, restoreIDs, action === 'restore', restoreSettings); setPreview(undefined); setResult(action === 'restore' ? '恢复完成' : '所选连接已导入为独立副本'); if (restoreSettings) applyPortableUI(await GetPortableUI()); onRestore(); break;
      }
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); options.password = ''; }
  }

  return <section className="settings-panel">
    <h2>备份恢复</h2>
    <form onSubmit={(e) => e.preventDefault()}>
      <h3>WebDAV</h3>
      <Input name="url" type="url" label="地址" labelPlacement="outside" placeholder="https://" size="sm" isRequired isDisabled={busy} />
      <Input name="username" label="用户名" labelPlacement="outside" placeholder="用户名" size="sm" autoComplete="off" isDisabled={busy} />
      <Input name="password" label="WebDAV 密码" labelPlacement="outside" placeholder="密码" type="password" size="sm" autoComplete="off" isDisabled={busy} />
      <Input name="directory" label="备份目录" labelPlacement="outside" placeholder="相对路径" defaultValue="termquay/backups" size="sm" isRequired isDisabled={busy} />
      <h3>快照</h3>
      <Input name="recovery" label="独立备份密码" labelPlacement="outside" placeholder="独立备份密码" type="password" size="sm" autoComplete="off" isDisabled={busy} />
      <label className="checkbox-label"><input type="checkbox" name="credentials" /> 携带连接密码与私钥内容</label>
      <label className="checkbox-label"><input type="checkbox" name="snippets" defaultChecked />命令片段</label><label className="checkbox-label"><input type="checkbox" name="settings" defaultChecked />外观与快捷键</label>
      <details><summary>选择备份连接</summary><label className="checkbox-label"><input type="checkbox" checked={allConnections} onChange={event => setAllConnections(event.target.checked)} disabled={busy}/>全部连接</label>{!allConnections && <><input aria-label="筛选备份连接" placeholder="搜索连接" value={search} onChange={event => setSearch(event.target.value)}/><div className="backup-connection-list">{connections.filter(c => `${c.name} ${c.host}`.toLowerCase().includes(search.toLowerCase())).slice(0,200).map(c => <label className="checkbox-label" key={c.id}><input type="checkbox" disabled={busy} checked={connectionIDs.includes(c.id)} onChange={event => setConnectionIDs(previous => event.target.checked ? [...previous,c.id] : previous.filter(id => id !== c.id))}/>{c.name}<small className="muted">{c.host}</small></label>)}</div><p className="muted">已选 {connectionIDs.length} 项，跳板及所属分组随连接导出</p></>}</details>
      <div className="button-row"><Button size="sm" variant="bordered" isDisabled={busy} onPress={event => void run((event.target as HTMLElement).closest('form')!, 'local-export')}>导出加密文件</Button><Button size="sm" variant="light" isDisabled={busy} onPress={event => void run((event.target as HTMLElement).closest('form')!, 'local-preview')}>从文件预览恢复</Button></div>
      <div className="button-row">{[['test', '测试连接'], ['list', '读取快照'], ['backup', '创建快照']].map(([action, label]) => <Button key={action} size="sm" isDisabled={busy} onPress={(event) => { const form = (event.target as HTMLElement).closest('form')!; if (form.reportValidity()) void run(form, action); }}>{label}</Button>)}</div>
      <div className="automatic-backup"><div className="button-row"><span>{automaticBackup.status?.running ? '自动备份进行中' : automaticBackup.status?.pending ? '自动备份等待中' : automaticBackup.status?.enabled ? '自动备份已开启' : '自动备份已关闭'}</span><Button size="sm" variant="light" isDisabled={busy || !allConnections} onPress={event => { const form = (event.target as HTMLElement).closest('form')!; if (form.reportValidity()) void run(form, 'automatic-enable'); }}>{automaticBackup.status?.enabled ? '更新自动备份配置' : '启用自动备份'}</Button>{automaticBackup.status?.enabled && <Button size="sm" variant="light" isDisabled={busy} onPress={event => void run((event.target as HTMLElement).closest('form')!, 'automatic-disable')}>关闭</Button>}</div>{automaticBackup.status?.url && automaticBackup.status.enabled && <p className="file-path">{automaticBackup.status.url}</p>}{automaticBackup.status?.last_success && <p className="muted">最近成功 {new Date(automaticBackup.status.last_success).toLocaleString()}</p>}{(automaticBackup.error || automaticBackup.status?.error) && <p role="alert" className="error">{automaticBackup.error || automaticBackup.status?.error}</p>}<p className="muted">启用后加密保存 WebDAV 凭据与独立备份密码。连接、片段或界面设置变化后合并备份，失败保留状态，等待下次修改或重新启用。</p></div>
      {result && <p role="status" className="operation-result">{result}</p>}
      {error && <p role="alert" className="error">{error}</p>}
      <h3>远端快照</h3>{loaded && snapshots.length === 0 && <p className="muted">暂无快照</p>}
      <ul className="snapshot-list">{snapshots.map((s) => <li key={s.path}><div><code>{s.path}</code><span>{Math.ceil(s.size / 1024)} KiB</span></div><Button size="sm" variant="light" isDisabled={busy} onPress={(e) => void run((e.target as HTMLElement).closest('form')!, 'preview', s.path)}>预览恢复</Button></li>)}</ul>
      {preview && <div className="restore-preview">
        <h3>恢复预览</h3><p>{preview.device_id} · {new Date(preview.created_at).toLocaleString()}</p>
        <p>凭据 {preview.credentials} 项</p>
        {!!preview.settings?.length && <label className="checkbox-label"><input type="checkbox" checked={restoreSettings} disabled={busy} onChange={event => setRestoreSettings(event.target.checked)}/>恢复 {preview.settings.map(key => ({snippets:'命令片段',appearance:'外观',shortcuts:'快捷键'} as Record<string,string>)[key] || key).join('、')}</label>}
        {([['新增', preview.added], ['更新', preview.updated], ['移除', preview.removed]] as const).map(([title, names]) => <div key={title}><strong>{title} {names?.length??0}</strong>{names?.map((name, i) => <div key={i}>{name}</div>)}</div>)}
        <details><summary>选择导入连接 · {restoreIDs.length} 项</summary><div className="backup-connection-list">{(preview.connections || []).map(connection => <label className="checkbox-label" key={connection.id}><input type="checkbox" checked={restoreIDs.includes(connection.id)} disabled={busy} onChange={event => setRestoreIDs(previous => event.target.checked ? [...previous,connection.id] : previous.filter(id => id !== connection.id))}/>{connection.name}<small className="muted">{connection.host}</small></label>)}</div></details>
        <p>替换全部会覆盖当前连接、分组与凭据。导入所选会创建独立副本，包含依赖的跳板；信任记录保留。</p>
        <div className="button-row"><Button size="sm" color="primary" isDisabled={busy || !restoreIDs.length} onPress={event => void run((event.target as HTMLElement).closest('form')!, 'import')}>导入所选连接</Button><Button size="sm" color="danger" variant="light" isDisabled={busy} onPress={(e) => void run((e.target as HTMLElement).closest('form')!, 'restore')}>替换全部</Button><Button size="sm" variant="light" onPress={() => setPreview(undefined)}>取消</Button></div>
      </div>}
    </form>
  </section>;
}
