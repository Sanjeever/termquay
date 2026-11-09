import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import i18n from './index.ts';
import { message } from './messages.ts';
import { errorMessage, errorCode } from '../lib/errors.ts';

test('retained message descriptors follow language changes and preserve diagnostics', async () => {
  const error = message('syncLanguageFailed', { error: new Error('native diagnostic') });
  await i18n.changeLanguage('en');
  assert.equal(errorMessage(error), 'Could not update the native language: native diagnostic');
  await i18n.changeLanguage('zh-CN');
  assert.equal(errorMessage(error), '更新原生界面语言失败：native diagnostic');
  const external = new Error('remote diagnostic', { cause: { code: 'READ_CONFLICT', steps: ['connect'] } });
  assert.equal(errorCode(external), 'READ_CONFLICT');
  assert.equal(errorMessage(external), 'remote diagnostic');
  await i18n.changeLanguage('en');
});
