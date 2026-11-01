import { useEffect, useState } from 'react';
import { Events } from '@wailsio/runtime';
import { CancelTransfer, ClearTransfer, ListTransfers } from '../../../bindings/github.com/Sanjeever/termquay/appservice';
import type { Transfer } from '../../../bindings/github.com/Sanjeever/termquay/models';

const states: Record<string, string> = { running: '传输中', done: '已完成', cancelled: '已取消', failed: '失败' };

export default function TransferPanel() {
  const [transfers, setTransfers] = useState<Record<string, Transfer>>({});
  const [error, setError] = useState('');
  useEffect(() => {
    let disposed = false;
    const off = Events.On('transfer:changed', (event) => { const t = event.data; setTransfers((prev) => ({ ...prev, [t.id]: t })); });
    ListTransfers().then((list) => { if (!disposed) setTransfers((prev) => ({ ...Object.fromEntries((list??[]).map((t) => [t.id, t])), ...prev })); }).catch((e) => setError(String(e)));
    return () => { disposed = true; off(); };
  }, []);
  return <section className="transfer-panel" aria-label="传输任务">
    {error && <p className="error" role="alert">{error}</p>}
    <table><thead><tr><th>文件</th><th>方向</th><th>状态</th><th>进度</th><th>操作</th></tr></thead><tbody>{Object.values(transfers).map((t) => <tr key={t.id}>
      <td>{t.name}{t.error && <div className="error">{t.error}</div>}</td><td>{t.direction === 'upload' ? '上传' : '下载'}</td><td>{states[t.state] || t.state}</td>
      <td>{(t.completed / 1024 ** 2).toFixed(1)} MiB{t.total > 0 ? ` / ${(t.total / 1024 ** 2).toFixed(1)} MiB` : ''}{t.total > 0 && <progress value={t.completed} max={t.total} aria-label={`${t.name} 传输进度`} />}</td>
      <td>{t.state === 'running' ? <button onClick={() => CancelTransfer(t.id).catch((e) => setError(String(e)))}>取消</button> : <button onClick={() => { ClearTransfer(t.id).then(() => setTransfers((prev) => { const copy = { ...prev }; delete copy[t.id]; return copy; })).catch((e) => setError(String(e))); }}>移除</button>}</td>
    </tr>)}</tbody></table>
  </section>;
}
