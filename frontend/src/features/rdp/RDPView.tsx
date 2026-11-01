import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Button } from '@heroui/react';
import { Events } from '@wailsio/runtime';
import type { UserInteraction } from '@devolutions/iron-remote-desktop';
import { CloseRDP } from '../../../bindings/github.com/Sanjeever/termquay/appservice';
import type { Grant } from '../../../bindings/github.com/Sanjeever/termquay/internal/rdp/models';

export type RDPHandle = { connect(username: string, password: string, domain: string): Promise<void> };
let initialization: Promise<typeof import('@devolutions/iron-remote-desktop-rdp')> | undefined;

const RDPView = forwardRef<RDPHandle, { grant: Grant }>(function RDPView({ grant }, ref) {
  const container = useRef<HTMLDivElement>(null);
  const ui = useRef<UserInteraction>();
  const closed=useRef(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('正在准备远程桌面');
  const [clipboard, setClipboard] = useState(false);
  const [resolution, setResolution] = useState('dynamic');
  const ready = useMemo(() => {
    let resolve!: (value: UserInteraction) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<UserInteraction>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
  }, []);

  useImperativeHandle(ref, () => ({
    async connect(username, password, domain) {
      try {
        const api = await ready.promise;
        const backend = await initialization!;
        setStatus('正在连接');
        const config = api.configBuilder().withUsername(username).withPassword(password)
          .withServerDomain(domain).withDestination(grant.destination).withProxyAddress(grant.proxy_url)
          .withAuthToken(grant.token).withDesktopSize({ width: 1280, height: 800 })
          .withExtension(backend.enableCredssp(true)).withExtension(backend.displayControl(true)).build();
        await api.connect(config);
        api.setKeyboardUnicodeMode(true);
        api.setEnableClipboard(false);
        setStatus(closed.current?'已断开':'已连接');
      } catch (e) { setError(String(e)); setStatus('连接失败'); throw e; }
      finally { password = ''; }
    },
  }), [grant, ready]);

  useEffect(() => {
    let disposed = false;
    let desktop: HTMLElement | undefined;
    initialization ??= import('@devolutions/iron-remote-desktop-rdp').then(async (module) => { await module.init('OFF'); return module; });
    void (async () => {
      try {
        const module = await initialization!;
        await import('@devolutions/iron-remote-desktop');
        if (disposed) return;
        desktop = document.createElement('iron-remote-desktop');
        Object.assign(desktop, { module: module.Backend });
        desktop.setAttribute('verbose', 'false'); desktop.setAttribute('scale', 'fit');
        desktop.style.cssText = 'display:flex;width:100%;height:100%;';
        desktop.addEventListener('ready', (event) => {
          if (disposed) return;
          ui.current = (event as CustomEvent<{ irgUserInteraction: UserInteraction }>).detail.irgUserInteraction;
          ui.current.setEnableClipboard(false);ui.current.setEnableAutoClipboard(false);
          setStatus('准备就绪'); ready.resolve(ui.current);
        }, { once: true });
        container.current!.appendChild(desktop);
      } catch (e) { setError(String(e)); setStatus('远程桌面装载失败'); ready.reject(e); }
    })();
    const unsubscribe = Events.On('rdp:error', (event) => {
      const data = event.data as { id: string; error: string };
      if (data.id === grant.id) { closed.current=true;setError(data.error); setStatus('已断开'); }
    });
    const unsubscribeClosed=Events.On('rdp:closed',event=>{const data=event.data as {id:string};if(data.id===grant.id){closed.current=true;setStatus('已断开')}});
    return () => { disposed = true; unsubscribe();unsubscribeClosed(); ui.current?.shutdown(); desktop?.remove(); CloseRDP(grant.id).catch(() => {}); ready.reject(new Error('RDP 工作区已关闭')); };
  }, [grant, ready]);

  useEffect(() => {
    if(status!=='已连接')return;
    if (resolution !== 'dynamic') { const [width, height] = resolution.split('x').map(Number); ui.current?.resize(width, height); return; }
    let timer: ReturnType<typeof setTimeout>;
    const observer = new ResizeObserver(([entry]) => {
      clearTimeout(timer);
      timer = setTimeout(() => { const { width, height } = entry.contentRect; if (width >= 320 && height >= 240) ui.current?.resize(Math.floor(width), Math.floor(height)); }, 200);
    });
    observer.observe(container.current!);
    return () => { clearTimeout(timer); observer.disconnect(); };
  }, [resolution,status]);

  return <div className="rdp-view">
    <div className="rdp-toolbar">
      <Button size="sm" variant="light" isDisabled={status!=='已连接'} onPress={() => ui.current?.ctrlAltDel()}>Ctrl+Alt+Del</Button>
      <Button size="sm" variant="light" isDisabled={status!=='已连接'} onPress={() => ui.current?.metaKey()}>Windows 键</Button>
      <select aria-label="远程分辨率" disabled={status!=='已连接'} value={resolution} onChange={(e) => setResolution(e.target.value)}><option value="dynamic">适应窗口</option><option value="1280x800">1280 × 800</option><option value="1920x1080">1920 × 1080</option></select>
      <label><input type="checkbox" disabled={status!=='已连接'} checked={clipboard} onChange={(e) => { setClipboard(e.target.checked); ui.current?.setEnableClipboard(e.target.checked); }} /> 文本剪贴板</label>
      {clipboard && <><Button size="sm" variant="light" isDisabled={status!=='已连接'} onPress={() => { ui.current?.sendClipboardData().catch((e) => setError(String(e))); }}>粘贴到远端</Button><Button size="sm" variant="light" isDisabled={status!=='已连接'} onPress={() => { ui.current?.saveRemoteClipboardData().catch((e) => setError(String(e))); }}>复制到本机</Button></>}
      <Button size="sm" variant="light" onPress={() => { container.current?.requestFullscreen().catch((e) => setError(String(e))); }}>全屏</Button>
    </div>
    <div className="rdp-canvas" ref={container} />
    <div className="session-status"><span>{status}</span>{error && <span role="alert" className="error">{error}</span>}</div>
  </div>;
});

export default RDPView;
