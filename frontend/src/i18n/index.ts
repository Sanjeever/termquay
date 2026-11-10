import enstatus from './locales/en/status.json' with { type: 'json' };
import zhstatus from './locales/zh-CN/status.json' with { type: 'json' };
import enbackend from './locales/en/backend.json' with { type: 'json' };
import zhbackend from './locales/zh-CN/backend.json' with { type: 'json' };
import enterminal from './locales/en/terminal.json' with { type: 'json' };
import zhterminal from './locales/zh-CN/terminal.json' with { type: 'json' };
import enfiles from './locales/en/files.json' with { type: 'json' };
import zhfiles from './locales/zh-CN/files.json' with { type: 'json' };
import enworkspaces from './locales/en/workspaces.json' with { type: 'json' };
import zhworkspaces from './locales/zh-CN/workspaces.json' with { type: 'json' };
import entunnels from './locales/en/tunnels.json' with { type: 'json' };
import zhtunnels from './locales/zh-CN/tunnels.json' with { type: 'json' };
import enrdp from './locales/en/rdp.json' with { type: 'json' };
import zhrdp from './locales/zh-CN/rdp.json' with { type: 'json' };
import enmonitor from './locales/en/monitor.json' with { type: 'json' };
import zhmonitor from './locales/zh-CN/monitor.json' with { type: 'json' };
import enlogs from './locales/en/logs.json' with { type: 'json' };
import zhlogs from './locales/zh-CN/logs.json' with { type: 'json' };
import endocker from './locales/en/docker.json' with { type: 'json' };
import zhdocker from './locales/zh-CN/docker.json' with { type: 'json' };
import endemo from './locales/en/demo.json' with { type: 'json' };
import zhdemo from './locales/zh-CN/demo.json' with { type: 'json' };
import enconnections from './locales/en/connections.json' with { type: 'json' };
import zhconnections from './locales/zh-CN/connections.json' with { type: 'json' };
import enai from './locales/en/ai.json' with { type: 'json' };
import zhai from './locales/zh-CN/ai.json' with { type: 'json' };
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
  return typeof navigator === 'undefined'
    ? []
    : navigator.languages?.length
      ? navigator.languages
      : [navigator.language];
}

void i18n.use(initReactI18next).init({
  resources: {
    en: {
      common: en,
      status: enstatus,
      backend: enbackend,
      terminal: enterminal,
      files: enfiles,
      workspaces: enworkspaces,
      tunnels: entunnels,
      rdp: enrdp,
      monitor: enmonitor,
      logs: enlogs,
      docker: endocker,
      demo: endemo,
      connections: enconnections,
      ai: enai,
      settings: enSettings,
    },
    'zh-CN': {
      common: zhCN,
      status: zhstatus,
      backend: zhbackend,
      terminal: zhterminal,
      files: zhfiles,
      workspaces: zhworkspaces,
      tunnels: zhtunnels,
      rdp: zhrdp,
      monitor: zhmonitor,
      logs: zhlogs,
      docker: zhdocker,
      demo: zhdemo,
      connections: zhconnections,
      ai: zhai,
      settings: zhSettings,
    },
  },
  lng: resolveLanguage(initialPreference(), systemLanguages()),
  fallbackLng: 'en',
  supportedLngs: ['en', 'zh-CN'],
  load: 'currentOnly',
  defaultNS: 'common',
  initAsync: false,
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

export function currentLocale() {
  return i18n.resolvedLanguage === 'zh-CN' ? 'zh-CN' : 'en';
}
export const t = i18n.t.bind(i18n);
export default i18n;
