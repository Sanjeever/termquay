import {globSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const files = [...globSync('scripts/*.test.mjs', {cwd: root}), ...globSync('frontend/src/**/*.test.ts', {cwd: root})].sort();
if (!files.length) throw new Error('未找到测试');
const result = spawnSync(process.execPath, ['--experimental-strip-types', '--test', ...files], {cwd: root, stdio: 'inherit'});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
