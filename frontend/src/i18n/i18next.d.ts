import 'i18next';
import common from './locales/en/common.json';
import settings from './locales/en/settings.json';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common';
    resources: { common: typeof common; settings: typeof settings };
  }
}
