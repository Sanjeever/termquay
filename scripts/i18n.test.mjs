import { test } from 'node:test';
import assert from 'node:assert/strict';
import { globSync, readFileSync, readdirSync } from 'node:fs';
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
      assert.equal(/\p{Script=Han}/u.test(value), false, `${file}:${key} contains untranslated Chinese`);
      assert.deepEqual(parameters(zh[key]), parameters(value), `${file}:${key}`);
    }
  }
});

test('static UI and backend message references exist in bundled English resources', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const namespaces = Object.fromEntries(readdirSync(fileURLToPath(new URL('en/', locales))).map(file => [file.replace('.json', ''), read('en', file)]));
  const exists = code => {
    const [namespace, key] = code.includes(':') ? code.split(':', 2) : ['common', code];
    const values = namespaces[namespace];
    return values && (Object.hasOwn(values, key) || Object.hasOwn(values, `${key}_one`) && Object.hasOwn(values, `${key}_other`));
  };
  for (const file of [...globSync('frontend/src/**/*.{ts,tsx}', { cwd: root }), ...globSync('internal/**/*.go', { cwd: root })]) {
    if (/\.test\.tsx?$|_test\.go$/.test(file)) continue;
    const source = readFileSync(new URL(file.replaceAll('\\', '/'), new URL('../', import.meta.url)), 'utf8');
    const pattern = file.endsWith('.go') ? /appmessage\.(?:New|Errorf)\(\s*"([^"]+)"/g : /\b(?:t|translate|uiMessage|message)\(\s*['"]([^'"]+)['"]/g;
    for (const match of source.matchAll(pattern)) assert.ok(exists(match[1]), `${file}: missing ${match[1]}`);
  }
});
