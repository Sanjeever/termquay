import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en/common.json' with { type: 'json' };
import zhCN from './locales/zh-CN/common.json' with { type: 'json' };
import enSettings from './locales/en/settings.json' with { type: 'json' };
import zhSettings from './locales/zh-CN/settings.json' with { type: 'json' };
import { resolveLanguage, type LanguagePreference } from './language.ts';

function initialPreference(): LanguagePreference {
  if (typeof localStorage === 'undefined') return 'auto';
  try {
    const preference = JSON.parse(localStorage.getItem('termquay.appearance') || '{}').language;
    return preference === 'en' || preference === 'zh-CN' ? preference : 'auto';
  } catch {
    // The appearance provider displays invalid or inaccessible settings.
    return 'auto';
  }
}

export function systemLanguages(): readonly string[] {
  return typeof navigator === 'undefined' ? [] : navigator.languages?.length ? navigator.languages : [navigator.language];
}

void i18n.use(initReactI18next).init({
  resources: { en: { common: en, settings: enSettings }, 'zh-CN': { common: zhCN, settings: zhSettings } },
  lng: resolveLanguage(initialPreference(), systemLanguages()),
  fallbackLng: 'en', supportedLngs: ['en', 'zh-CN'], load: 'currentOnly',
  defaultNS: 'common', initAsync: false,
  interpolation: { escapeValue: false }, react: { useSuspense: false },
});

export function currentLocale() { return i18n.resolvedLanguage === 'zh-CN' ? 'zh-CN' : 'en'; }
export const t = i18n.t.bind(i18n);
export default i18n;
