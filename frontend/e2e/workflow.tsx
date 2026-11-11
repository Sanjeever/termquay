import { useState } from 'react';
import ReactDOM from 'react-dom/client';
import { HeroUIProvider } from '@heroui/react';
import { useTranslation } from 'react-i18next';
import { AppearanceProvider } from '../src/features/settings/AppearanceProvider';
import { appearanceKey, defaultAppearance } from '../src/features/settings/appearance';
import MonitorPanel from '../src/features/monitor/MonitorPanel';
import TunnelPanel from '../src/features/tunnels/TunnelPanel';
import TransferBrowser from '../src/features/files/TransferBrowser';
import CodeEditor from '../src/features/files/CodeEditor';
import FileHistoryDialog from '../src/features/files/FileHistoryDialog';
import FileBrowser from '../src/features/files/FileBrowser';
import SSHWorkspace from '../src/features/files/SSHWorkspace';
import type { TransferBrowserRequest } from '../src/features/files/TransferBrowser';
import DemoWorkbench from '../src/features/demo/DemoWorkbench';
import { defaultShortcuts } from '../src/lib/shortcuts';
import { demoDirectories, demoSamples } from '../src/features/demo/data';
import '../src/style.css';

const parameters = new URLSearchParams(location.search);
const demoScene = parameters.get('scene');
if (demoScene === 'ssh') {
  Reflect.get(window, '_wails').streamFactory = (name: string) => {
    const socket = new WebSocket(`ws://${location.host}/ssh-fixture/${name}`);
    socket.binaryType = 'arraybuffer';
    return socket;
  };
  localStorage.setItem('termquay.layout.monitor', 'false');
  localStorage.setItem('termquay.layout.files-open', 'true');
}
localStorage.setItem(
  appearanceKey,
  JSON.stringify({
    ...defaultAppearance,
    language: parameters.get('language') === 'zh-CN' ? 'zh-CN' : 'en',
    theme: parameters.get('theme') === 'dark' ? 'dark' : 'light',
  }),
);

function Fixture() {
  const { i18n } = useTranslation();
  const [monitor, setMonitor] = useState(true);
  const [tunnels, setTunnels] = useState(false);
  const [files, setFiles] = useState(false);
  const [filesCreated, setFilesCreated] = useState(false);
  const [connected, setConnected] = useState(true);
  const [accepted, setAccepted] = useState('');
  const [editor, setEditor] = useState(false);
  const [content, setContent] = useState('original');
  const [saved, setSaved] = useState('original');
  const [history, setHistory] = useState<'history' | 'validate'>();
  const [fileTree, setFileTree] = useState(false);
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
          <button onClick={() => setFileTree(!fileTree)}>File tree</button>
          <button
            onClick={() => {
              setEditor(true);
              setFiles(false);
            }}
          >
            Configuration editor
          </button>
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
        {editor && (
          <div style={{ display: 'flex', flex: 1, flexDirection: 'column', minHeight: 0 }}>
            <CodeEditor
              path="/tmp/config"
              content={content}
              format={{ encoding: 'UTF-8', line_ending: 'LF', bom: false }}
              visible
              dirty={content !== saved}
              saving={false}
              onChange={setContent}
              onSave={() => setSaved(content)}
              onSaveAndValidate={() => setHistory('validate')}
              onHistory={() => setHistory('history')}
              onReload={() => {}}
              onDownload={() => {}}
            />
            {history && (
              <FileHistoryDialog
                workspace="owner-1"
                target="user@example.invalid:22"
                document={{
                  path: '/tmp/config',
                  content,
                  revision: saved,
                  encoding: 'UTF-8',
                  line_ending: 'LF',
                  bom: false,
                }}
                dirty={content !== saved}
                validateOnOpen={history === 'validate'}
                onSave={async () => {
                  setSaved(content);
                  return true;
                }}
                onRestore={(value) => setContent(value.content)}
                onClose={() => setHistory(undefined)}
              />
            )}
          </div>
        )}
        <div className="ssh-workspace" hidden={editor || (files && filesCreated)}>
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
            {fileTree && (
              <div className="file-dock" style={{ width: 300 }}>
                <FileBrowser
                  id="fixture-files"
                  connectionID=""
                  visible
                  initialDirectory="/srv/termquay/config"
                  demoDirectories={demoDirectories}
                  onOpen={async () => {}}
                  onClose={() => setFileTree(false)}
                />
              </div>
            )}
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

function SSHFixture() {
  const [files, setFiles] = useState(false);
  const [sessionID, setSessionID] = useState('host-a');
  const [state, setState] = useState('connected');
  const [request, setRequest] = useState<TransferBrowserRequest>();
  return (
    <HeroUIProvider disableAnimation disableRipple>
      <main className="app-shell">
        <div className="button-row">
          <button onClick={() => setState('disconnected')}>Disconnect SSH</button>
          <button
            onClick={() => {
              setSessionID((value) => `${value}-next`);
              setState('connected');
            }}
          >
            Reconnect SSH
          </button>
        </div>
        <div className="workspace" hidden={files}>
          <SSHWorkspace
            id="ssh-view"
            sessionID={sessionID}
            connectionID="connection-a"
            target="deploy@app.example.invalid:22"
            environment="production"
            state={state}
            shortcuts={defaultShortcuts}
            visible={!files}
            automaticReconnect={false}
            busy={false}
            onDirtyChange={() => {}}
            onState={() => {}}
            onStateChange={() => {}}
            onReconnect={() => {}}
            onAutomaticReconnect={async () => ({ ok: false, retryable: false })}
            onCancelReconnect={() => {}}
            onSnippets={() => {}}
            onTransfers={(directory, selected) => {
              setRequest((previous) => ({
                workspace: 'host-a',
                directory,
                selected,
                sequence: (previous?.sequence || 0) + 1,
              }));
              setFiles(true);
            }}
          />
        </div>
        {request && (
          <div className="workspace" hidden={!files}>
            <button onClick={() => setFiles(false)}>Back to SSH</button>
            <TransferBrowser
              embedded
              visible={files}
              targets={[{ id: 'host-a', name: 'Host A' }]}
              request={request}
              onTransfer={() => {}}
              onCompare={() => {}}
              onClose={() => setFiles(false)}
            />
          </div>
        )}
      </main>
    </HeroUIProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <AppearanceProvider>
    {demoScene === 'connections' || demoScene === 'editor' || demoScene === 'terminal' ? (
      <HeroUIProvider disableAnimation disableRipple>
        <DemoWorkbench
          scene={demoScene}
          onScene={() => {}}
          onExit={() => {}}
          shortcuts={defaultShortcuts}
          fontSize={14}
        />
      </HeroUIProvider>
    ) : demoScene === 'ssh' ? (
      <SSHFixture />
    ) : (
      <Fixture />
    )}
  </AppearanceProvider>,
);
