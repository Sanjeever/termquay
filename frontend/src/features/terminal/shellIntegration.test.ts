import { test, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { directorySetupForHost, shellDirectorySetup, shellSetupForHost } from './shellIntegration';

const bash = process.env.SHELL || 'bash';
const hasBash = spawnSync(bash, ['--version'], { encoding: 'utf8' }).stdout?.includes('GNU bash');

function run(script: string) {
  const result = spawnSync(bash, ['--noprofile', '--norc'], {
    input: script,
    encoding: 'utf8',
    env: { ...process.env, BASH_ENV: '' },
  });
  expect(result.error).toBeUndefined();
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return result.stdout;
}

test.skipIf(!hasBash)(
  'directory hooks preserve prompt commands and exit status without enabling completion',
  () => {
    for (const prompt of [
      "PROMPT_COMMAND='printf existing'",
      "PROMPT_COMMAND=('printf existing')",
    ]) {
      const output = run(`${prompt}
${directorySetupForHost('bash', 'example.invalid')}
${directorySetupForHost('bash', 'example.invalid')}
PWD='/tmp/中文 空间%#?'
false
__termquay_directory_prompt
printf 'status=%s;' "$?"
declare -p PROMPT_COMMAND
printf 'ps0=%s;ps1=%s;completion=%s' "\${PS0-unset}" "\${PS1-unset}" "\${__termquay_completion_enabled-unset}"
`);
      expect(output).toContain('\x1b]7;file://example.invalid/tmp/中文 空间%25%23%3F\x07status=1;');
      expect(output.match(/__termquay_directory_prompt/g)).toHaveLength(1);
      expect(output).toContain('printf existing');
      expect(output).toContain('ps0=unset;ps1=unset;completion=unset');
      expect(output).not.toContain('\x1b]133;');
    }
  },
);

test.skipIf(!hasBash)('full integration reuses the directory hook installed earlier', () => {
  const output = run(`${directorySetupForHost('bash', '2001:db8::1')}
${shellSetupForHost('bash', '2001:db8::1')}
PWD=/tmp
__termquay_directory_prompt
__termquay_prompt
declare -p PROMPT_COMMAND
`);
  expect(output.split('\x1b]7;')).toHaveLength(2);
  expect(output).toContain('file://[2001:db8::1]/tmp');
  expect(output).toContain('\x1b]133;D;0\x07');
  expect(output.match(/__termquay_directory_prompt/g)).toHaveLength(1);
});

test.skipIf(!hasBash)(
  'a mismatched shell reports a session-scoped error without installing hooks',
  () => {
    const token = 'a'.repeat(64);
    const output = run(`${shellDirectorySetup('zsh', 'example.invalid', token)}
printf '%s' "\${__termquay_directory_enabled-unset}"
`);
    expect(output).toContain(
      `\x1b]777;termquay;${token};E;Shell type mismatch;terminal:completionShellMismatch\x07`,
    );
    expect(output).toMatch(/unset$/);
  },
);
