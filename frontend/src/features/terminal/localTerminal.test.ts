import { expect, test } from 'vitest';
import { localDirectoryName, localDirectoryReport, localTerminalLabels } from './localTerminal';
import type { Workspace } from '../workspaces/workspace';

function workspace(id: string, directory: string, renamed = false): Workspace {
  return {
    id,
    connectionID: '',
    name: renamed ? 'Review changes' : localDirectoryName(directory),
    local: {
      kind: 'shell',
      shell: 'Shell',
      directory,
      hostname: 'computer.local',
      renamed,
      terminal: { current: null },
    },
  };
}

test('local labels distinguish same-name directories and retain manual names', () => {
  const names = localTerminalLabels([
    workspace('a', '/work/client/project'),
    workspace('b', '/work/server/project'),
    workspace('c', 'C:\\work\\another', true),
    workspace('d', '/'),
  ]);
  expect(names.get('a')).toBe('project · client');
  expect(names.get('b')).toBe('project · server');
  expect(names.get('c')).toBe('Review changes');
  expect(names.get('d')).toBe('/');
});

test('directory inheritance accepts local OSC reports and rejects other execution domains', () => {
  expect(localDirectoryReport('/work/project', 'computer', 'computer.local', 'shell')).toBe(
    '/work/project',
  );
  expect(
    localDirectoryReport('/work/project', 'remote.example', 'computer.local', 'shell'),
  ).toBeUndefined();
  expect(localDirectoryReport('/C:/work/project', 'COMPUTER', 'computer', 'powershell')).toBe(
    'C:\\work\\project',
  );
  expect(localDirectoryReport('/home/user', 'computer', 'computer', 'wsl')).toBeUndefined();
});
