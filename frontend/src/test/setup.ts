import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import i18n from '../i18n';

afterEach(async () => {
  cleanup();
  localStorage.clear();
  await i18n.changeLanguage('en');
});
