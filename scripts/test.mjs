import {globSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const files = [...globSync('scripts/*.test.mjs', {cwd: root})].sort();
if (!files.length) throw new Error('No script tests found');
const frontend = new URL('../frontend/', import.meta.url);
const runs = [
  { args: ['--test', ...files], cwd: root },
  { args: [fileURLToPath(new URL('node_modules/vitest/vitest.mjs', frontend)), 'run', ...process.argv.slice(2)], cwd: fileURLToPath(frontend) },
];
for (const {args, cwd} of runs) {
  const result = spawnSync(process.execPath, args, {cwd, stdio: 'inherit'});
  if (result.error) throw result.error;
  if (result.status !== 0) { process.exitCode = result.status ?? 1; break; }
}
