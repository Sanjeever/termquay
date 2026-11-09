import { t } from '../../i18n/index.ts';
import { message } from '../../i18n/messages.ts';
import type { LanguagePreference } from '../../i18n/language';
export const appearanceKey = 'termquay.appearance';
export const terminalPalettes = { get theme() { return t('settings:followTheme'); }, get dark() { return t('settings:classicDark'); }, get light() { return t('settings:lightPaper'); }, 'one-dark': 'One Dark', 'tokyo-night': 'Tokyo Night' };
export const uiZoomLevels = [1, 1.1, 1.25, 1.5, 1.75, 2];
export type Appearance = { language: LanguagePreference; theme: 'dark' | 'light' | 'system'; uiFont: 'system' | 'yahei' | 'pingfang'; uiZoom: number; monoFont: 'system' | 'cascadia' | 'consolas' | 'jetbrains'; terminalPalette: keyof typeof terminalPalettes; terminalLogHighlight: boolean; terminalRenderer: 'dom'|'webgl' };
export const defaultAppearance: Appearance = { language: 'auto', theme: 'system', uiFont: 'system', uiZoom: 1, monoFont: 'system', terminalPalette: 'theme', terminalLogHighlight: true, terminalRenderer: 'dom' };
export const uiFonts = {
  system: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei UI", "PingFang SC", sans-serif',
  yahei: '"Microsoft YaHei UI", "Microsoft YaHei", sans-serif',
  pingfang: '"PingFang SC", -apple-system, sans-serif',
};
export const monoFonts = {
  system: '"Cascadia Mono", "SFMono-Regular", Consolas, "Liberation Mono", "Microsoft YaHei", monospace',
  cascadia: '"Cascadia Mono", "SFMono-Regular", Consolas, monospace',
  consolas: 'Consolas, "SFMono-Regular", monospace',
  jetbrains: '"JetBrains Mono", "SFMono-Regular", Consolas, monospace',
};

export function parseAppearance(value: string | null): Appearance {
  if (!value) return { ...defaultAppearance };
  const settings = JSON.parse(value);
  if (!settings || !['dark', 'light', 'system'].includes(settings.theme) || !Object.prototype.hasOwnProperty.call(uiFonts, settings.uiFont) || !Object.prototype.hasOwnProperty.call(monoFonts, settings.monoFont) || !Object.prototype.hasOwnProperty.call(terminalPalettes, settings.terminalPalette) || (settings.terminalLogHighlight !== undefined && typeof settings.terminalLogHighlight !== 'boolean')) throw message('settings:invalidAppearanceSettingsResetThem');
  if (settings.uiZoom !== undefined && !uiZoomLevels.includes(settings.uiZoom)) throw message('settings:invalidInterfaceZoomSettings');
  if (settings.terminalRenderer !== undefined && !['dom','webgl'].includes(settings.terminalRenderer)) throw message('settings:invalidTerminalRendererSettings');
  if (settings.language !== undefined && !['auto', 'zh-CN', 'en'].includes(settings.language)) throw message('invalidLanguage');
  return { language: settings.language ?? 'auto', theme: settings.theme, uiFont: settings.uiFont, uiZoom: settings.uiZoom ?? defaultAppearance.uiZoom, monoFont: settings.monoFont, terminalPalette: settings.terminalPalette, terminalLogHighlight: settings.terminalLogHighlight ?? defaultAppearance.terminalLogHighlight, terminalRenderer: settings.terminalRenderer ?? defaultAppearance.terminalRenderer };
}

export function terminalTheme(palette: Appearance['terminalPalette'], dark: boolean) {
  if (palette === 'one-dark') return {
    background: '#282c34', foreground: '#abb2bf', cursor: '#61afef', selectionBackground: '#3e4451',
    black: '#282c34', red: '#e06c75', green: '#98c379', yellow: '#e5c07b', blue: '#61afef', magenta: '#c678dd', cyan: '#56b6c2', white: '#abb2bf',
    brightBlack: '#7f848e', brightRed: '#f08c95', brightGreen: '#b4d88e', brightYellow: '#f0d399', brightBlue: '#82c7f5', brightMagenta: '#d89af0', brightCyan: '#79cdd7', brightWhite: '#ffffff',
  };
  if (palette === 'tokyo-night') return {
    background: '#1a1b26', foreground: '#c0caf5', cursor: '#c0caf5', selectionBackground: '#33467c',
    black: '#15161e', red: '#f7768e', green: '#9ece6a', yellow: '#e0af68', blue: '#7aa2f7', magenta: '#bb9af7', cyan: '#7dcfff', white: '#a9b1d6',
    brightBlack: '#737aa2', brightRed: '#ff9eaf', brightGreen: '#b9e38b', brightYellow: '#f0c98a', brightBlue: '#9bbcff', brightMagenta: '#d1b7ff', brightCyan: '#a4e1ff', brightWhite: '#c0caf5',
  };
  const useDark = palette === 'theme' ? dark : palette === 'dark';
  return useDark ? {
    background: '#191a1c', foreground: '#eeeef0', cursor: '#91b5ff', selectionBackground: '#334969',
    black: '#282c34', red: '#e88b88', green: '#8ed6b2', yellow: '#e8c484', blue: '#8ba7ff', magenta: '#cf9fe8', cyan: '#7ed1d9', white: '#d7dce5',
    brightBlack: '#808a9d', brightRed: '#ffaaaa', brightGreen: '#b0eacb', brightYellow: '#f4d9a5', brightBlue: '#b3c5ff', brightMagenta: '#e4bcf5', brightCyan: '#a6e5ec', brightWhite: '#ffffff',
  } : {
    background: '#fcfcfd', foreground: '#242529', cursor: '#245fd5', selectionBackground: '#dce7fb',
    black: '#202633', red: '#a52131', green: '#22613f', yellow: '#795400', blue: '#3456bc', magenta: '#793c94', cyan: '#12646c', white: '#677183',
    brightBlack: '#555f70', brightRed: '#b72b3b', brightGreen: '#287047', brightYellow: '#856000', brightBlue: '#4263c5', brightMagenta: '#8847a3', brightCyan: '#18747c', brightWhite: '#909aac',
  };
}
