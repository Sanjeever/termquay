import SelectControl from '../../components/SelectControl';
import { Button } from '@heroui/react';
import { useAppearance } from './AppearanceProvider';
import { defaultAppearance, monoFonts, terminalTheme, type Appearance } from './appearance';

export default function AppearanceSettings({ fontSize, onFontSize }: { fontSize: number; onFontSize(value: number): void }) {
  const { appearance, dark, error, update } = useAppearance();
  const colors = terminalTheme(appearance.terminalPalette, dark);
  return <div className="settings-section"><h2>外观与终端</h2>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="settings-row"><label htmlFor="appearance-theme">主题</label><SelectControl id="appearance-theme" value={appearance.theme} onChange={e => update({ ...appearance, theme: e.target.value as Appearance['theme'] })}><option value="dark">深色</option><option value="light">浅色</option><option value="system">跟随系统</option></SelectControl></div>
    <div className="settings-row"><label htmlFor="appearance-ui-font">界面字体</label><SelectControl id="appearance-ui-font" value={appearance.uiFont} onChange={e => update({ ...appearance, uiFont: e.target.value as Appearance['uiFont'] })}><option value="system">系统默认</option><option value="yahei">微软雅黑</option><option value="pingfang">苹方</option></SelectControl></div>
    <div className="settings-row"><label htmlFor="appearance-mono-font">终端与编辑器字体</label><SelectControl id="appearance-mono-font" title="使用本机字体，未安装时使用后备字体" value={appearance.monoFont} onChange={e => update({ ...appearance, monoFont: e.target.value as Appearance['monoFont'] })}><option value="system">系统等宽</option><option value="cascadia">Cascadia Mono</option><option value="consolas">Consolas</option><option value="jetbrains">JetBrains Mono</option></SelectControl></div>
    <div className="settings-row"><label htmlFor="terminal-font-size">终端字号</label><div className="button-row"><input id="terminal-font-size" type="range" min="11" max="24" value={fontSize} onChange={e => onFontSize(Number(e.target.value))} /><output htmlFor="terminal-font-size">{fontSize}px</output></div></div>
    <div className="settings-row"><label htmlFor="appearance-terminal-palette">终端配色</label><SelectControl id="appearance-terminal-palette" value={appearance.terminalPalette} onChange={e => update({ ...appearance, terminalPalette: e.target.value as Appearance['terminalPalette'] })}><option value="theme">跟随主题</option><option value="dark">经典深色</option><option value="light">浅色纸张</option></SelectControl></div>
    <pre className="terminal-preview" aria-label="终端配色预览" style={{ fontSize, fontFamily: monoFonts[appearance.monoFont], background: colors.background, color: colors.foreground }}><span style={{ color: colors.green }}>user@server</span><span>:~$ </span><span style={{ color: colors.blue }}>ls</span></pre>
    <Button size="sm" variant="bordered" onPress={() => { update({ ...defaultAppearance }); onFontSize(14); }}>复位外观</Button>
  </div>;
}
