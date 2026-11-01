import { createRef, useEffect, useRef, useState, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import { Events } from '@wailsio/runtime';
import { Button, Input, Select, SelectItem } from '@heroui/react';
import { OpenTerminal, TrustHost, OpenRDP, ProbeRDP, TrustRDPCertificate, GetCatalog, SaveConnection, DeleteConnection, SaveGroup, DeleteGroup, OpenSavedTerminal, OpenSavedRDP, UseSessionStorage,DiscardAndQuit } from '../bindings/github.com/Sanjeever/termquay/appservice';
import type { Request } from '../bindings/github.com/Sanjeever/termquay/internal/ssh/models';
import SSHWorkspace from './features/files/SSHWorkspace';
import RDPView, { type RDPHandle } from './features/rdp/RDPView';
import type { Grant } from '../bindings/github.com/Sanjeever/termquay/internal/rdp/models';
import type { Connection,Group } from '../bindings/github.com/Sanjeever/termquay/internal/store/models';
import type { Catalog } from '../bindings/github.com/Sanjeever/termquay/models';
import BackupSettings from './features/settings/BackupSettings';
import TransferPanel from './features/files/TransferPanel';

type Workspace = { id: string; name: string; rdp?: Grant; view?: RefObject<RDPHandle>; dirty?: boolean };

export default function App() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [active, setActive] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [canCancel,setCanCancel]=useState(false);
  const [fingerprint, setFingerprint] = useState('');
  const [certificateReason, setCertificateReason] = useState('');
  const [protocol, setProtocol] = useState('ssh');
  const formRef = useRef<HTMLFormElement>(null);
  const pending = useRef<{cancel():void} | null>(null);
  const [catalog, setCatalog] = useState<Catalog&{groups:Group[];connections:Connection[]}>();
  const [storageError, setStorageError] = useState('');
  const [editing, setEditing] = useState<Connection>();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [group, setGroup] = useState('');
  const [settings, setSettings] = useState(false);
  const [deleting, setDeleting] = useState('');
  const [closingWorkspace,setClosingWorkspace]=useState('');
  const [transfersOpen,setTransfersOpen]=useState(false);
  const [credentialEpoch,setCredentialEpoch]=useState(0);
  const [quitConfirm,setQuitConfirm]=useState(false);
  const savedTrust = useRef<Connection>();

  async function reload() { try { const data=await GetCatalog();setCatalog({...data,groups:data.groups??[],connections:data.connections??[]}); setStorageError(''); } catch (e) { setStorageError(String(e)); } }
  useEffect(() => { void reload(); }, []);
  useEffect(()=>Events.On('app:close-requested',()=>setQuitConfirm(true)),[]);

  async function connectSaved(c: Connection, trust = false) {
    setError(''); setBusy(true);
    try {
      if (c.protocol === 'ssh') {
        if (trust) await TrustHost(c.host, c.port, fingerprint);
        const operation=OpenSavedTerminal(c.id);pending.current=operation;setCanCancel(true);
        const result = await operation;
        if (result.trust_required) { setProtocol('ssh'); savedTrust.current = c; setFingerprint(result.fingerprint); return; }
        setWorkspaces((prev) => [...prev, { id: result.id, name: c.name }]); setActive(result.id);
      } else {
        if (trust) await TrustRDPCertificate(c.host, c.port, fingerprint);
        const probeOperation=ProbeRDP(c.host,c.port);pending.current=probeOperation;setCanCancel(true);
        const probe = await probeOperation;
        if (probe.trust_required) { setProtocol('rdp'); savedTrust.current = c; setFingerprint(probe.fingerprint); setCertificateReason(probe.reason); return; }
        const launchOperation=OpenSavedRDP(c.id);pending.current=launchOperation;
        const launch = await launchOperation; const view = createRef<RDPHandle>();
        flushSync(() => { setWorkspaces((prev) => [...prev, { id: launch.grant.id, name: c.name, rdp: launch.grant, view }]); setActive(launch.grant.id); });
        pending.current={cancel:()=>{setWorkspaces(prev=>prev.filter(w=>w.id!==launch.grant.id));setActive(workspaces[0]?.id||'')}};
        try { await view.current!.connect(launch.username, launch.password, launch.domain); } finally { launch.password = ''; }
      }
      setFingerprint(''); savedTrust.current = undefined; setSettings(false);
    } catch (e) { setError(String(e)); } finally { pending.current = null; setCanCancel(false);setBusy(false); }
  }

  async function save() {
    const form = formRef.current!; if (!form.reportValidity()) return;
    const data = new FormData(form);
    const host = String(data.get('host')).trim();
    try {
      await SaveConnection({ id: editing?.id || '', group_id: String(data.get('group') || ''), name: String(data.get('name') || host), protocol, host, port: Number(data.get('port')), username: String(data.get('username')),domain:String(data.get('domain')||''), credential_id: '' }, {
        host, port: Number(data.get('port')), username: String(data.get('username')), password: String(data.get('password')), private_key: String(data.get('private_key') || ''), passphrase: String(data.get('passphrase') || ''), fingerprint: '', cols: 100, rows: 30,
      });
      await reload(); setEditing(undefined); form.reset(); setError('');
    } catch (e) { setError(String(e)); }
  }

  async function connect(trust = false) {
    if (trust && savedTrust.current) { await connectSaved(savedTrust.current, true); return; }
    savedTrust.current = undefined;
    const form = formRef.current!; if (!form.reportValidity()) return;
    const data = new FormData(form);
    const request: Request = {
      host: String(data.get('host')).trim(), port: Number(data.get('port')), username: String(data.get('username')),
      password: String(data.get('password')), private_key: String(data.get('private_key') || ''), passphrase: String(data.get('passphrase') || ''), fingerprint: '', cols: 100, rows: 30,
    };
    setError(''); setBusy(true);
    try {
      if (protocol === 'rdp') {
        if (trust) await TrustRDPCertificate(request.host, request.port, fingerprint);
        const probeOperation=ProbeRDP(request.host,request.port);pending.current=probeOperation;setCanCancel(true);
        const probe = await probeOperation;
        if (probe.trust_required) { setFingerprint(probe.fingerprint); setCertificateReason(probe.reason); return; }
        const grantOperation=OpenRDP(request.host,request.port);pending.current=grantOperation;
        const grant = await grantOperation;
        const view = createRef<RDPHandle>();
        flushSync(() => { setWorkspaces((prev) => [...prev, { id: grant.id, name: request.host, rdp: grant, view }]); setActive(grant.id); });
        pending.current={cancel:()=>{setWorkspaces(prev=>prev.filter(w=>w.id!==grant.id));setActive(workspaces[0]?.id||'')}};
        setFingerprint('');
        const password = request.password; request.password = '';
        (form.elements.namedItem('password') as HTMLInputElement).value = '';
        setCredentialEpoch(value=>value+1);
        await view.current!.connect(request.username, password, String(data.get('domain') || ''));
        return;
      }
      if (trust) await TrustHost(request.host, request.port, fingerprint);
      const operation=OpenTerminal(request);pending.current=operation;setCanCancel(true);
      const result = await operation;
      if (result.trust_required) { setFingerprint(result.fingerprint); return; }
      setFingerprint('');
      setWorkspaces((prev) => [...prev, { id: result.id, name: `${request.username}@${request.host}` }]);
      setActive(result.id);
      (form.elements.namedItem('password') as HTMLInputElement).value = '';
      const keyInput=form.elements.namedItem('private_key') as HTMLTextAreaElement|null;if(keyInput)keyInput.value='';setCredentialEpoch(value=>value+1);
    } catch (e) { setError(String(e)); }
    finally { pending.current = null;setCanCancel(false); setBusy(false); request.password = ''; request.private_key = ''; }
  }

  return <main className="app-shell">
    <header className="app-header"><div className="wordmark">栈桥 <span>TermQuay</span></div><div className="button-row">{catalog?.session_only && <span className="version">会话存储</span>}<Button size="sm" variant="light" onPress={()=>setTransfersOpen(!transfersOpen)}>传输</Button><Button size="sm" variant="light" onPress={() => setSettings(!settings)}>{settings ? '返回工作区' : '备份恢复'}</Button><span className="version">开发版</span></div></header>
    <div className="app-body">
      <aside className="connection-sidebar">
        <div className="panel-heading">连接中心</div>
        {storageError && <div className="error" role="alert">{storageError}<Button size="sm" onPress={() => { UseSessionStorage().then(reload).catch((e) => setStorageError(String(e))); }}>使用会话存储</Button></div>}
        <Input aria-label="搜索连接" placeholder="搜索连接" size="sm" value={search} onValueChange={setSearch} />
        <div className="connection-filters"><select aria-label="协议筛选" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">全部协议</option><option value="ssh">SSH</option><option value="rdp">RDP</option></select><select aria-label="分组筛选" value={group} onChange={(e) => setGroup(e.target.value)}><option value="">全部分组</option>{catalog?.groups.map((g) => <option value={g.id} key={g.id}>{g.name}</option>)}</select></div>
        <div className="connection-list">{catalog?.connections.filter((c) => (filter === 'all' || c.protocol === filter) && (!group || c.group_id === group) && `${c.name} ${c.host} ${c.username}`.toLowerCase().includes(search.toLowerCase())).map((c) => <div className="connection-row" key={c.id}>
          <button className="connection-name" disabled={busy} onClick={() => void connectSaved(c)}><span>{c.name}</span><small>{c.protocol.toUpperCase()} · {c.host}</small></button>
          <button aria-label={`编辑 ${c.name}`} onClick={() => { setEditing(c); setProtocol(c.protocol); setFingerprint(''); }}>编辑</button>
          <button aria-label={`删除 ${c.name}`} onClick={() => setDeleting(c.id)}>×</button>
          {deleting === c.id && <div className="delete-confirm">删除此连接？<Button size="sm" color="danger" onPress={() => { DeleteConnection(c.id).then(reload).catch((e) => setError(String(e))); setDeleting(''); }}>删除</Button><Button size="sm" variant="light" onPress={() => setDeleting('')}>取消</Button></div>}
        </div>)}</div>
        <details className="group-editor"><summary>管理分组</summary><form onSubmit={(e) => { e.preventDefault(); const form = e.currentTarget; const data = new FormData(form); SaveGroup({ id: '', name: String(data.get('group_name')), parent_id: String(data.get('parent') || ''), sort_order: catalog?.groups.length || 0 }).then(() => { form.reset(); void reload(); }).catch((e) => setError(String(e))); }}><Input name="group_name" aria-label="分组名称" placeholder="分组名称" isRequired size="sm" /><select name="parent" aria-label="父分组"><option value="">顶层分组</option>{catalog?.groups.map((g) => <option value={g.id} key={g.id}>{g.name}</option>)}</select><Button size="sm" type="submit">新增分组</Button></form>{catalog?.groups.map((g) => <div className="group-row" key={g.id}><span>{g.name}</span><button aria-label={`删除分组 ${g.name}`} onClick={() => { DeleteGroup(g.id).then(reload).catch((e) => setError(String(e))); }}>×</button></div>)}</details>
        <div className="panel-heading form-heading">{editing ? '编辑连接' : '新建连接'}{editing && <button onClick={() => setEditing(undefined)}>取消</button>}</div>
        <form key={editing?.id || 'new'} ref={formRef} onSubmit={(e) => { e.preventDefault(); void connect(); }} className="connection-form">
          <Input name="name" label="连接名称" defaultValue={editing?.name} size="sm" />
          <Select label="协议" size="sm" selectedKeys={[protocol]} onSelectionChange={(keys) => { setProtocol(String([...keys][0])); setError(''); setFingerprint(''); }}>
            <SelectItem key="ssh">SSH</SelectItem><SelectItem key="rdp">RDP</SelectItem>
          </Select>
          <Input name="host" label="主机" defaultValue={editing?.host} isRequired size="sm" autoComplete="off" onValueChange={() => setFingerprint('')} />
          <Input key={protocol} name="port" label="端口" type="number" defaultValue={String(editing?.port || (protocol === 'ssh' ? 22 : 3389))} min={1} max={65535} isRequired size="sm" />
          <Input name="username" label="用户名" defaultValue={editing?.username} isRequired size="sm" autoComplete="off" />
          <Input key={`password-${credentialEpoch}`} name="password" label="密码" type="password" size="sm" autoComplete="off" />
          {protocol === 'rdp' && <Input name="domain" label="域（可选）" defaultValue={editing?.domain} size="sm" />}
          {protocol === 'ssh' && <details><summary>私钥认证</summary><label className="field-label" htmlFor="private-key">私钥内容</label><textarea id="private-key" name="private_key" rows={5} spellCheck={false} /><Input key={`passphrase-${credentialEpoch}`} name="passphrase" label="私钥口令" type="password" size="sm" autoComplete="off" /></details>}
          <select name="group" aria-label="连接分组" defaultValue={editing?.group_id || ''}><option value="">未分组</option>{catalog?.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
          {error && <p role="alert" className="error">{error}</p>}
          {fingerprint && <div className="host-trust"><p>{protocol === 'ssh' ? '首次连接，请核对主机指纹' : '请核对 RDP 证书指纹'}</p><code>{fingerprint}</code>{protocol === 'rdp' && <p>{certificateReason}</p>}<Button size="sm" onPress={() => void connect(true)}>信任并连接</Button></div>}
          <Button type="submit" size="sm" color="primary" isLoading={busy}>连接</Button>
          <Button size="sm" variant="bordered" onPress={() => void save()} isDisabled={busy || !catalog}>保存连接</Button>
          {busy && canCancel && <Button size="sm" variant="light" onPress={() => pending.current?.cancel()}>取消连接</Button>}
        </form>
      </aside>
      <section className="workspace-area">
        {quitConfirm&&<div className="draft-confirm">有未保存文件，是否放弃修改并退出？<Button size="sm" color="danger" onPress={()=>{DiscardAndQuit().catch(e=>setError(String(e)))}}>放弃修改并退出</Button><Button size="sm" variant="light" onPress={()=>setQuitConfirm(false)}>返回编辑</Button></div>}
        <div className="workspace-tabs" role="tablist" aria-label="连接工作区">
          {workspaces.map((w) => <div className={`workspace-tab ${active === w.id ? 'active' : ''}`} key={w.id}>
            <button role="tab" aria-selected={active === w.id} onClick={() => setActive(w.id)}>{w.name}</button>
            <button aria-label={`关闭 ${w.name}`} onClick={() => { if(w.dirty){setClosingWorkspace(w.id);return;} setWorkspaces((prev) => prev.filter((item) => item.id !== w.id)); if (active === w.id) setActive(workspaces.find((item) => item.id !== w.id)?.id || ''); }}>×</button>
          </div>)}
        </div>
        {closingWorkspace&&<div className="draft-confirm">工作区有未保存文件<Button size="sm" color="danger" onPress={()=>{setWorkspaces((prev)=>prev.filter(w=>w.id!==closingWorkspace));if(active===closingWorkspace)setActive(workspaces.find(w=>w.id!==closingWorkspace)?.id||'');setClosingWorkspace('');}}>放弃修改并关闭</Button><Button size="sm" variant="light" onPress={()=>setClosingWorkspace('')}>取消</Button></div>}
        {settings && <BackupSettings onRestore={() => void reload()} />}
        {workspaces.length === 0 && !settings && <div className="workspace-empty"><span>终端工作区</span></div>}
        {workspaces.map((w) => <div className="workspace" hidden={settings || active !== w.id} key={w.id}>{w.rdp ? <RDPView grant={w.rdp} ref={w.view} /> : <SSHWorkspace id={w.id} onDirtyChange={(dirty)=>setWorkspaces(prev=>prev.map(item=>item.id===w.id?{...item,dirty}:item))} onTransferStarted={()=>setTransfersOpen(true)} />}</div>)}
      </section>
    </div>
    {transfersOpen&&<TransferPanel/>}
  </main>;
}
