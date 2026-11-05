import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const binary = process.platform === 'win32' ? 'bin/termquay.exe'
  : process.platform === 'darwin' && existsSync('bin/termquay.app/Contents/MacOS/termquay')
    ? 'bin/termquay.app/Contents/MacOS/termquay' : 'bin/termquay';
const version = JSON.parse(readFileSync('frontend/package.json', 'utf8')).version;
function run(args, expected) {
  const result = spawnSync(binary, args, { encoding: 'utf8', timeout: 15000, windowsHide: true });
  assert.ifError(result.error);
  assert.equal(result.status, expected, `${args}: ${result.stderr}`);
  return result;
}
assert.equal(run(['--version'], 0).stdout.trim(), version);
for (const args of [['--help'], ['connection', 'list', '--help'], ['workspace', '--help'], ['exec', '--help']]) {
  assert.match(run(args, 0).stdout, /TermQuay/);
}
const status = run(['status', '--json', '--no-input'], 1);
assert.equal(status.stderr, '');
const response = JSON.parse(status.stdout);
assert.equal(response.protocol, 1);
assert.equal(response.data.running, false);
assert.equal(response.error.code, 'unavailable');
console.log('CLI 原生程序帮助、版本、重定向、未运行状态通过。');
