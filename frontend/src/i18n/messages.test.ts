import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import i18n from './index.ts';
import { message } from './messages.ts';
import { errorMessage, errorCode, eventError } from '../lib/errors.ts';

test('retained message descriptors follow language changes and preserve diagnostics', async () => {
  const error = message('syncLanguageFailed', { error: new Error('native diagnostic') });
  await i18n.changeLanguage('en');
  assert.equal(errorMessage(error), 'Could not update the native language: native diagnostic');
  await i18n.changeLanguage('zh-CN');
  assert.equal(errorMessage(error), '更新原生界面语言失败：native diagnostic');
  const external = Object.assign(new Error('remote diagnostic'), {
    cause: { code: 'READ_CONFLICT', steps: ['connect'] },
  });
  assert.equal(errorCode(external), 'READ_CONFLICT');
  assert.equal(errorMessage(external), 'remote diagnostic');
  await i18n.changeLanguage('en');
});

test('event diagnostics translate nested causes without changing raw protocol fields', async () => {
  const event = {
    error: 'original diagnostic',
    error_message: {
      message: 'original diagnostic',
      messageCode: 'backend:couldNotUnlockWithMasterPassword',
      parameters: { value1: { message: 'authentication failed' } },
    },
  };
  const retained = eventError(event);
  await i18n.changeLanguage('en');
  assert.equal(
    errorMessage(retained),
    'Could not unlock with master password: authentication failed',
  );
  await i18n.changeLanguage('zh-CN');
  assert.equal(errorMessage(retained), '主密码解锁失败: authentication failed');
  assert.equal(event.error, 'original diagnostic');
  assert.equal(
    errorMessage({ causes: [retained, { message: 'remote output' }] }),
    '主密码解锁失败: authentication failed\nremote output',
  );
  await i18n.changeLanguage('en');
});

test('English counts use singular/plural while Chinese keeps its own wording', async () => {
  await i18n.changeLanguage('en');
  assert.equal(i18n.t('workspaceCount', { count: 1 }), '1 workspace');
  assert.equal(i18n.t('workspaceCount', { count: 2 }), '2 workspaces');
  await i18n.changeLanguage('zh-CN');
  assert.equal(i18n.t('workspaceCount', { count: 1 }), '1 个工作区');
  assert.equal(i18n.t('workspaceCount', { count: 2 }), '2 个工作区');
  await i18n.changeLanguage('en');
});
