import { useState } from 'react';
import ReactDOM from 'react-dom/client';
import { HeroUIProvider } from '@heroui/react';
import { useTranslation } from 'react-i18next';
import { AppearanceProvider } from '../src/features/settings/AppearanceProvider';
import { appearanceKey, defaultAppearance } from '../src/features/settings/appearance';
import MonitorPanel from '../src/features/monitor/MonitorPanel';
import { demoSamples } from '../src/features/demo/data';
import '../src/style.css';

localStorage.setItem(appearanceKey, JSON.stringify({ ...defaultAppearance, language: 'en' }));

function Fixture() {
  const { i18n } = useTranslation();
  const [monitor, setMonitor] = useState(true);
  return (
    <HeroUIProvider disableAnimation disableRipple>
      <main className="app-shell">
        <div className="button-row">
          <button onClick={() => void i18n.changeLanguage('zh-CN')}>Chinese</button>
          <button onClick={() => void i18n.changeLanguage('en')}>English</button>
        </div>
        <div className="ssh-workspace">
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
