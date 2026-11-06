import type { ToolCall } from '../../../bindings/github.com/Sanjeever/termquay/internal/ai/models';
import type { AIMessage } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';

const labels: Record<string, string> = { complete: '已完成', rejected: '已拒绝', unknown: '远端状态未知', failed: '失败', interrupted: '已中断', not_executed: '未执行' };
const names: Record<string, string> = { file_list: '列出目录', file_read: '读取文件', service_list: '查询服务', service_inspect: '服务详情', service_logs: '服务日志', port_list: '监听端口', container_list: '查询容器', container_inspect: '容器详情', container_logs: '容器日志', exec: '执行 Shell' };

export default function AIToolCall({ call, result, pending, active, busy, onDecide }: { call: ToolCall; result?: AIMessage; pending: boolean; active: boolean; busy: boolean; onDecide(approved: boolean): void }) {
  let script = ''; let timeout = 0;
  if (call.name === 'exec') { try { const args = JSON.parse(call.arguments); script = args.script; timeout = args.timeout_seconds; } catch { /* 后端会拒绝无效参数。 */ } }
  return <div className={`ai-tool-call${pending ? ' pending' : ''}`}>
    <details open={pending || undefined}>
      <summary><span>{names[call.name] || call.name}</span><span className="muted">{result ? labels[result.state] || result.state : pending ? '等待批准' : active ? '等待结果' : '已中断，未恢复执行'}</span></summary>
      {script ? <><pre className="ai-script">{script}</pre><span className="muted">超时 {timeout} 秒 · 独立 Shell</span></> : <pre>{call.arguments}</pre>}
      {result && <pre className={result.message.is_error ? 'error' : ''}>{result.message.content}</pre>}
    </details>
    {pending && <div className="ai-approval-actions"><button className="session-tool" disabled={busy} onClick={() => onDecide(false)}>拒绝</button><button className="session-tool ai-approve" disabled={busy} onClick={() => onDecide(true)}>批准执行</button></div>}
  </div>;
}
