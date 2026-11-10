import { useState } from 'react';
import ReactDOM from 'react-dom/client';
import { HeroUIProvider } from '@heroui/react';
import { useTranslation } from 'react-i18next';
import { AppearanceProvider, useAppearance } from '../src/features/settings/AppearanceProvider';
import { appearanceKey, defaultAppearance } from '../src/features/settings/appearance';
import TitleBar from '../src/components/layout/TitleBar';
import WorkspaceTabs from '../src/components/layout/WorkspaceTabs';
import LocalTerminalLauncher from '../src/features/terminal/LocalTerminalLauncher';
import CodeEditor from '../src/features/files/CodeEditor';
import type { EditorFormat } from '../src/features/files/editorFormat';
import '../src/style.css';

localStorage.setItem(
  appearanceKey,
  JSON.stringify({ ...defaultAppearance, language: 'en', theme: 'light' }),
);

function Fixture() {
  const { i18n } = useTranslation();
  const { appearance, update } = useAppearance();
  const [count, setCount] = useState(1);
  const [active, setActive] = useState('w0');
  const [actions, setActions] = useState({ created: 0, switched: 0 });
  const [content, setContent] = useState('original');
  const [format, setFormat] = useState<EditorFormat>({
    encoding: 'UTF-8',
    line_ending: 'LF',
    bom: false,
  });
  const items = Array.from({ length: count }, (_, index) => ({
    id: `w${index}`,
    name: `Shell ${index + 1}`,
  }));
  function tabs(value: number) {
    setCount(value);
    setActive(value ? `w${value - 1}` : '');
  }
  return (
    <HeroUIProvider
      locale={i18n.resolvedLanguage === 'en' ? 'en-US' : 'zh-CN'}
      disableAnimation
      disableRipple
    >
      <main className="app-shell">
        <TitleBar
          onError={(error) => {
            throw error;
          }}
          tabs={
            <WorkspaceTabs
              items={items}
              active={active}
              onSelect={setActive}
              onClose={() => {}}
              onRename={() => {}}
              onMove={() => {}}
              onNew={() => setActions((value) => ({ ...value, created: value.created + 1 }))}
              newAction={
                <LocalTerminalLauncher
                  compact
                  shells={[{ id: 'shell', name: 'Shell' }]}
                  recent={['/work/project', '/work/another']}
                  disabled={false}
                  onOpen={() => setActions((value) => ({ ...value, created: value.created + 1 }))}
                  onChooseDirectory={() => {}}
                />
              }
              onSearch={() => setActions((value) => ({ ...value, switched: value.switched + 1 }))}
            />
          }
          tools={
            <button className="icon-button" aria-label="Settings">
              Settings
            </button>
          }
        />
        <div className="button-row">
          <button onClick={() => tabs(0)}>No workspaces</button>
          <button onClick={() => tabs(1)}>One workspace</button>
          <button onClick={() => tabs(20)}>Many workspaces</button>
          <button onClick={() => update({ ...appearance, language: 'zh-CN' })}>
            Switch language
          </button>
          <button onClick={() => update({ ...appearance, theme: 'dark' })}>Switch theme</button>
          <button
            onClick={() =>
              update({
                ...appearance,
                monoFont: 'custom',
                customMonoFont: 'FiraCode Nerd Font Mono',
              })
            }
          >
            Use custom font
          </button>
          <output aria-label="Action counts">
            {actions.created},{actions.switched}
          </output>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          <CodeEditor
            path="/tmp/notes.txt"
            content={content}
            format={format}
            visible
            dirty={content !== 'original'}
            saving={false}
            demo
            focusOnShow={false}
            onChange={(value, format) => {
              setContent(value);
              setFormat(format);
            }}
            onSave={() => {}}
            onReload={() => {}}
            onDownload={() => {}}
          />
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
