import { errorMessage } from "../../lib/errors";
import { useEffect, useRef, useState } from 'react';
import { OpenTerminal, OpenSavedTerminalInteractive, GetSSHChallenge, GetSSHConnectionProgress, AnswerSSHChallenge, ProbeRDPRoute, TrustSSHHost, TrustRDPCertificateRoute, OpenRDPRoute, OpenSavedRDPRoute, OpenSystemRDP, OpenSavedSystemRDP, CloseWorkspace, CloseRDP } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { SSHChallenge, SSHRouteHop } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import { ReconnectSavedSSH } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { Connection } from '../../../bindings/github.com/Sanjeever/termquay/internal/store/models';
import type { Request, ConnectionStep } from '../../../bindings/github.com/Sanjeever/termquay/internal/ssh/models';
import type { Grant } from '../../../bindings/github.com/Sanjeever/termquay/internal/rdp/models';
import type { HostTrust } from './HostTrustDialog';
import type { RDPOptions } from '../rdp/RDPView';

type Attempt = { cancelled: boolean; progressEpoch: number; workspaceID?: string; operation?: { cancel(): void }; resolve?: (accept: boolean) => void };

export default function useConnectionAttempt(onSSH: (id: string, connection: Connection, reuse?: string, automatic?: boolean, route?: SSHRouteHop[]) => void, beginRDP: (connection: Connection, reuse?: string, options?: RDPOptions) => string, onRDP: (id: string, grant: Grant, username: string, password: string, domain: string) => Promise<void>, failRDP: (id: string, error: string) => void, cancelRDP: (id: string) => void, remove: (id: string) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [target, setTarget] = useState('');
  const [workspaceID,setWorkspaceID]=useState('');
  const [trust, setTrust] = useState<HostTrust>();
  const [challenge, setChallenge] = useState<SSHChallenge>();
  const [steps, setSteps] = useState<ConnectionStep[]>([]);
  const [connectedWorkspace, setConnectedWorkspace] = useState('');
  const authID = useRef('');
  const retryable = useRef(false);
  const current = useRef<Attempt>();
  function cancel() { const attempt = current.current; if (!attempt) return; attempt.cancelled = true; attempt.operation?.cancel(); attempt.resolve?.(false); setTrust(undefined); setChallenge(undefined); }
  async function answer(answers: string[]) { if (!challenge) throw new Error('认证提示已失效'); await AnswerSSHChallenge(authID.current, challenge.id, answers); setChallenge(undefined); }
  useEffect(() => () => cancel(), []);
  function confirm(accept: boolean) { current.current?.resolve?.(accept); setTrust(undefined); }

  async function start(connection: Connection, auth?: Request, reuse?: string, options?: RDPOptions, automatic = false, expectedRoute: SSHRouteHop[] = []) {
    if (current.current) return false;
    const attempt: Attempt = { cancelled: false, progressEpoch: 0, workspaceID: reuse };
    current.current = attempt; setBusy(true); setWorkspaceID(reuse||'');setError(''); setTarget(connection.name || connection.host);
    setSteps([]); setConnectedWorkspace('');
    retryable.current = false;
    let owned = '';
    let rdpWorkspace = '';
    let poll: ReturnType<typeof setTimeout> | undefined;
    const check = () => { if (attempt.cancelled) throw new Error('连接已取消'); };
    const ask = (fingerprint: string, reason?: string,host=connection.host,port=connection.port) => new Promise<boolean>(resolve => { attempt.resolve = resolve; setTrust({ host, port, protocol: connection.protocol, fingerprint, reason }); });
    try {
      if (automatic) {
        const operation = ReconnectSavedSSH(connection.id, expectedRoute); attempt.operation = operation;
        const result = await operation; owned = result.result.id; check();
        setSteps(result.steps?.length ? result.steps : result.result.steps || []);
        if (result.error) { retryable.current = result.retryable; throw new Error(result.error); }
        setConnectedWorkspace(result.result.id);
        onSSH(result.result.id, connection, reuse, true, result.result.route); owned = '';
      } else if (connection.protocol === 'ssh') {
        authID.current = crypto.randomUUID();
        if (auth) auth.auth_id = authID.current;
        const open = () => auth ? OpenTerminal(auth) : OpenSavedTerminalInteractive(connection.id, authID.current);
        async function loadChallenge() { const epoch = attempt.progressEpoch; try { const [value, progress] = await Promise.all([GetSSHChallenge(authID.current), GetSSHConnectionProgress(authID.current)]); if (current.current === attempt && !attempt.cancelled && epoch === attempt.progressEpoch) { setChallenge(value || undefined); if (progress?.length) setSteps(progress); } } catch (e) { if (current.current === attempt && !attempt.cancelled && epoch === attempt.progressEpoch) { setError(`读取连接进度失败：${errorMessage(e)}`); cancel(); } } finally { if (current.current === attempt && !attempt.cancelled) poll = setTimeout(loadChallenge, 300); } }
        void loadChallenge();
        let operation = open(); attempt.operation = operation;
        let result = await operation; attempt.progressEpoch++; owned = result.id; check(); setSteps(result.steps || []);
        for(let review=0;result.trust_required;review++) {
          if(review>=5)throw new Error('身份确认次数超限，请重新连接');
          if (!await ask(result.fingerprint,result.trust_role==='jump'?'跳板机身份':result.trust_role==='target'?'跳板机后的目标身份':undefined,result.trust_host||connection.host,result.trust_port||connection.port)) { attempt.cancelled = true; return false; }
          check(); await TrustSSHHost(result.trust_host||connection.host, result.trust_port||connection.port, result.fingerprint,result.trust_via||''); check();
          operation = open(); attempt.operation = operation; result = await operation; attempt.progressEpoch++; owned = result.id; check(); setSteps(result.steps || []);
        }
        setConnectedWorkspace(result.id);
        onSSH(result.id, connection, reuse, false, result.route); owned = '';
      } else if (options?.client === 'system') {
        if(options.gateway)throw new Error('系统 RDP 客户端不能使用应用内 SSH 跳板');
        const operation = auth ? OpenSystemRDP(connection, auth, options.resolution, options.clipboard) : OpenSavedSystemRDP(connection.id, options.resolution, options.clipboard);
        attempt.operation = operation;
        await operation;
      } else {
        rdpWorkspace = beginRDP(connection, reuse, options);
        setWorkspaceID(rdpWorkspace);
        attempt.workspaceID = rdpWorkspace;
        const probeOperation = ProbeRDPRoute(connection.host, connection.port, options?.gateway||''); attempt.operation = probeOperation;
        const probe = await probeOperation; check();
        if (probe.trust_required) {
          if (!await ask(probe.fingerprint, probe.reason)) { attempt.cancelled = true; throw new Error('连接已取消'); }
          check(); await TrustRDPCertificateRoute(connection.host, connection.port, probe.fingerprint, options?.gateway||''); check();
        }
        let grant: Grant; let username: string; let password: string; let domain: string;
        if (auth) {
          const operation = OpenRDPRoute(connection.host, connection.port, options?.gateway||''); attempt.operation = operation;
          grant = await operation; username = auth.username; password = auth.password; domain = connection.domain || '';
        } else {
          const operation = OpenSavedRDPRoute(connection.id, options?.gateway||''); attempt.operation = operation;
          const launch = await operation; grant = launch.grant; username = launch.username; password = launch.password; domain = launch.domain; launch.password = '';
        }
        owned = grant.id; check(); attempt.operation = { cancel: () => cancelRDP(rdpWorkspace) };
        try { await onRDP(rdpWorkspace, grant, username, password, domain); check(); } finally { password = ''; }
        owned = '';
      }
      return true;
    } catch (e) { const progress = (e as { cause?: { steps?: ConnectionStep[] } } | null)?.cause?.steps; if (Array.isArray(progress)) setSteps(progress); const message = attempt.cancelled ? '连接已取消' : errorMessage(e); if (rdpWorkspace) failRDP(rdpWorkspace, message); if (!attempt.cancelled) setError(message); return false; }
    finally {
      attempt.progressEpoch++;
      clearTimeout(poll); setChallenge(undefined);
      if (auth) { auth.password = ''; auth.private_key = ''; auth.passphrase = ''; }
      try { if (owned) { if (connection.protocol === 'ssh') { remove(owned); await CloseWorkspace(owned); } else await CloseRDP(owned); } }
      catch (e) { setError(previous => [previous, `关闭连接失败：${errorMessage(e)}`].filter(Boolean).join('\n')); }
      finally { current.current = undefined; setSteps(previous => previous.map(step => step.state === 'running' ? { ...step, state: 'cancelled' } : step)); setBusy(false); setTrust(undefined); }
    }
  }
  return { start, busy, workspaceID,error, target, trust, confirm, challenge, answer, cancel, steps, connectedWorkspace, canRetry: () => retryable.current, cancelWorkspace: (id: string) => { if (current.current?.workspaceID === id) cancel(); }, clearError: () => setError('') };
}
