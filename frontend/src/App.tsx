import { useRef, useState } from 'react';
import { Button, Input, Select, SelectItem } from '@heroui/react';
import { OpenTerminal, TrustHost } from '../bindings/github.com/Sanjeever/termquay/appservice';
import type { Request } from '../bindings/github.com/Sanjeever/termquay/internal/ssh/models';
import TerminalView from './features/terminal/TerminalView';

type Workspace = { id: string; name: string };

export default function App() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [active, setActive] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [fingerprint, setFingerprint] = useState('');
  const [protocol, setProtocol] = useState('ssh');
  const formRef = useRef<HTMLFormElement>(null);
  const pending = useRef<ReturnType<typeof OpenTerminal> | null>(null);

  async function connect(trust = false) {
    const form = formRef.current!; if (!form.reportValidity()) return;
    const data = new FormData(form);
    const request: Request = {
      host: String(data.get('host')).trim(), port: Number(data.get('port')), username: String(data.get('username')),
      password: String(data.get('password')), private_key: String(data.get('private_key') || ''), passphrase: '', fingerprint: '', cols: 100, rows: 30,
    };
    setError(''); setBusy(true);
    try {
      if (trust) await TrustHost(request.host, request.port, fingerprint);
      pending.current = OpenTerminal(request);
      const result = await pending.current;
      if (result.trust_required) { setFingerprint(result.fingerprint); return; }
      setFingerprint('');
      setWorkspaces((prev) => [...prev, { id: result.id, name: `${request.username}@${request.host}` }]);
      setActive(result.id);
      (form.elements.namedItem('password') as HTMLInputElement).value = '';
    } catch (e) { setError(String(e)); }
    finally { pending.current = null; setBusy(false); request.password = ''; request.private_key = ''; }
  }

  return <main className="app-shell">
    <header className="app-header"><div className="wordmark">栈桥 <span>TermQuay</span></div><span className="version">开发版</span></header>
    <div className="app-body">
      <aside className="connection-sidebar">
        <div className="panel-heading">新建连接</div>
        <form ref={formRef} onSubmit={(e) => { e.preventDefault(); void connect(); }} className="connection-form">
          <Select label="协议" size="sm" selectedKeys={[protocol]} onSelectionChange={(keys) => { setProtocol(String([...keys][0])); setError(''); }}>
            <SelectItem key="ssh">SSH</SelectItem><SelectItem key="rdp">RDP</SelectItem>
          </Select>
          <Input name="host" label="主机" isRequired size="sm" autoComplete="off" onValueChange={() => setFingerprint('')} />
          <Input key={protocol} name="port" label="端口" type="number" defaultValue={protocol === 'ssh' ? '22' : '3389'} min={1} max={65535} isRequired size="sm" />
          <Input name="username" label="用户名" isRequired size="sm" autoComplete="off" />
          <Input name="password" label="密码" type="password" size="sm" autoComplete="off" />
          {protocol === 'ssh' && <details><summary>私钥认证</summary><label className="field-label" htmlFor="private-key">私钥内容</label><textarea id="private-key" name="private_key" rows={5} spellCheck={false} /></details>}
          {error && <p role="alert" className="error">{error}</p>}
          {fingerprint && <div className="host-trust"><p>首次连接，请核对主机指纹</p><code>{fingerprint}</code><Button size="sm" onPress={() => void connect(true)}>本次应用运行期间信任</Button></div>}
          <Button type="submit" size="sm" color="primary" isLoading={busy} isDisabled={protocol === 'rdp'}>连接</Button>
          {busy && <Button size="sm" variant="light" onPress={() => pending.current?.cancel()}>取消连接</Button>}
        </form>
      </aside>
      <section className="workspace-area">
        <div className="workspace-tabs" role="tablist" aria-label="连接工作区">
          {workspaces.map((w) => <div className={`workspace-tab ${active === w.id ? 'active' : ''}`} key={w.id}>
            <button role="tab" aria-selected={active === w.id} onClick={() => setActive(w.id)}>{w.name}</button>
            <button aria-label={`关闭 ${w.name}`} onClick={() => { setWorkspaces((prev) => prev.filter((item) => item.id !== w.id)); if (active === w.id) setActive(workspaces.find((item) => item.id !== w.id)?.id || ''); }}>×</button>
          </div>)}
        </div>
        {workspaces.length === 0 && <div className="workspace-empty"><span>终端工作区</span></div>}
        {workspaces.map((w) => <div className="workspace" hidden={active !== w.id} key={w.id}><TerminalView id={w.id} /></div>)}
      </section>
    </div>
  </main>;
}
