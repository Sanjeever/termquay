import { createContext, useContext, useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { appearanceKey, defaultAppearance, monoFonts, parseAppearance, uiFonts, type Appearance } from './appearance';
import { Window } from '@wailsio/runtime';

const AppearanceContext = createContext<{ appearance: Appearance; dark: boolean; error: string; update(value: Appearance): void } | undefined>(undefined);

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [initial] = useState(() => {
    try { return { appearance: parseAppearance(localStorage.getItem(appearanceKey)), error: '' }; }
    catch (error) { return { appearance: { ...defaultAppearance }, error: String(error) }; }
  });
  const [appearance, setAppearance] = useState(initial.appearance);
  const [error, setError] = useState(initial.error);
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => { const restore = () => { try { setAppearance(parseAppearance(localStorage.getItem(appearanceKey))); setError(''); } catch (e) { setError(String(e)); } }; window.addEventListener('termquay:portable-restored', restore); return () => window.removeEventListener('termquay:portable-restored', restore); }, []);
  const dark = appearance.theme === 'system' ? systemDark : appearance.theme === 'dark';
  useEffect(() => { Window.SetZoom(appearance.uiZoom).catch(error => setError(`界面缩放失败：${String(error)}`)); }, [appearance.uiZoom]);
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const changed = () => setSystemDark(media.matches);
    media.addEventListener('change', changed); changed();
    return () => media.removeEventListener('change', changed);
  }, []);
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', dark); root.classList.toggle('light', !dark);
    root.style.setProperty('--font-ui', uiFonts[appearance.uiFont]);
    root.style.setProperty('--font-mono', monoFonts[appearance.monoFont]);
  }, [appearance, dark]);
  function update(value: Appearance) {
    try { localStorage.setItem(appearanceKey, JSON.stringify(value)); setAppearance(value); setError(''); window.dispatchEvent(new Event('termquay:portable-changed')); }
    catch (error) { setError(String(error)); }
  }
  return <AppearanceContext.Provider value={{ appearance, dark, error, update }}>{children}</AppearanceContext.Provider>;
}

export function useAppearance() {
  const value = useContext(AppearanceContext);
  if (!value) throw new Error('外观上下文尚未初始化');
  return value;
}
