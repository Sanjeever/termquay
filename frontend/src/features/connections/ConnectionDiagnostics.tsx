import { useEffect, useRef, useState } from 'react';
import { Button } from '@heroui/react';
import { CheckSSHFileAccess } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { ConnectionStep } from '../../../bindings/github.com/Sanjeever/termquay/internal/ssh/models';
import { errorMessage } from '../../lib/errors';
import ErrorNotice from '../../components/ErrorNotice';

const states: Record<string, string> = { running: '进行中', completed: '完成', failed: '失败', cancelled: '已结束' };
const codes: Record<string, string> = { dns: '域名解析失败', refused: '端口拒绝连接', timeout: '超时', cancelled: '已取消', identity: '身份需确认或已变化', authentication: '认证未完成' };

export default function ConnectionDiagnostics({ steps, workspace = '', busy = false }: { steps: ConnectionStep[]; workspace?: string; busy?: boolean }) {
  const [error, setError] = useState('');
  const [fileCheck, setFileCheck] = useState<{ state: string; duration: number; detail: string }>();
  const pending = useRef<ReturnType<typeof CheckSSHFileAccess>>();
  const generation = useRef(0);
  useEffect(() => { generation.current++; setFileCheck(undefined); return () => { generation.current++; pending.current?.cancel(); }; }, [workspace]);
  async function checkFiles() {
    if (pending.current) return;
    const epoch = generation.current, started = performance.now();
    setFileCheck({ state: 'running', duration: 0, detail: '' });
    const operation = CheckSSHFileAccess(workspace); pending.current = operation;
    try { await operation; if (generation.current === epoch) setFileCheck({ state: 'completed', duration: Math.round(performance.now() - started), detail: '' }); }
    catch (e) { if (generation.current === epoch) setFileCheck({ state: 'failed', duration: Math.round(performance.now() - started), detail: errorMessage(e) }); }
    finally { if (pending.current === operation) pending.current = undefined; }
  }
  async function copy() {
    const lines = steps.map(step => `${step.role} ${step.hop} · ${step.host}:${step.port} · ${step.stage} · ${states[step.state] || step.state} · ${step.duration_ms} ms${step.detail ? `\n${step.detail}` : ''}`);
    if (fileCheck) lines.push(`SFTP 文件通道 · ${states[fileCheck.state]} · ${fileCheck.duration} ms${fileCheck.detail ? `\n${fileCheck.detail}` : ''}`);
    try { await navigator.clipboard.writeText(lines.join('\n')); setError(''); } catch (e) { setError(errorMessage(e)); }
  }
  if (!steps.length) return null;
  return <div className="connection-diagnostics">
    <ol>{steps.map((step, index) => <li key={index} className={step.state === 'failed' ? 'error' : ''}><span>{step.role} {step.hop} · {step.host}:{step.port}</span><strong>{step.stage}</strong><span>{states[step.state] || step.state}{step.state !== 'running' && ` · ${step.duration_ms} ms`}</span>{step.detail && <details><summary>{codes[step.code || ''] || '技术详情'}</summary><pre>{step.detail}</pre></details>}</li>)}</ol>
    {fileCheck && <p className={fileCheck.state === 'failed' ? 'error' : ''}>SFTP 文件通道 · {states[fileCheck.state]}{fileCheck.state !== 'running' && ` · ${fileCheck.duration} ms`}{fileCheck.detail && <span className="file-path">{fileCheck.detail}</span>}</p>}
    <div className="button-row"><Button type="button" size="sm" variant="light" onPress={() => void copy()}>复制诊断摘要</Button>{workspace && <Button type="button" size="sm" variant="light" isDisabled={busy} isLoading={fileCheck?.state === 'running'} onPress={() => void checkFiles()}>检查文件通道</Button>}</div>
    <ErrorNotice message={error} onDismiss={() => setError('')} />
  </div>;
}
