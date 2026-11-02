import type useTransfers from './useTransfers';
import Icon from '../../components/Icon';
import ResizeHandle from '../../components/layout/ResizeHandle';

const states: Record<string, string> = { queued:'等待中',running: '传输中', done: '已完成', cancelled: '已取消', failed: '失败' };
function bytes(value: number) { if (value < 1024) return `${value} B`; if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KiB`; if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MiB`; return `${(value / 1024 ** 3).toFixed(1)} GiB`; }

export default function TransferPanel({ tasks, height, onHeight, onClose }: { tasks: ReturnType<typeof useTransfers>; height: number; onHeight(value: number): void; onClose(): void }) {
  return <div className="transfer-dock" style={{ height }}><ResizeHandle label="传输面板高度" value={height} min={120} max={Math.max(120, Math.floor(window.innerHeight * .55))} onChange={onHeight} horizontal reverse />
    <section className="transfer-panel" aria-label="传输任务"><div className="transfer-heading"><h2>传输</h2><span className="muted">{tasks.running} 个进行中{tasks.failed ? ` · ${tasks.failed} 个失败` : ''}</span><button className="icon-button" aria-label="收起传输面板" onClick={onClose}><Icon name="close" width="15" /></button></div>
      {tasks.error && <p className="error" role="alert">{tasks.error}</p>}
      {tasks.items.length === 0 ? <p className="sidebar-empty">暂无传输任务</p> : <table><thead><tr><th>文件</th><th>方向</th><th>状态</th><th>进度</th><th>操作</th></tr></thead><tbody>{tasks.items.map(t => <tr key={t.id}>
        <td>{t.name}{t.error && <details className="error"><summary>传输失败</summary>{t.error}</details>}</td><td>{t.direction === 'upload' ? '上传' : '下载'}</td><td className={t.state === 'failed' ? 'error' : ''}>{states[t.state] || t.state}</td>
        <td>{bytes(t.completed)}{t.total > 0 ? ` / ${bytes(t.total)}` : ''}{t.total > 0 && <progress value={t.completed} max={t.total} aria-label={`${t.name} 传输进度`} />}</td>
        <td>{t.state === 'running'||t.state==='queued' ? <button onClick={() => void tasks.cancel(t.id)}>取消</button> : <button onClick={() => void tasks.clear(t.id)}>移除</button>}</td>
      </tr>)}</tbody></table>}
    </section>
  </div>;
}
