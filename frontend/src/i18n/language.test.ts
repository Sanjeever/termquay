import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import { resolveLanguage } from './language.ts';

test('language matching respects ordered supported preferences and explicit scripts', () => {
  assert.equal(resolveLanguage('auto', ['fr-FR', 'zh-CN', 'en']), 'zh-CN');
  assert.equal(resolveLanguage('auto', ['en-GB', 'zh-CN']), 'en');
  for (const language of ['zh', 'zh-CN', 'zh-SG', 'zh-Hans', 'zh-Hans-US', 'ZH_cn'])
    assert.equal(resolveLanguage('auto', [language]), 'zh-CN');
  for (const language of ['zh-TW', 'zh-HK', 'zh-Hant', 'ja', 'fr'])
    assert.equal(resolveLanguage('auto', [language]), 'en');
  assert.equal(resolveLanguage('auto', []), 'en');
  assert.equal(resolveLanguage('en', ['zh-CN']), 'en');
  assert.equal(resolveLanguage('zh-CN', ['en']), 'zh-CN');
});
