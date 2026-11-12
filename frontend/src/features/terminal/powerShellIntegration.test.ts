import { expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { powerShellIntegrationSetup } from './shellIntegration';

const token = 'a'.repeat(64);
const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;

for (const shell of ['pwsh', ...(process.platform === 'win32' ? ['powershell'] : [])]) {
  const available =
    spawnSync(
      shell,
      ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.Major'],
      { encoding: 'utf8' },
    ).status === 0;
  function run(script: string, directory?: string) {
    const result = spawnSync(
      shell,
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from("$ProgressPreference = 'SilentlyContinue'\n" + script, 'utf16le').toString(
          'base64',
        ),
      ],
      {
        cwd: directory,
        encoding: 'utf8',
        timeout: 15000,
        env: { ...process.env, POWERSHELL_TELEMETRY_OPTOUT: '1' },
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    return result.stdout;
  }

  test.skipIf(!available)(
    `${shell} reports escaped directories and preserves the original prompt`,
    () => {
      const temporary = mkdtempSync(join(tmpdir(), 'termquay-powershell-'));
      const directory = join(temporary, "中文 space #%'folder");
      try {
        mkdirSync(directory);
        const output = run(
          `Set-StrictMode -Version Latest
function global:prompt { 'original-prompt' }
${powerShellIntegrationSetup('localhost', token, true)}
${powerShellIntegrationSetup('localhost', token, true)}
Set-Location -LiteralPath ${quote(directory)}
[Console]::Write((prompt))`,
          temporary,
        );
        expect(output).toContain('\x1b]7;file://localhost/');
        expect(output).toContain('%E4%B8%AD%E6%96%87%20space%20%23%25');
        expect(output.split('\x1b]7;')).toHaveLength(2);
        expect(output).toContain('original-prompt');
        expect(output).not.toContain('\x1b]133;');
      } finally {
        rmSync(temporary, { recursive: true, force: true });
      }
    },
  );

  test.skipIf(!available)(
    `${shell} records command boundaries once and preserves failure status`,
    () => {
      const output = run(`Import-Module PSReadLine -ErrorAction Stop
function global:prompt { "original-status=$($global:?):native=$global:LASTEXITCODE" }
function global:PSConsoleHostReadLine { "Write-Output 'hello'" }
${powerShellIntegrationSetup('localhost', token, true)}
${powerShellIntegrationSetup('localhost', token, false)}
${powerShellIntegrationSetup('localhost', 'b'.repeat(64), false)}
$null = PSConsoleHostReadLine
$global:LASTEXITCODE = 7
Write-Error 'expected failure' -ErrorAction Ignore
[Console]::Write((prompt))
[Console]::Write((prompt))`);
      expect(output.split('\x1b]133;C')).toHaveLength(2);
      expect(output.split('\x1b]133;D;')).toHaveLength(2);
      expect(output).toContain('\x1b]133;D;1\x07');
      expect(output).toContain('original-status=False:native=7');
      expect(output).toContain(`\x1b]777;termquay;${'b'.repeat(64)};P;powershell\x07`);
      expect(output).toContain(`;R;${Buffer.from("Write-Output 'hello'").toString('hex')}\x07`);
    },
  );
}

test('PowerShell setup validates its token and quotes the host as literal data', () => {
  expect(() => powerShellIntegrationSetup('localhost', 'bad', false)).toThrow();
  expect(powerShellIntegrationSetup("a'b", token, false)).toContain("-HostName 'a''b'");
});
