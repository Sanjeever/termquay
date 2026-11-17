import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import useFileTree from './useFileTree';

const read = vi.hoisted(() => vi.fn());
vi.mock('../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice', () => ({
  ReadDirectory: read,
}));
vi.mock('@wailsio/runtime', () => ({ Events: { On: () => () => {} } }));

test('refresh reloads the target branch, preserves expansions and keeps old entries on failure', async () => {
  const entry = (path: string) => ({ path, name: path.split('/').pop(), directory: true });
  const directories: Record<string, unknown[]> = {
    '/': [entry('/root'), entry('/etc')],
    '/root': [entry('/root/child')],
    '/root/child': [],
    '/etc': [],
  };
  read.mockImplementation((_id, path) => Promise.resolve({ path, entries: directories[path] }));
  const { result } = renderHook(() => useFileTree('workspace', true));
  await waitFor(() => expect(result.current.nodes['/']?.entries).toHaveLength(2));
  await act(async () => {
    await result.current.reveal('/root/child');
    await result.current.expand('/etc');
  });
  read.mockClear();
  await act(async () => {
    await result.current.refresh('/root');
  });
  expect(read.mock.calls.map((call) => call[1]).sort()).toEqual(['/root', '/root/child']);
  expect([...result.current.expanded].sort()).toEqual(['/', '/etc', '/root', '/root/child']);
  read.mockRejectedValueOnce(new Error('permission denied'));
  await act(async () => {
    await expect(result.current.refresh('/root')).rejects.toThrow('permission denied');
  });
  expect(result.current.nodes['/root'].entries).toHaveLength(1);
  expect(result.current.nodes['/root'].error).toBeTruthy();
});
