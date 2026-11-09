import type { ToolCall } from '../../../bindings/github.com/Sanjeever/termquay/internal/ai/models';
import type { AIMessage, AIToolResult } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';

const labels: Record<string, string> = { complete: '已完成', rejected: '已拒绝', unknown: '远端状态未知', failed: '失败', interrupted: '已中断', not_executed: '未执行' };
const names: Record<string, string> = { file_list: '列出目录', file_read: '读取文件', service_list: '查询服务', service_inspect: '服务详情', service_logs: '服务日志', port_list: '监听端口', container_list: '查询容器', container_inspect: '容器详情', container_logs: '容器日志', exec: '执行 Shell' };

export function ToolResult({result}:{result:AIToolResult}) {
  let text=result.data;
  if(result.exit_code===undefined && text){try{text=JSON.stringify(JSON.parse(text),null,2);}catch{ /* 旧记录或普通文本按原文展示。 */ }}
  return <div className="ai-tool-result">
    {text && <pre>{text}</pre>}{result.stderr && <pre className="error">{result.stderr}</pre>}
    {(result.exit_code!==undefined || result.truncated || result.status_unknown) && <p className="muted">{result.exit_code!==undefined?`退出码 ${result.exit_code}`:''}{result.truncated?' · 输出已截断':''}{result.status_unknown?' · 远端状态未知':''}</p>}
    {result.error && <p className="error">{result.error}</p>}
    {(result.stdout_base64 || result.stderr_base64) && <details><summary>原始输出（Base64）</summary>{result.stdout_base64 && <pre>{result.stdout_base64}</pre>}{result.stderr_base64 && <pre>{result.stderr_base64}</pre>}</details>}
  </div>;
}

export default function AIToolCall({ call, result, shell, pending, active, busy, onDecide }: { call: ToolCall; result?: AIMessage; shell?: string; pending: boolean; active: boolean; busy: boolean; onDecide(approved: boolean): void }) {
  let script = ''; let timeout = 0;
  if (call.name === 'exec') { try { const args = JSON.parse(call.arguments); script = args.script; timeout = args.timeout_seconds; } catch { /* 后端会拒绝无效参数。 */ } }
  const interpreter = shell || result?.result?.shell;
  return <div className={`ai-tool-call${pending ? ' pending' : ''}`}>
    <details open={pending || undefined}>
      <summary><span>{names[call.name] || call.name}</span><span className="muted">{result ? labels[result.state] || result.state : pending ? '等待批准' : active ? '等待结果' : '已中断，未恢复执行'}</span></summary>
      {script ? <><pre className="ai-script">{script}</pre><span className="muted">超时 {timeout} 秒 · {interpreter === 'powershell' ? 'Windows PowerShell' : interpreter === 'sh' ? 'sh' : '独立 Shell'}</span></> : <pre>{call.arguments}</pre>}
      {result?.result && <ToolResult result={result.result}/>}
    </details>
    {pending && <div className="ai-approval-actions"><button className="session-tool" disabled={busy} onClick={() => onDecide(false)}>拒绝</button><button className="session-tool ai-approve" disabled={busy} onClick={() => onDecide(true)}>批准执行</button></div>}
  </div>;
}
