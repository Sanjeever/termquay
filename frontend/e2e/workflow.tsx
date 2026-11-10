import { useState } from 'react';
import ReactDOM from 'react-dom/client';
import { HeroUIProvider } from '@heroui/react';
import { useTranslation } from 'react-i18next';
import { AppearanceProvider } from '../src/features/settings/AppearanceProvider';
import { appearanceKey, defaultAppearance } from '../src/features/settings/appearance';
import MonitorPanel from '../src/features/monitor/MonitorPanel';
import TunnelPanel from '../src/features/tunnels/TunnelPanel';
import TransferBrowser from '../src/features/files/TransferBrowser';
import { demoSamples } from '../src/features/demo/data';
import '../src/style.css';

localStorage.setItem(appearanceKey, JSON.stringify({ ...defaultAppearance, language: 'en' }));

function Fixture() {
  const { i18n } = useTranslation();
  const [monitor, setMonitor] = useState(true);
  const [tunnels, setTunnels] = useState(false);
  const [files, setFiles] = useState(false);
  const [filesCreated, setFilesCreated] = useState(false);
  const [connected, setConnected] = useState(true);
  const [accepted, setAccepted] = useState('');
  return (
    <HeroUIProvider disableAnimation disableRipple>
      <main className="app-shell">
        <div className="button-row">
          <button onClick={() => void i18n.changeLanguage('zh-CN')}>Chinese</button>
          <button onClick={() => void i18n.changeLanguage('en')}>English</button>
          <button onClick={() => setTunnels(!tunnels)}>Port forwarding</button>
          <button
            onClick={() => {
              setFilesCreated(true);
              setFiles(true);
            }}
          >
            Files workspace
          </button>
          <button onClick={() => setFiles(false)}>Terminal workspace</button>
          <button onClick={() => setFilesCreated(false)}>Close files</button>
          <button onClick={() => setConnected(false)}>Disconnect</button>
          <output aria-label="Accepted transfer">{accepted}</output>
        </div>
        {filesCreated && (
          <div className="workspace" hidden={!files}>
            <TransferBrowser
              embedded
              visible={files}
              targets={
                connected
                  ? [
                      { id: 'host-a', name: 'Host A' },
                      { id: 'host-b', name: 'Host B' },
                    ]
                  : []
              }
              initial="host-a"
              onTransfer={(value) => setAccepted(value.id)}
              onCompare={() => {}}
              onClose={() => setFilesCreated(false)}
            />
          </div>
        )}
        <div className="ssh-workspace" hidden={files && filesCreated}>
          <div className="workspace-toolbar">
            <span className="session-target">deploy@long-application-host.example.invalid:22</span>
            <span className="connection-environment production">Production</span>
            <button className="session-tool">Files</button>
            <div className="workspace-auxiliary">
              <button className="session-tool" onClick={() => setMonitor(!monitor)}>
                Monitoring
              </button>
              <button className="session-tool">AI assistant</button>
            </div>
          </div>
          {tunnels && (
            <TunnelPanel
              id="fixture"
              connectionID=""
              target="deploy@jump.example.invalid:22"
              visible
            />
          )}
          <div className="ssh-panels">
            <div className="terminal-pane" style={{ flex: 1, minWidth: 0 }} />
            <MonitorPanel
              id="fixture"
              visible={monitor}
              demoSamples={demoSamples}
              onClose={() => setMonitor(false)}
            />
          </div>
        </div>
      </main>
    </HeroUIProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <AppearanceProvider>
    <Fixture />
  </AppearanceProvider>,
);
