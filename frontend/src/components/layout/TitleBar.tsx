import { useEffect, useRef, useState, type ReactNode, type MouseEvent } from 'react';
import { Events, System, Window } from '@wailsio/runtime';
import { TitlebarDoubleClick } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import appIcon from '../../../../build/appicon.svg';

export default function TitleBar({ tabs, tools, onError }: {
  tabs: ReactNode; tools: ReactNode; onError(message: string): void;
}) {
  const mac = System.IsMac();
  const [maximised, setMaximised] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [focused, setFocused] = useState(true);
  const dragReady = useRef(false);
  useEffect(() => {
    let disposed = false;
    const update = () => {
      Promise.all([Window.IsMaximised(), Window.IsFullscreen()]).then(([maximised, fullscreen]) => {
        if (!disposed) { setMaximised(maximised); setFullscreen(fullscreen); }
      }).catch(error => { if (!disposed) onError(String(error)); });
    };
    const off = [
      Events.On(Events.Types.Common.WindowMaximise, update),
      Events.On(Events.Types.Common.WindowUnMaximise, update),
      Events.On(Events.Types.Common.WindowRestore, update),
      Events.On(Events.Types.Common.WindowFullscreen, update),
      Events.On(Events.Types.Common.WindowUnFullscreen, update),
      Events.On(Events.Types.Common.WindowFocus, () => setFocused(true)),
      Events.On(Events.Types.Common.WindowLostFocus, () => setFocused(false)),
    ];
    update();
    return () => { disposed = true; off.forEach(unsubscribe => unsubscribe()); };
  }, [onError]);
  function run(action: () => Promise<void>) {
    onError('');
    action().catch(error => onError(String(error)));
  }
  function draggable(event: MouseEvent) { return getComputedStyle(event.target as Element).getPropertyValue('--termquay-window-drag').trim() === 'drag'; }
  function doubleClick(event: MouseEvent) {
    if (!draggable(event) || fullscreen) return;
    if (mac) run(() => TitlebarDoubleClick());
    else if (System.IsLinux()) run(() => Window.ToggleMaximise());
  }
  return <header className={`workbench-header${mac ? ' mac-titlebar' : ''}${fullscreen ? ' fullscreen-titlebar' : ''}${focused ? '' : ' inactive-titlebar'}`} onDoubleClick={doubleClick}
    onMouseDown={event => { if (mac) dragReady.current = !fullscreen && event.button === 0 && event.detail === 1 && draggable(event); }}
    onMouseMove={event => { if (mac && dragReady.current && event.buttons === 1) { dragReady.current = false; System.invoke('wails:drag'); } }}
    onMouseUp={() => { dragReady.current = false; }} onMouseLeave={() => { dragReady.current = false; }}>
    <div className="titlebar-brand" title="TermQuay"><img src={appIcon} alt="" width="18" height="18" draggable={false} /><span>TermQuay</span></div>
    {tabs}
    <div className="titlebar-drag" aria-hidden="true" />
    <div className="workbench-tools">{tools}</div>
    {!mac && !fullscreen && <div className="window-controls" role="group" aria-label="窗口控制">
      <button className="window-minimise" aria-label="最小化" title="最小化" onClick={() => run(() => Window.Minimise())}><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M1 6.5h10" /></svg></button>
      <button className="window-maximise" aria-label={maximised ? '还原窗口' : '最大化'} title={maximised ? '还原窗口' : '最大化'} onClick={() => run(() => Window.ToggleMaximise())}><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">{maximised ? <path d="M3.5 3.5v-2h7v7h-2M1.5 3.5h7v7h-7z" /> : <path d="M1.5 1.5h9v9h-9z" />}</svg></button>
      <button className="window-close" aria-label="关闭窗口" title="关闭窗口" onClick={() => run(() => Window.Close())}><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="m1.5 1.5 9 9m0-9-9 9" /></svg></button>
    </div>}
  </header>;
}
