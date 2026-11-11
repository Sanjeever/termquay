import SelectControl from '../../components/SelectControl';
import { t as translate } from '../../i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { Button, Switch } from '@heroui/react';
import { useAppearance } from './AppearanceProvider';
import {
  defaultAppearance,
  monospaceFont,
  terminalPalettes,
  terminalTheme,
  uiZoomLevels,
  type Appearance,
} from './appearance';

export default function AppearanceSettings({
  fontSize,
  onFontSize,
  section = 'appearance',
  demo = false,
  onDemo,
  demoDisabled = false,
}: {
  fontSize: number;
  onFontSize(value: number): void;
  section?: 'appearance' | 'terminal';
  demo?: boolean;
  onDemo?(): void;
  demoDisabled?: boolean;
}) {
  useTranslation();
  const { appearance, dark, error, update } = useAppearance();
  const colors = terminalTheme(appearance.terminalPalette, dark);
  return (
    <div className="settings-section">
      <h2>
        {section === 'appearance'
          ? translate('settings:appearance')
          : translate('settings:terminalAndEditor')}
      </h2>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {section === 'appearance' && (
        <div className="settings-row">
          <label htmlFor="appearance-language">{translate('language')}</label>
          <SelectControl
            id="appearance-language"
            value={appearance.language}
            onChange={(event) =>
              update({ ...appearance, language: event.target.value as Appearance['language'] })
            }
          >
            <option value="auto">{translate('system')}</option>
            <option value="zh-CN">简体中文</option>
            <option value="en">English</option>
          </SelectControl>
        </div>
      )}
      {section === 'appearance' ? (
        <div className="settings-group">
          <div className="settings-row">
            <label htmlFor="appearance-theme">{translate('settings:theme')}</label>
            <SelectControl
              id="appearance-theme"
              value={appearance.theme}
              onChange={(e) =>
                update({ ...appearance, theme: e.target.value as Appearance['theme'] })
              }
            >
              <option value="system">{translate('settings:followSystem')}</option>
              <option value="light">{translate('settings:light')}</option>
              <option value="dark">{translate('settings:dark')}</option>
            </SelectControl>
          </div>
          <div className="settings-row">
            <label htmlFor="appearance-ui-font">{translate('settings:interfaceFont')}</label>
            <SelectControl
              id="appearance-ui-font"
              value={appearance.uiFont}
              onChange={(e) =>
                update({ ...appearance, uiFont: e.target.value as Appearance['uiFont'] })
              }
            >
              <option value="system">{translate('settings:systemDefault')}</option>
              <option value="yahei">{translate('settings:microsoftYaHei')}</option>
              <option value="pingfang">{translate('settings:pingFangSC')}</option>
            </SelectControl>
          </div>
          <div className="settings-row">
            <label htmlFor="appearance-ui-zoom">{translate('settings:interfaceZoom')}</label>
            <SelectControl
              id="appearance-ui-zoom"
              value={String(appearance.uiZoom)}
              onChange={(event) => update({ ...appearance, uiZoom: Number(event.target.value) })}
            >
              {uiZoomLevels.map((zoom) => (
                <option key={zoom} value={String(zoom)}>{`${Math.round(zoom * 100)}%`}</option>
              ))}
            </SelectControl>
          </div>
          {onDemo && (
            <div className="settings-row">
              <span id="appearance-demo-label">{translate('settings:demoMode')}</span>
              <Switch
                size="sm"
                aria-labelledby="appearance-demo-label"
                isSelected={demo}
                isDisabled={demoDisabled}
                onValueChange={onDemo}
              />
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="settings-group">
            <div className="settings-row">
              <label htmlFor="appearance-mono-font">{translate('settings:monospaceFont')}</label>
              <SelectControl
                id="appearance-mono-font"
                title={translate('settings:usesLocalFontsWithFallbacksForFontsThat')}
                value={appearance.monoFont}
                onChange={(e) =>
                  update({ ...appearance, monoFont: e.target.value as Appearance['monoFont'] })
                }
              >
                <option value="system">{translate('settings:systemMonospace')}</option>
                <option value="cascadia">Cascadia Mono</option>
                <option value="consolas">Consolas</option>
                <option value="jetbrains">JetBrains Mono</option>
                <option value="custom">{translate('settings:customFont')}</option>
              </SelectControl>
            </div>
            <div className="settings-row">
              <label htmlFor="local-file-editor">{translate('settings:localFileEditor')}</label>
              <SelectControl
                id="local-file-editor"
                value={appearance.localEditor}
                onChange={(event) =>
                  update({
                    ...appearance,
                    localEditor: event.target.value as Appearance['localEditor'],
                  })
                }
              >
                <option value="vscode">Visual Studio Code</option>
                <option value="vscode-insiders">Visual Studio Code Insiders</option>
              </SelectControl>
            </div>
            {appearance.monoFont === 'custom' && (
              <div className="settings-row">
                <label htmlFor="appearance-custom-mono-font">
                  {translate('settings:fontFamily')}
                </label>
                <input
                  id="appearance-custom-mono-font"
                  className="settings-font-input"
                  value={appearance.customMonoFont}
                  placeholder="JetBrainsMono Nerd Font Mono"
                  title={translate('settings:installedFontFamily')}
                  spellCheck={false}
                  onChange={(event) =>
                    update({ ...appearance, customMonoFont: event.target.value })
                  }
                />
              </div>
            )}
            <div className="settings-row">
              <label htmlFor="terminal-font-size">{translate('settings:terminalFontSize')}</label>
              <div className="button-row">
                <input
                  id="terminal-font-size"
                  type="range"
                  min="11"
                  max="24"
                  value={fontSize}
                  onChange={(e) => onFontSize(Number(e.target.value))}
                />
                <output htmlFor="terminal-font-size">{fontSize}px</output>
              </div>
            </div>
            <div className="settings-row">
              <label htmlFor="local-terminal-renderer">
                {translate('settings:localTerminalRenderer')}
              </label>
              <SelectControl
                id="local-terminal-renderer"
                value={appearance.localTerminalRenderer}
                onChange={(event) =>
                  update({
                    ...appearance,
                    localTerminalRenderer: event.target
                      .value as Appearance['localTerminalRenderer'],
                  })
                }
              >
                <option value="dom">{translate('settings:basicRenderer')}</option>
                <option value="webgl">WebGL</option>
              </SelectControl>
            </div>
            <div className="settings-row">
              <label htmlFor="terminal-renderer">{translate('settings:terminalRenderer')}</label>
              <SelectControl
                id="terminal-renderer"
                value={appearance.terminalRenderer}
                onChange={(event) =>
                  update({
                    ...appearance,
                    terminalRenderer: event.target.value as Appearance['terminalRenderer'],
                  })
                }
              >
                <option value="dom">{translate('settings:basicRenderer')}</option>
                <option value="webgl">{translate('settings:webGLExperimental')}</option>
              </SelectControl>
            </div>
          </div>
          <div className="settings-group">
            <div className="settings-row">
              <span id="appearance-copy-on-select-label">{translate('settings:copyOnSelect')}</span>
              <Switch
                size="sm"
                aria-labelledby="appearance-copy-on-select-label"
                isSelected={appearance.terminalCopyOnSelect}
                onValueChange={(value) => update({ ...appearance, terminalCopyOnSelect: value })}
              />
            </div>
            <div className="settings-row">
              <label htmlFor="appearance-terminal-palette">
                {translate('settings:terminalColors')}
              </label>
              <SelectControl
                id="appearance-terminal-palette"
                value={appearance.terminalPalette}
                onChange={(e) =>
                  update({
                    ...appearance,
                    terminalPalette: e.target.value as Appearance['terminalPalette'],
                  })
                }
              >
                {Object.entries(terminalPalettes).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </SelectControl>
            </div>
            <div className="settings-row">
              <span id="appearance-highlight-label">
                {translate('settings:logLevelHighlighting')}
              </span>
              <Switch
                size="sm"
                aria-labelledby="appearance-highlight-label"
                isSelected={appearance.terminalLogHighlight}
                onValueChange={(value) => update({ ...appearance, terminalLogHighlight: value })}
              />
            </div>
          </div>
          <pre
            className="terminal-preview"
            aria-label={translate('settings:terminalColorPreview')}
            style={{
              fontSize,
              fontFamily: monospaceFont(appearance),
              background: colors.background,
              color: colors.foreground,
            }}
          >
            <span style={{ color: colors.green }}>user@server</span>
            {':~$ '}
            <span style={{ color: colors.blue }}>tail -f app.log</span>
            {'\n'}
            <span style={{ color: appearance.terminalLogHighlight ? colors.cyan : undefined }}>
              INFO
            </span>
            {translate('settings:serviceStarted')}
            <span style={{ color: appearance.terminalLogHighlight ? colors.yellow : undefined }}>
              WARN
            </span>
            {translate('settings:responseTimedOut')}
            <span style={{ color: appearance.terminalLogHighlight ? colors.red : undefined }}>
              ERROR
            </span>
            {translate('settings:connectionFailed')}
          </pre>
        </>
      )}
      <Button
        size="sm"
        variant="light"
        onPress={() => {
          if (section === 'appearance')
            update({
              ...appearance,
              theme: defaultAppearance.theme,
              uiFont: defaultAppearance.uiFont,
              uiZoom: defaultAppearance.uiZoom,
            });
          else {
            update({
              ...appearance,
              monoFont: defaultAppearance.monoFont,
              customMonoFont: defaultAppearance.customMonoFont,
              terminalPalette: defaultAppearance.terminalPalette,
              terminalLogHighlight: defaultAppearance.terminalLogHighlight,
              terminalCopyOnSelect: defaultAppearance.terminalCopyOnSelect,
              terminalRenderer: defaultAppearance.terminalRenderer,
              localTerminalRenderer: defaultAppearance.localTerminalRenderer,
              localEditor: defaultAppearance.localEditor,
            });
            onFontSize(14);
          }
        }}
      >
        {translate('settings:restoreDefaults')}
      </Button>
    </div>
  );
}
