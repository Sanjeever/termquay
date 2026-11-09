import { eventError, errorMessage } from '../../lib/errors.ts';
import { t as translate } from '../../i18n/index.ts';
import { useTranslation } from 'react-i18next';
import type { ToolCall } from '../../../bindings/github.com/Sanjeever/termquay/internal/ai/models';
import type { AIMessage, AIToolResult } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';

const labels: Record<string, string> = { get complete() { return translate('ai:completed'); }, get rejected() { return translate('ai:denied'); }, get unknown() { return translate('ai:remoteStateUnknown'); }, get failed() { return translate('ai:failed'); }, get interrupted() { return translate('ai:interrupted'); }, get not_executed() { return translate('ai:notExecuted'); } };
const names: Record<string, string> = { get file_list() { return translate('ai:listDirectory'); }, get file_read() { return translate('ai:readFile'); }, get service_list() { return translate('ai:queryServices'); }, get service_inspect() { return translate('ai:serviceDetails'); }, get service_logs() { return translate('ai:serviceLogs'); }, get port_list() { return translate('ai:listeningPorts'); }, get container_list() { return translate('ai:queryContainers'); }, get container_inspect() { return translate('ai:containerDetails'); }, get container_logs() { return translate('ai:containerLogs'); }, get exec() { return translate('ai:executeShellCommand'); } };

export function ToolResult({result}:{result:AIToolResult}) {
  useTranslation();
  let text=result.data === 'null' ? '' : result.data;
  let hasMore=false;
  if(result.exit_code===undefined && text){try{const data=JSON.parse(text);hasMore=typeof data?.next_offset==='number';text=JSON.stringify(data,null,2);}catch{ /* 旧记录或普通文本按原文展示。 */ }}
  const status=[result.exit_code!==undefined?translate('ai:exitCode', { value1: result.exit_code }):'',result.truncated?(hasMore?translate('ai:moreResultsAvailable'):translate('ai:outputTruncated')):'',result.status_unknown?translate('ai:remoteStateUnknown'):''].filter(Boolean).join(' · ');
  return <div className="ai-tool-result">
    {text && <pre>{text}</pre>}{result.stderr && <pre className="error">{result.stderr}</pre>}
    {status && <p className="muted">{status}</p>}
    {errorMessage(eventError(result)) && <p className="error">{errorMessage(eventError(result))}</p>}
    {(result.stdout_base64 || result.stderr_base64) && <details><summary>{translate('ai:rawOutputBase64')}</summary>{result.stdout_base64 && <pre aria-label={translate('ai:rawStdoutBytes')}>{result.stdout_base64}</pre>}{result.stderr_base64 && <pre aria-label={translate('ai:rawStderrBytes')}>{result.stderr_base64}</pre>}</details>}
  </div>;
}

export default function AIToolCall({ call, result, shell, pending, active, busy, onDecide }: { call: ToolCall; result?: AIMessage; shell?: string; pending: boolean; active: boolean; busy: boolean; onDecide(approved: boolean): void }) {
  useTranslation();
  let script = ''; let timeout = 0;
  if (call.name === 'exec') { try { const args = JSON.parse(call.arguments); script = args.script; timeout = args.timeout_seconds; } catch { /* 后端会拒绝无效参数。 */ } }
  const interpreter = shell || result?.result?.shell;
  return <div className={`ai-tool-call${pending ? ' pending' : ''}`}>
    <details open={pending || undefined}>
      <summary><span>{names[call.name] || call.name}</span><span className="muted">{result ? labels[result.state] || result.state : pending ? translate('ai:awaitingApproval') : active ? translate('ai:awaitingResult') : translate('ai:interruptedExecutionWasNotResumed')}</span></summary>
      {script ? <><pre className="ai-script">{script}</pre><span className="muted">{translate('ai:timeout')}{timeout} {translate('ai:seconds')}{interpreter === 'powershell' ? 'Windows PowerShell' : interpreter === 'sh' ? 'sh' : translate('ai:separateShell')}</span></> : <pre>{call.arguments}</pre>}
      {result?.result && <ToolResult result={result.result}/>}
    </details>
    {pending && <div className="ai-approval-actions"><button className="session-tool" disabled={busy} onClick={() => onDecide(false)}>{translate('ai:deny')}</button><button className="session-tool ai-approve" disabled={busy} onClick={() => onDecide(true)}>{translate('ai:approveExecution')}</button></div>}
  </div>;
}
