export const appearanceKey = 'termquay.appearance';
export type Appearance = { theme: 'dark' | 'light' | 'system'; uiFont: 'system' | 'yahei' | 'pingfang'; monoFont: 'system' | 'cascadia' | 'consolas' | 'jetbrains'; terminalPalette: 'theme' | 'dark' | 'light' };
export const defaultAppearance: Appearance = { theme: 'dark', uiFont: 'system', monoFont: 'system', terminalPalette: 'theme' };
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
  if (!settings || !['dark', 'light', 'system'].includes(settings.theme) || !Object.prototype.hasOwnProperty.call(uiFonts, settings.uiFont) || !Object.prototype.hasOwnProperty.call(monoFonts, settings.monoFont) || !['theme', 'dark', 'light'].includes(settings.terminalPalette)) throw new Error('外观设置无效，请复位');
  return { theme: settings.theme, uiFont: settings.uiFont, monoFont: settings.monoFont, terminalPalette: settings.terminalPalette };
}

export function terminalTheme(palette: Appearance['terminalPalette'], dark: boolean) {
  const useDark = palette === 'theme' ? dark : palette === 'dark';
  return useDark ? {
    background: '#101216', foreground: '#e6e9ef', cursor: '#8ba7ff', selectionBackground: '#354462',
    black: '#282c34', red: '#e88b88', green: '#8ed6b2', yellow: '#e8c484', blue: '#8ba7ff', magenta: '#cf9fe8', cyan: '#7ed1d9', white: '#d7dce5',
    brightBlack: '#808a9d', brightRed: '#ffaaaa', brightGreen: '#b0eacb', brightYellow: '#f4d9a5', brightBlue: '#b3c5ff', brightMagenta: '#e4bcf5', brightCyan: '#a6e5ec', brightWhite: '#ffffff',
  } : {
    background: '#f8f9fc', foreground: '#202633', cursor: '#3456bc', selectionBackground: '#ccdaff',
    black: '#202633', red: '#a52131', green: '#22613f', yellow: '#795400', blue: '#3456bc', magenta: '#793c94', cyan: '#12646c', white: '#677183',
    brightBlack: '#555f70', brightRed: '#b72b3b', brightGreen: '#287047', brightYellow: '#856000', brightBlue: '#4263c5', brightMagenta: '#8847a3', brightCyan: '#18747c', brightWhite: '#909aac',
  };
}
