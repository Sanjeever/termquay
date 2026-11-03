import { useEffect, useState, type ReactNode } from 'react';
import { Events, System, Window } from '@wailsio/runtime';
import appIcon from '../../../../build/appicon.svg';

export default function TitleBar({ tabs, tools, onError }: {
  tabs: ReactNode; tools: ReactNode; onError(message: string): void;
}) {
  const mac = System.IsMac();
  const [maximised, setMaximised] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [focused, setFocused] = useState(true);
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
  function doubleClick() { if (System.IsLinux()) run(() => Window.ToggleMaximise()); }
  return <header className={`workbench-header${mac ? ' mac-titlebar' : ''}${fullscreen ? ' fullscreen-titlebar' : ''}${focused ? '' : ' inactive-titlebar'}`}>
    <div className="titlebar-brand" onDoubleClick={doubleClick}><img src={appIcon} alt="" width="20" height="20" draggable={false} /><span>TermQuay</span></div>
    {tabs}
    <div className="titlebar-drag" aria-hidden="true" onDoubleClick={doubleClick} />
    <div className="workbench-tools">{tools}</div>
    {!mac && !fullscreen && <div className="window-controls" role="group" aria-label="窗口控制">
      <button className="window-minimise" aria-label="最小化" title="最小化" onClick={() => run(() => Window.Minimise())}><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M1 6.5h10" /></svg></button>
      <button className="window-maximise" aria-label={maximised ? '还原窗口' : '最大化'} title={maximised ? '还原窗口' : '最大化'} onClick={() => run(() => Window.ToggleMaximise())}><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">{maximised ? <path d="M3.5 3.5v-2h7v7h-2M1.5 3.5h7v7h-7z" /> : <path d="M1.5 1.5h9v9h-9z" />}</svg></button>
      <button className="window-close" aria-label="关闭窗口" title="关闭窗口" onClick={() => run(() => Window.Close())}><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="m1.5 1.5 9 9m0-9-9 9" /></svg></button>
    </div>}
  </header>;
}
