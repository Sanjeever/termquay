import ReactDOM from 'react-dom/client';
import { useRef, useState } from 'react';
import { HeroUIProvider } from '@heroui/react';
import { AppearanceProvider, useAppearance } from '../src/features/settings/AppearanceProvider';
import { appearanceKey, defaultAppearance } from '../src/features/settings/appearance';
import LocalTerminalWorkspace, {
  type LocalTerminalWorkspaceHandle,
} from '../src/features/terminal/LocalTerminalWorkspace';
import '../src/style.css';

localStorage.setItem(appearanceKey, JSON.stringify({ ...defaultAppearance, language: 'en' }));
Reflect.get(window, '_wails').streamFactory = () => {
  const socket = new WebSocket(`ws://${location.host}/local-workspace-fixture`);
  socket.binaryType = 'arraybuffer';
  return socket;
};

function Fixture() {
  const [shown, setShown] = useState(true);
  const [open, setOpen] = useState(true);
  const [active, setActive] = useState('local-1');
  const workspace = useRef<LocalTerminalWorkspaceHandle>(null);
  const { appearance, update } = useAppearance();
  return (
    <>
      <div className="button-row">
        <button onClick={() => setShown((value) => !value)}>Toggle workspace</button>
        <button
          onClick={() =>
            update({ ...appearance, language: appearance.language === 'en' ? 'zh-CN' : 'en' })
          }
        >
          Toggle language
        </button>
        <button onClick={() => workspace.current?.workspaceAction('focusTerminalRight')}>
          Focus right
        </button>
        <button onClick={() => workspace.current?.workspaceAction('focusTerminalDown')}>
          Focus down
        </button>
        <button onClick={() => setOpen(false)}>Remove workspace</button>
        <output aria-label="Active terminal">{active}</output>
      </div>
      {open && (
        <div style={{ display: shown ? 'flex' : 'none', flex: 1, minHeight: 0 }}>
          <LocalTerminalWorkspace
            id="local-workspace"
            initial={{
              id: 'local-1',
              shell: 'Shell',
              kind: 'shell',
              directory: '/work/project',
              hostname: 'computer',
            }}
            shells={[{ id: 'shell', name: 'Shell' }]}
            visible={shown}
            fontSize={14}
            ref={workspace}
            onSelected={(session) => setActive(session.id)}
            onStateChange={() => {}}
            onAttention={() => {}}
            onActivate={() => setShown(true)}
            onSnippets={() => {}}
            onEmpty={() => setOpen(false)}
          />
        </div>
      )}
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
