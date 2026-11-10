import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import type { Document } from '../../../bindings/github.com/Sanjeever/termquay/internal/files/models';
import { deferred } from '../../test/deferred';
import { isDirty, type Draft } from './fileDrafts';
import useFileDrafts from './useFileDrafts';

const api = vi.hoisted(() => ({
  read: vi.fn(),
  readSudo: vi.fn(),
  save: vi.fn(),
  saveSudo: vi.fn(),
}));
vi.mock('../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice', () => ({
  ReadRemoteFileEncoded: api.read,
  ReadSudoFile: api.readSudo,
  SaveRemoteFile: api.save,
  SaveSudoFile: api.saveSudo,
}));

const document: Document = {
  path: '/tmp/config',
  content: 'original',
  revision: 'revision-1',
  encoding: 'UTF-8',
  line_ending: 'LF',
  bom: false,
};

function setupDrafts(overrides: Partial<Draft> = {}) {
  const disposed = { current: false };
  const instance = { current: 'session-a' };
  const authorizeSudo = vi.fn().mockResolvedValue(undefined);
  const setError = vi.fn();
  const hook = renderHook(
    ({ sessionID }) => useFileDrafts({ sessionID, disposed, instance, authorizeSudo, setError }),
    {
      initialProps: { sessionID: instance.current },
    },
  );
  act(() =>
    hook.result.current.updateDrafts(() => [
      {
        ...document,
        saved: document.content,
        content: 'edited',
        saving: false,
        error: '',
        ...overrides,
      },
    ]),
  );
  return { ...hook, disposed, instance, authorizeSudo, setError };
}

beforeEach(() => {
  vi.resetAllMocks();
});

test('saving keeps edits and format changes made while the request is pending', async () => {
  const pending = deferred<Document>();
  api.save.mockReturnValueOnce(pending.promise);
  const { result } = setupDrafts({ encoding: 'GBK', line_ending: 'CRLF' });
  let saving!: Promise<boolean>;
  act(() => {
    saving = result.current.save(document.path);
  });
  expect(result.current.drafts[0].saving).toBe(true);
  expect(api.save).toHaveBeenCalledWith(
    'session-a',
    expect.objectContaining({
      content: 'edited',
      revision: 'revision-1',
      encoding: 'GBK',
      line_ending: 'CRLF',
    }),
  );

  act(() =>
    result.current.updateDrafts((previous) =>
      previous.map((draft) => ({ ...draft, content: 'newer input', encoding: 'UTF-8' })),
    ),
  );
  await act(async () => {
    pending.resolve({
      ...document,
      content: 'edited',
      encoding: 'GBK',
      line_ending: 'CRLF',
      revision: 'revision-2',
    });
    expect(await saving).toBe(false);
  });
  expect(result.current.drafts[0]).toMatchObject({
    content: 'newer input',
    saved: 'edited',
    encoding: 'UTF-8',
    revision: 'revision-2',
    saving: false,
  });
  expect(isDirty(result.current.drafts[0])).toBe(true);

  api.save.mockResolvedValueOnce({
    ...document,
    content: 'newer input',
    revision: 'revision-3',
    line_ending: 'CRLF',
  });
  await act(async () => {
    expect(await result.current.save(document.path)).toBe(true);
  });
  expect(api.save).toHaveBeenLastCalledWith(
    'session-a',
    expect.objectContaining({
      original_encoding: 'GBK',
      revision: 'revision-2',
      content: 'newer input',
    }),
  );
  expect(isDirty(result.current.drafts[0])).toBe(false);
});

test('repeated saves share one pending backend operation', async () => {
  const pending = deferred<Document>();
  api.save.mockReturnValueOnce(pending.promise);
  const { result } = setupDrafts();
  let first!: Promise<boolean>, second!: Promise<boolean>;
  act(() => {
    first = result.current.save(document.path);
    second = result.current.save(document.path);
  });
  expect(api.save).toHaveBeenCalledTimes(1);
  await act(async () => {
    pending.resolve({ ...document, content: 'edited' });
    expect(await Promise.all([first, second])).toEqual([true, true]);
  });
});

test('a failed save retains the draft and exposes the failure until a successful retry', async () => {
  const failure = new Error('Permission denied');
  api.save.mockRejectedValueOnce(failure);
  const { result } = setupDrafts();
  await act(async () => {
    expect(await result.current.save(document.path)).toBe(false);
  });
  expect(result.current.drafts[0]).toMatchObject({
    content: 'edited',
    saved: 'original',
    error: failure,
    errorOperation: 'save',
    saving: false,
  });
  expect(isDirty(result.current.drafts[0])).toBe(true);

  api.save.mockResolvedValueOnce({ ...document, content: 'edited', revision: 'revision-2' });
  await act(async () => {
    expect(await result.current.save(document.path)).toBe(true);
  });
  expect(result.current.drafts[0].error).toBe('');
  expect(isDirty(result.current.drafts[0])).toBe(false);
});

test.each(['resolve', 'reject'] as const)(
  'a save that %ss after session replacement leaves the new draft untouched',
  async (outcome) => {
    const pending = deferred<Document>();
    api.save.mockReturnValueOnce(pending.promise);
    const { result, instance, rerender } = setupDrafts();
    let saving!: Promise<boolean>;
    act(() => {
      saving = result.current.save(document.path);
    });
    instance.current = 'session-b';
    rerender({ sessionID: instance.current });
    act(() =>
      result.current.updateDrafts(() => [
        {
          ...document,
          content: 'new session draft',
          saved: 'new baseline',
          error: '',
          saving: false,
        },
      ]),
    );
    const replacement = result.current.drafts[0];
    await act(async () => {
      if (outcome === 'resolve') pending.resolve({ ...document, content: 'edited' });
      else pending.reject(new Error('Old session disconnected'));
      expect(await saving).toBe(false);
    });
    expect(result.current.drafts[0]).toBe(replacement);
  },
);

test('dirty reloads wait for confirmation and use the requested encoding', async () => {
  const { result } = setupDrafts();
  act(() => result.current.requestReload(document.path, 'GBK'));
  expect(result.current.rereading).toBe(document.path);
  expect(api.read).not.toHaveBeenCalled();
  act(() => result.current.setRereading(''));
  expect(result.current.drafts[0].content).toBe('edited');
  expect(api.read).not.toHaveBeenCalled();

  act(() => result.current.requestReload(document.path, 'GBK'));
  api.read.mockResolvedValueOnce({
    ...document,
    encoding: 'GBK',
    content: 'remote content',
    revision: 'revision-2',
  });
  await act(async () => {
    await result.current.reread(document.path);
  });
  expect(api.read).toHaveBeenCalledWith('session-a', document.path, 'GBK');
  expect(result.current.drafts[0]).toMatchObject({
    content: 'remote content',
    saved: 'remote content',
    encoding: 'GBK',
    revision: 'revision-2',
    reloadEpoch: 1,
  });
  expect(result.current.rereading).toBe('');
  expect(isDirty(result.current.drafts[0])).toBe(false);
});

test.each(['resolve', 'reject'] as const)(
  'a read that %ss after disposal cannot replace the draft or its error',
  async (outcome) => {
    const pending = deferred<Document>();
    api.read.mockReturnValueOnce(pending.promise);
    const { result, disposed } = setupDrafts();
    let reading!: Promise<void>;
    act(() => {
      reading = result.current.reread(document.path);
    });
    const original = result.current.drafts[0];
    disposed.current = true;
    await act(async () => {
      if (outcome === 'resolve') pending.resolve({ ...document, content: 'late response' });
      else pending.reject(new Error('Disconnected'));
      await reading;
    });
    expect(result.current.drafts[0]).toBe(original);
  },
);

test('cancelled sudo authorization retains changes without writing remotely', async () => {
  const { result, authorizeSudo } = setupDrafts({ sudo: true });
  await act(async () => {
    expect(await result.current.save(document.path)).toBe(false);
  });
  expect(authorizeSudo).toHaveBeenCalledWith(document.path, 'UTF-8', 'save');
  expect(api.save).not.toHaveBeenCalled();
  expect(api.saveSudo).not.toHaveBeenCalled();
  expect(result.current.drafts[0]).toMatchObject({ content: 'edited', saving: false, error: '' });
  expect(isDirty(result.current.drafts[0])).toBe(true);
});
