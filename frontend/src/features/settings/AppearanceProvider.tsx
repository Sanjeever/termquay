import { errorMessage } from "../../lib/errors";
import { createContext, useContext, useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { appearanceKey, defaultAppearance, monoFonts, parseAppearance, uiFonts, type Appearance } from './appearance';
import { Window } from '@wailsio/runtime';
import i18n, { systemLanguages } from '../../i18n';
import { resolveLanguage } from '../../i18n/language';
import { SetLanguage } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';

const AppearanceContext = createContext<{ appearance: Appearance; dark: boolean; error: string; update(value: Appearance): void; beginPreview(): void; endPreview(): void } | undefined>(undefined);

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [initial] = useState(() => {
    try { return { appearance: parseAppearance(localStorage.getItem(appearanceKey)), error: '' }; }
    catch (error) { return { appearance: { ...defaultAppearance }, error: errorMessage(error) }; }
  });
  const [appearance, setAppearance] = useState(initial.appearance);
  const [preview, setPreview] = useState<Appearance>();
  const current = preview ?? appearance;
  const [error, setError] = useState(initial.error);
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);
  useLayoutEffect(() => {
    const changed = () => {
      const language = resolveLanguage(current.language, systemLanguages());
      void i18n.changeLanguage(language);
      document.documentElement.lang = language;
      SetLanguage(language).catch(error => setError(i18n.t('syncLanguageFailed', { error: errorMessage(error) })));
    };
    changed();
    window.addEventListener('languagechange', changed);
    return () => window.removeEventListener('languagechange', changed);
  }, [current.language]);
  useEffect(() => { const restore = () => { try { setAppearance(parseAppearance(localStorage.getItem(appearanceKey))); setError(''); } catch (e) { setError(errorMessage(e)); } }; window.addEventListener('termquay:portable-restored', restore); return () => window.removeEventListener('termquay:portable-restored', restore); }, []);
  const dark = current.theme === 'system' ? systemDark : current.theme === 'dark';
  useEffect(() => { Window.SetZoom(current.uiZoom).catch(error => setError(`界面缩放失败：${errorMessage(error)}`)); }, [current.uiZoom]);
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const changed = () => setSystemDark(media.matches);
    media.addEventListener('change', changed); changed();
    return () => media.removeEventListener('change', changed);
  }, []);
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', dark); root.classList.toggle('light', !dark);
    root.style.setProperty('--font-ui', uiFonts[current.uiFont]);
    root.style.setProperty('--font-mono', monoFonts[current.monoFont]);
  }, [current, dark]);
  function update(value: Appearance) {
    if (preview) { setPreview(value); return; }
    try { localStorage.setItem(appearanceKey, JSON.stringify(value)); setAppearance(value); setError(''); window.dispatchEvent(new Event('termquay:portable-changed')); }
    catch (error) { setError(errorMessage(error)); }
  }
  return <AppearanceContext.Provider value={{ appearance: current, dark, error, update, beginPreview: () => setPreview({ ...appearance }), endPreview: () => setPreview(undefined) }}>{children}</AppearanceContext.Provider>;
}

export function useAppearance() {
  const value = useContext(AppearanceContext);
  if (!value) throw new Error('外观上下文尚未初始化');
  return value;
}
