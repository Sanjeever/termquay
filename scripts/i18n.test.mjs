import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const locales = new URL('../frontend/src/i18n/locales/', import.meta.url);
const read = (language, file) => JSON.parse(readFileSync(new URL(`${language}/${file}`, locales), 'utf8'));
const parameters = value => [...value.matchAll(/{{\s*([^},]+)(?:,[^}]+)?\s*}}/g)].map(match => match[1].trim()).sort();

test('bundled languages have complete namespaces, keys and interpolation parameters', () => {
  const english = readdirSync(fileURLToPath(new URL('en/', locales))).sort();
  assert.deepEqual(readdirSync(fileURLToPath(new URL('zh-CN/', locales))).sort(), english);
  for (const file of english) {
    const en = read('en', file), zh = read('zh-CN', file);
    assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort(), file);
    for (const [key, value] of Object.entries(en)) {
      assert.equal(typeof value, 'string', `${file}:${key}`);
      assert.ok(value.trim(), `${file}:${key} is empty`);
      assert.ok(zh[key].trim(), `${file}:${key} has no Chinese translation`);
      assert.deepEqual(parameters(zh[key]), parameters(value), `${file}:${key}`);
    }
  }
});
