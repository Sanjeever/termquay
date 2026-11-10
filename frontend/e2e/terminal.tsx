import ReactDOM from 'react-dom/client';
import { useState } from 'react';
import { HeroUIProvider } from '@heroui/react';
import { AppearanceProvider } from '../src/features/settings/AppearanceProvider';
import { appearanceKey, defaultAppearance } from '../src/features/settings/appearance';
import TerminalView from '../src/features/terminal/TerminalView';
import AppearanceSettings from '../src/features/settings/AppearanceSettings';
import '../src/style.css';

localStorage.setItem(
  appearanceKey,
  JSON.stringify({
    ...defaultAppearance,
    language: 'en',
    localTerminalRenderer:
      new URLSearchParams(location.search).get('renderer') === 'webgl' ? 'webgl' : 'dom',
  }),
);
const runtime = Reflect.get(window, '_wails');
runtime.streamFactory = () => {
  const socket = new WebSocket(`ws://${location.host}/terminal-fixture`);
  socket.binaryType = 'arraybuffer';
  return socket;
};

function Fixture() {
  const [settings, setSettings] = useState(false);
  const [fontSize, setFontSize] = useState(14);
  return (
    <>
      <button onClick={() => setSettings((value) => !value)}>Terminal settings</button>
      <div hidden={!settings}>
        <AppearanceSettings section="terminal" fontSize={fontSize} onFontSize={setFontSize} />
      </div>
      <div className="local-workspace" style={{ display: settings ? 'none' : undefined }}>
        <TerminalView
          local
          id="terminal-fixture"
          workspace="terminal-fixture"
          visible={!settings}
          fontSize={fontSize}
          onSnippets={() => {}}
        />
      </div>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <AppearanceProvider>
    <HeroUIProvider disableAnimation disableRipple>
      <main className="app-shell">
        <Fixture />
      </main>
    </HeroUIProvider>
  </AppearanceProvider>,
);
