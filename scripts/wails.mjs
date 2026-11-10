import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const tools = join(root, '.tools');
const binary = join(tools, process.platform === 'win32' ? 'wails3.exe' : 'wails3');
const modulePath = 'github.com/wailsapp/wails/v3';
const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
const env = { ...process.env, [pathKey]: `${tools}${delimiter}${process.env[pathKey] ?? ''}` };

try {
  const version = execFileSync('go', ['list', '-m', '-f', '{{.Version}}', modulePath], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  }).trim();
  const installed =
    existsSync(binary) &&
    execFileSync('go', ['version', '-m', binary], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    })
      .split('\n')
      .some((line) => {
        const [kind, path, installedVersion] = line.trim().split(/\s+/);
        return kind === 'mod' && path === modulePath && installedVersion === version;
      });

  if (!installed) {
    mkdirSync(tools, { recursive: true });
    console.log(`Installing Wails CLI ${version} into .tools`);
    execFileSync('go', ['install', `${modulePath}/cmd/wails3@${version}`], {
      cwd: root,
      env: { ...env, GOBIN: tools },
      stdio: 'inherit',
    });
  }

  const child = spawn(binary, process.argv.slice(2), { cwd: root, env, stdio: 'inherit' });
  const interrupt = () => child.kill('SIGINT');
  const terminate = () => child.kill('SIGTERM');
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', terminate);
  child.on('error', (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  child.on('close', (code, signal) => {
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', terminate);
    if (signal) process.kill(process.pid, signal);
    else process.exitCode = code;
  });
} catch (error) {
  console.error(error.message);
  process.exitCode = error.status ?? 1;
}
