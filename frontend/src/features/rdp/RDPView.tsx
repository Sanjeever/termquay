import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Button, Dropdown, DropdownTrigger, DropdownMenu, DropdownItem } from '@heroui/react';
import { Events } from '@wailsio/runtime';
import type { IronError, UserInteraction } from '@devolutions/iron-remote-desktop';
import { CloseRDP } from '../../../bindings/github.com/Sanjeever/termquay/appservice';
import type { Grant } from '../../../bindings/github.com/Sanjeever/termquay/internal/rdp/models';

export type RDPOptions = { clipboard: boolean; resolution: string };
export type RDPHandle = { connect(username: string, password: string, domain: string): Promise<void>; cancel(): void; focus(): void; options(): RDPOptions };
let initialization: Promise<typeof import('@devolutions/iron-remote-desktop-rdp')> | undefined;

function initialize() {
  initialization ??= import('@devolutions/iron-remote-desktop-rdp').then(async module => { await module.init('OFF'); return module; }).catch(error => { initialization = undefined; throw error; });
  return initialization;
}

function detail(error: unknown) {
  const iron = error as Partial<IronError> | null;
  return typeof iron?.backtrace === 'function' ? iron.backtrace() : String(error);
}

const RDPView = forwardRef<RDPHandle, { grant?: Grant; target: string; visible: boolean; failure?: string; busy: boolean; onRetry(): void; onEdit(): void; onState(state: string): void; options: RDPOptions; onResolution(value: string): Promise<void> }>(function RDPView({ grant, target, visible, failure, busy, onRetry, onEdit, onState, options, onResolution }, ref) {
  const view = useRef<HTMLDivElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const ui = useRef<UserInteraction>();
  const [error, setError] = useState('');
  const [status, setStatus] = useState('正在装载桌面组件');
  const [clipboard, setClipboard] = useState(options.clipboard);
  const [activeClipboard, setActiveClipboard] = useState(false);
  const [resolution, setResolution] = useState(options.resolution);
  const [scale, setScale] = useState<'fit'|'real'>('fit');
  const [fullscreen, setFullscreen] = useState(false);
  const [toolbarCollapsed, setToolbarCollapsed] = useState(false);
  useEffect(() => { setClipboard(options.clipboard); setResolution(options.resolution); }, [options]);
  useEffect(() => { const changed = () => { const full = document.fullscreenElement === view.current; setFullscreen(full); setToolbarCollapsed(full); focusDesktop(); }; document.addEventListener('fullscreenchange', changed); return () => document.removeEventListener('fullscreenchange', changed); }, []);
  const stateCallback = useRef(onState); stateCallback.current = onState;
  useEffect(() => { stateCallback.current(status === '已连接' ? '已连接' : ready.ended || failure ? '已断开' : '连接中'); }, [status, failure]);
  function focusDesktop() { container.current?.querySelector('iron-remote-desktop')?.shadowRoot?.querySelector<HTMLCanvasElement>('canvas')?.focus(); }
  const ready = useMemo(() => {
    let resolve!: (value: UserInteraction) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<UserInteraction>((yes, no) => { resolve = yes; reject = no; });
    let stop!: (reason: Error) => void;
    const stopped = new Promise<never>((_, no) => { stop = no; });
    void promise.catch(() => {}); void stopped.catch(() => {});
    return { promise, resolve, reject, stopped, stop, ended: false, disposed: false, running: false, error: '' };
  }, [grant?.id]);

  function shutdown() {
    const api = ui.current; ui.current = undefined;
    if (!ready.running) return '';
    ready.running = false;
    try { api?.shutdown(); return ''; } catch (e) { return `关闭桌面失败：${detail(e)}`; }
  }

  function finish(status: string, message = '') {
    if (ready.ended || ready.disposed) return;
    ready.ended = true; ready.error = message;
    ready.stop(new Error(message || status)); ready.reject(new Error(message || status));
    const closingError = shutdown();
    setStatus(status); setError([message, closingError].filter(Boolean).join('\n'));
    if (grant) void CloseRDP(grant.id).catch(e => { if (!ready.disposed) setError(previous => [previous, `关闭连接失败：${detail(e)}`].filter(Boolean).join('\n')); });
  }

  useImperativeHandle(ref, () => ({
    async connect(username, password, domain) {
      if (!grant) throw new Error('RDP 尚未授权');
      const timer = setTimeout(() => finish('连接超时', '等待 RDP 认证与桌面建立超时'), 30000);
      try {
        const api = await Promise.race([ready.promise, ready.stopped]);
        const backend = await initialize();
        if (ready.ended || ready.disposed) throw new Error('连接已取消');
        setStatus('正在连接');
        api.setEnableClipboard(options.clipboard); setActiveClipboard(options.clipboard);
        const [width,height] = options.resolution === 'dynamic' ? [1280,800] : options.resolution.split('x').map(Number);
        const config = api.configBuilder().withUsername(username).withPassword(password)
          .withServerDomain(domain).withDestination(grant.destination).withProxyAddress(grant.proxy_url)
          .withAuthToken(grant.token).withDesktopSize({ width, height })
          .withExtension(backend.enableCredssp(true)).withExtension(backend.displayControl(true)).build();
        const session = await Promise.race([api.connect(config).then(result => { if (ready.ended || ready.disposed) { api.shutdown(); throw new Error('连接已取消'); } return result; }), ready.stopped]);
        api.setKeyboardUnicodeMode(true);
        setStatus('已连接');
        ready.running = true;
        void session.run().then(() => { ready.running = false; finish('已断开'); }, e => { ready.running = false; finish('会话中断', detail(e)); });
      } catch (e) { const message = ready.error || detail(e); finish('连接失败', message); throw new Error(message); }
      finally { clearTimeout(timer); password = ''; }
    },
    cancel: () => finish('连接已取消'),
    focus: focusDesktop,
    options: () => ({ clipboard, resolution }),
  }), [grant, ready, options, clipboard, resolution]);

  useEffect(() => {
    if (!grant) return;
    let desktop: HTMLElement | undefined;
    const timer = setTimeout(() => finish('远程桌面装载失败', '桌面组件就绪超时'), 15000);
    setStatus('正在装载桌面组件'); setError('');
    void (async () => {
      try {
        const module = await initialize();
        await import('@devolutions/iron-remote-desktop');
        if (ready.disposed || ready.ended) return;
        desktop = document.createElement('iron-remote-desktop');
        Object.assign(desktop, { module: module.Backend });
        desktop.setAttribute('verbose', 'false'); desktop.setAttribute('scale', 'fit'); desktop.tabIndex = 0;
        desktop.style.cssText = 'display:flex;width:100%;height:100%;';
        desktop.addEventListener('ready', (event) => {
          if (ready.disposed || ready.ended) return;
          ui.current = (event as CustomEvent<{ irgUserInteraction: UserInteraction }>).detail.irgUserInteraction;
          ui.current.setEnableClipboard(false);ui.current.setEnableAutoClipboard(false);
        }, { once: true });
        desktop.addEventListener('clipboard-ready', () => {
          if (ready.disposed || ready.ended || !ui.current) return;
          clearTimeout(timer); setStatus('准备就绪'); ready.resolve(ui.current);
        }, { once: true });
        container.current!.appendChild(desktop);
      } catch (e) { finish('远程桌面装载失败', detail(e)); }
    })();
    const unsubscribe = Events.On('rdp:error', (event) => {
      const data = event.data as { id: string; error: string };
      if (data.id === grant.id) finish('会话中断', data.error);
    });
    const unsubscribeClosed = Events.On('rdp:closed', event => { const data = event.data as { id: string }; if (data.id === grant.id) finish('已断开'); });
    return () => { ready.disposed = true; clearTimeout(timer); unsubscribe(); unsubscribeClosed(); ready.stop(new Error('RDP 工作区已关闭')); ready.reject(new Error('RDP 工作区已关闭')); const closingError = shutdown(); if (closingError) console.error(closingError); desktop?.remove(); void CloseRDP(grant.id).catch(() => {}); };
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

  useEffect(() => { if (visible && status === '已连接' && !document.activeElement?.closest('[role=tablist]')) focusDesktop(); }, [visible, status]);
  useEffect(() => { ui.current?.setVisibility(visible && status === '已连接'); }, [visible, status]);
  useEffect(() => { container.current?.querySelector('iron-remote-desktop')?.setAttribute('scale', scale); }, [scale, status]);

  return <div className="rdp-view" ref={view}>
    {fullscreen && toolbarCollapsed && <button className="rdp-toolbar-reveal" aria-label="显示远程桌面工具栏" onClick={() => { setToolbarCollapsed(false); requestAnimationFrame(() => view.current?.querySelector<HTMLElement>('.rdp-toolbar button')?.focus()); }}>显示工具栏</button>}
    <div className="rdp-toolbar" hidden={status !== '已连接' || !grant || (fullscreen && toolbarCollapsed)}>
      <Dropdown><DropdownTrigger><Button size="sm" variant="light" isDisabled={status !== '已连接'}>组合键</Button></DropdownTrigger><DropdownMenu aria-label="远端组合键" onAction={key => { if (key === 'secure') ui.current?.ctrlAltDel(); else ui.current?.metaKey(); focusDesktop(); }}><DropdownItem key="secure">Ctrl + Alt + Del</DropdownItem><DropdownItem key="windows">Windows 键</DropdownItem></DropdownMenu></Dropdown>
      <label>远端分辨率<select aria-label="远程分辨率" disabled={status!=='已连接'} value={resolution} onChange={async e => { const value=e.target.value; try { await onResolution(value); setResolution(value); } catch(e) { setError(detail(e)); } }}><option value="dynamic">适应窗口</option><option value="1280x800">1280 × 800</option><option value="1920x1080">1920 × 1080</option></select></label>
      <label>本地缩放<select aria-label="本地缩放" value={scale} onChange={e => setScale(e.target.value as 'fit'|'real')}><option value="fit">适合窗口</option><option value="real">实际像素</option></select></label>
      <label><input type="checkbox" checked={clipboard} onChange={e => setClipboard(e.target.checked)} />文本剪贴板</label>
      {clipboard !== activeClipboard && <Button size="sm" variant="bordered" isDisabled={busy} onPress={onRetry}>应用并重新连接</Button>}
      {activeClipboard && <><Button size="sm" variant="light" isDisabled={status!=='已连接'} onPress={() => { ui.current?.sendClipboardData().then(focusDesktop).catch(e => setError(detail(e))); }}>粘贴到远端</Button><Button size="sm" variant="light" isDisabled={status!=='已连接'} onPress={() => { ui.current?.saveRemoteClipboardData().then(focusDesktop).catch(e => setError(detail(e))); }}>复制到本机</Button></>}
      <Button size="sm" variant="light" onPress={() => { const operation = document.fullscreenElement ? document.exitFullscreen() : view.current?.requestFullscreen(); operation?.then(focusDesktop).catch(e => setError(detail(e))); }}>切换全屏</Button>
      <Button size="sm" variant="light" onPress={() => finish('已断开')}>断开</Button>
      {fullscreen && <Button size="sm" variant="light" onPress={() => { setToolbarCollapsed(true); focusDesktop(); }}>收起工具栏</Button>}
    </div>
    <div className="rdp-canvas" ref={container} hidden={status !== '已连接' || !grant} />
    {error && status === '已连接' && <div className="session-status error" role="alert">{error}</div>}
    {(failure || !grant || ready.ended) ? <div className="rdp-failure" role="status"><h2>{failure ? '连接未完成' : ready.ended ? status : '正在连接'}</h2><p className="muted">{target}</p><div className="button-row"><Button size="sm" color="primary" isDisabled={busy} onPress={onRetry}>重试</Button><Button size="sm" variant="bordered" isDisabled={busy} onPress={onEdit}>编辑连接</Button></div><label className="checkbox-label"><input type="checkbox" disabled={busy} checked={clipboard} onChange={e => setClipboard(e.target.checked)} />文本剪贴板</label>{(failure || error) && <details><summary>技术详情</summary><p className="error" role="alert">{failure || error}</p></details>}</div> : <div className="session-status"><span>{status}</span>{error && <details><summary>技术详情</summary><span role="alert" className="error">{error}</span></details>}</div>}
  </div>;
});

export default RDPView;
