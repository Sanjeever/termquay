import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const write = process.argv.includes('--write');
const files = readdirSync(root).filter((file) => file.endsWith('.go'));
const result = spawnSync('gofmt', [write ? '-w' : '-l', ...files, 'internal'], {
  cwd: root,
  encoding: 'utf8',
});
if (result.error) throw result.error;
if (result.stderr) process.stderr.write(result.stderr);
if (result.status !== 0) process.exitCode = result.status ?? 1;
else if (!write && result.stdout.trim()) {
  process.stderr.write(`Go files need formatting; run pnpm format:\n${result.stdout}`);
  process.exitCode = 1;
}
