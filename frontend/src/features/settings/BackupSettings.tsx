import { useState } from 'react';
import { Button, Input } from '@heroui/react';
import { BackupWebDAV, ConfirmRestore, ListSnapshots, PreviewRestore, TestWebDAV } from '../../../bindings/github.com/Sanjeever/termquay/appservice';
import type { RemoteSnapshot, WebDAVOptions } from '../../../bindings/github.com/Sanjeever/termquay/internal/backup/models';
import type { RestorePreview } from '../../../bindings/github.com/Sanjeever/termquay/models';

export default function BackupSettings({ onRestore }: { onRestore(): void }) {
  const [snapshots, setSnapshots] = useState<RemoteSnapshot[]>([]);
  const [preview, setPreview] = useState<RestorePreview>();
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  const [busy, setBusy] = useState(false);

  async function run(form: HTMLFormElement, action: string, path = '') {
    const data = new FormData(form);
    const options: WebDAVOptions = { url: String(data.get('url')), username: String(data.get('username')), password: String(data.get('password')), directory: String(data.get('directory')) };
    setError(''); setResult(''); setBusy(true);
    try {
      switch (action) {
        case 'test': await TestWebDAV(options); setResult('WebDAV 连接正常'); break;
        case 'list': setSnapshots(await ListSnapshots(options)??[]); break;
        case 'backup': {
          const remote = await BackupWebDAV(options, String(data.get('recovery')), data.get('credentials') === 'on');
          setResult(`快照已保存：${remote}`); setSnapshots(await ListSnapshots(options)??[]); break;
        }
        case 'preview': setPreview(await PreviewRestore(options, path, String(data.get('recovery')))); break;
        case 'restore': await ConfirmRestore(preview!.id); setPreview(undefined); setResult('恢复完成'); onRestore(); break;
      }
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); options.password = ''; }
  }

  return <section className="settings-panel">
    <h2>加密备份</h2>
    <form onSubmit={(e) => e.preventDefault()}>
      <Input name="url" type="url" label="WebDAV 地址" size="sm" isRequired />
      <Input name="username" label="用户名" size="sm" autoComplete="off" />
      <Input name="password" label="WebDAV 密码" type="password" size="sm" autoComplete="off" />
      <Input name="directory" label="备份目录" defaultValue="termquay/backups" size="sm" isRequired />
      <Input name="recovery" label="独立备份密码" type="password" size="sm" autoComplete="off" />
      <label className="checkbox-label"><input type="checkbox" name="credentials" /> 携带连接密码与私钥内容</label>
      <div className="button-row">{[['test', '测试连接'], ['list', '读取快照'], ['backup', '创建快照']].map(([action, label]) => <Button key={action} size="sm" isDisabled={busy} onPress={(event) => { const form = (event.target as HTMLElement).closest('form')!; if (form.reportValidity()) void run(form, action); }}>{label}</Button>)}</div>
      {result && <p role="status" className="operation-result">{result}</p>}
      {error && <p role="alert" className="error">{error}</p>}
      <ul className="snapshot-list">{snapshots.map((s) => <li key={s.path}><div><code>{s.path}</code><span>{Math.ceil(s.size / 1024)} KiB</span></div><Button size="sm" variant="light" isDisabled={busy} onPress={(e) => void run((e.target as HTMLElement).closest('form')!, 'preview', s.path)}>预览恢复</Button></li>)}</ul>
      {preview && <div className="restore-preview">
        <h3>恢复预览</h3><p>{preview.device_id} · {new Date(preview.created_at).toLocaleString()}</p>
        <p>凭据 {preview.credentials} 项</p>
        {([['新增', preview.added], ['更新', preview.updated], ['移除', preview.removed]] as const).map(([title, names]) => <div key={title}><strong>{title} {names?.length??0}</strong>{names?.map((name, i) => <div key={i}>{name}</div>)}</div>)}
        <p>确认后替换当前连接、分组与连接凭据，保留本机设置和信任记录。</p>
        <div className="button-row"><Button size="sm" color="danger" isDisabled={busy} onPress={(e) => void run((e.target as HTMLElement).closest('form')!, 'restore')}>确认恢复</Button><Button size="sm" variant="light" onPress={() => setPreview(undefined)}>取消</Button></div>
      </div>}
    </form>
  </section>;
}
