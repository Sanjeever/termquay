import ReactDOM from 'react-dom/client';
import { HeroUIProvider } from '@heroui/react';
import { AppearanceProvider } from '../src/features/settings/AppearanceProvider';
import { appearanceKey, defaultAppearance } from '../src/features/settings/appearance';
import TerminalView from '../src/features/terminal/TerminalView';
import '../src/style.css';

localStorage.setItem(appearanceKey, JSON.stringify({ ...defaultAppearance, language: 'en' }));
const runtime = Reflect.get(window, '_wails');
runtime.streamFactory = () => {
  const socket = new WebSocket(`ws://${location.host}/terminal-fixture`);
  socket.binaryType = 'arraybuffer';
  return socket;
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <AppearanceProvider>
    <HeroUIProvider disableAnimation disableRipple>
      <main className="app-shell">
        <TerminalView
          local
          id="terminal-fixture"
          workspace="terminal-fixture"
          visible
          fontSize={14}
          onSnippets={() => {}}
        />
      </main>
    </HeroUIProvider>
  </AppearanceProvider>,
);
