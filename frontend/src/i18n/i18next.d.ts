import status from './locales/en/status.json';
import backend from './locales/en/backend.json';
import 'i18next';
import common from './locales/en/common.json';
import settings from './locales/en/settings.json';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common';
    resources: { common: typeof common; status: typeof status; backend: typeof backend; settings: typeof settings };
  }
}
