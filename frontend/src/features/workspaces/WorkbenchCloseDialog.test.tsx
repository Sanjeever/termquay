import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';
import type { Document } from '../../../bindings/github.com/Sanjeever/termquay/internal/files/models';
import type { SSHWorkspaceHandle } from '../files/SSHWorkspace';
import { isDirty } from '../files/fileDrafts';
import useFileDrafts from '../files/useFileDrafts';
import { deferred } from '../../test/deferred';
import WorkbenchCloseDialog from './WorkbenchCloseDialog';
import useWorkbenchClose from './useWorkbenchClose';
import type { TerminalHandle } from '../terminal/TerminalView';

const api = vi.hoisted(() => ({
  save: vi.fn(),
  quit: vi.fn(),
  restart: vi.fn(),
  ready: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  flush: vi.fn(),
  remove: vi.fn(),
  select: vi.fn(),
}));
vi.mock('@wailsio/runtime', () => ({ Events: { On: api.on } }));
vi.mock('../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice', () => ({
  SaveRemoteFile: api.save,
  SaveSudoFile: vi.fn(),
  ReadRemoteFileEncoded: vi.fn(),
  ReadSudoFile: vi.fn(),
  DiscardAndQuit: api.quit,
  RestartForUpdate: api.restart,
  SetFrontendReady: api.ready,
}));

const document: Document = {
  path: '/tmp/config',
  content: 'original',
  revision: 'revision-1',
  encoding: 'UTF-8',
  line_ending: 'LF',
  bom: false,
};

function Workbench({ activeTasks = 0 }: { activeTasks?: number }) {
  const disposed = useRef(false);
  const instance = useRef('session-a');
  const drafts = useFileDrafts({
    sessionID: instance.current,
    instance,
    disposed,
    authorizeSudo: async () => undefined,
    setError: () => {},
  });
  const [open, setOpen] = useState(true);
  const handle = {
    hasDirty: () => drafts.draftsRef.current.some(isDirty),
    saveAll: async () => {
      for (const draft of drafts.draftsRef.current)
        if (!(await drafts.save(draft.path))) return false;
      return true;
    },
  } as SSHWorkspaceHandle;
  const close = useWorkbenchClose({
    workspaces: open
      ? [
          {
            id: 'workspace-a',
            connectionID: 'connection-a',
            name: 'Server',
            ssh: { current: handle },
          },
        ]
      : [],
    activeTasks,
    flushLocalState: api.flush,
    beforeQuit: () => {},
    select: api.select,
    onError: () => {},
    remove: (id, keyboard) => {
      api.remove(id, keyboard);
      setOpen(false);
    },
  });
  return (
    <>
      {open && (
        <>
          <textarea
            aria-label="Remote file"
            value={drafts.drafts[0]?.content ?? document.content}
            onChange={(event) => {
              const content = event.target.value;
              drafts.updateDrafts(() => [
                { ...document, content, saved: document.content, error: '', saving: false },
              ]);
            }}
          />
          <button onClick={() => close.requestClose('workspace-a', false)}>Close workspace</button>
        </>
      )}
      <WorkbenchCloseDialog close={close} keepDrafts={false} />
    </>
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  api.ready.mockResolvedValue(undefined);
  api.quit.mockResolvedValue(undefined);
  api.restart.mockResolvedValue(undefined);
  api.flush.mockResolvedValue(undefined);
  api.on.mockReturnValue(api.off);
});

function LocalWorkbench({ exited = false }: { exited?: boolean }) {
  const [open, setOpen] = useState(true);
  const terminal = useRef({ ended: () => exited } as TerminalHandle);
  const close = useWorkbenchClose({
    workspaces: open
      ? [
          {
            id: 'local',
            connectionID: '',
            name: 'project',
            local: {
              shell: 'Shell',
              kind: 'shell',
              directory: '/work/project',
              hostname: 'computer',
              terminal,
            },
          },
        ]
      : [],
    activeTasks: 0,
    flushLocalState: api.flush,
    beforeQuit: () => {},
    select: api.select,
    onError: () => {},
    remove: (id, keyboard) => {
      api.remove(id, keyboard);
      setOpen(false);
    },
  });
  return (
    <>
      {open && <button onClick={() => close.requestClose('local', true)}>Close local</button>}
      <WorkbenchCloseDialog close={close} keepDrafts={false} />
    </>
  );
}

test('closing a live local terminal requires confirmation and cancel preserves it', async () => {
  const user = userEvent.setup();
  render(<LocalWorkbench />);
  await user.click(screen.getByRole('button', { name: 'Close local' }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText('/work/project')).toBeTruthy();
  expect(api.remove).not.toHaveBeenCalled();
  await user.click(within(dialog).getByRole('button', { name: 'Back to workbench' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(api.remove).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Close local' }));
  await user.click(
    within(await screen.findByRole('dialog')).getByRole('button', {
      name: 'Close terminal',
    }),
  );
  expect(api.remove).toHaveBeenCalledWith('local', true);
});

test('an exited local terminal closes directly', async () => {
  const user = userEvent.setup();
  render(<LocalWorkbench exited />);
  await user.click(screen.getByRole('button', { name: 'Close local' }));
  expect(api.remove).toHaveBeenCalledWith('local', true);
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('native quit with a live local terminal waits for confirmation and persistence', async () => {
  const user = userEvent.setup();
  render(<LocalWorkbench />);
  const quit = api.on.mock.calls.find(([name]) => name === 'app:close-requested')?.[1];
  act(() => quit());
  const dialog = await screen.findByRole('dialog');
  expect(api.quit).not.toHaveBeenCalled();
  expect(within(dialog).getByText('/work/project')).toBeTruthy();
  await user.click(within(dialog).getByRole('button', { name: 'Quit' }));
  await waitFor(() => expect(api.quit).toHaveBeenCalledOnce());
  expect(api.flush).toHaveBeenCalledOnce();
});

test('returning to editing preserves the draft without saving or closing the workspace', async () => {
  const user = userEvent.setup();
  render(<Workbench />);
  const editor = screen.getByRole('textbox', { name: 'Remote file' });
  await user.type(editor, ' changed');
  await user.click(screen.getByRole('button', { name: 'Close workspace' }));
  const dialog = await screen.findByRole('dialog');
  await user.click(within(dialog).getByRole('button', { name: 'Back to editing' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect((editor as HTMLTextAreaElement).value).toBe('original changed');
  expect(api.save).not.toHaveBeenCalled();
  expect(api.remove).not.toHaveBeenCalled();
});

test('save failure keeps the draft open and a successful retry closes the workspace', async () => {
  const user = userEvent.setup();
  api.save.mockRejectedValueOnce(new Error('Permission denied'));
  render(<Workbench />);
  await user.type(screen.getByRole('textbox', { name: 'Remote file' }), ' changed');
  await user.click(screen.getByRole('button', { name: 'Close workspace' }));
  let dialog = await screen.findByRole('dialog');
  await user.click(within(dialog).getByRole('button', { name: 'Save and Close' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Saving is incomplete');
  expect(
    (screen.getByRole('textbox', { name: 'Remote file', hidden: true }) as HTMLTextAreaElement)
      .value,
  ).toBe('original changed');
  expect(api.remove).not.toHaveBeenCalled();
  expect(api.select).toHaveBeenCalledWith('workspace-a');

  api.save.mockResolvedValueOnce({
    ...document,
    content: 'original changed',
    revision: 'revision-2',
  });
  dialog = screen.getByRole('dialog');
  await user.click(within(dialog).getByRole('button', { name: 'Save and Close' }));
  await waitFor(() => expect(api.remove).toHaveBeenCalledWith('workspace-a', false));
  expect(screen.queryByRole('textbox', { name: 'Remote file' })).toBeNull();
});

test('pending saves prevent dismissal and explicit discard closes without another remote write', async () => {
  const user = userEvent.setup();
  const pending = deferred<Document>();
  api.save.mockReturnValueOnce(pending.promise);
  render(<Workbench />);
  await user.type(screen.getByRole('textbox', { name: 'Remote file' }), ' changed');
  await user.click(screen.getByRole('button', { name: 'Close workspace' }));
  let dialog = await screen.findByRole('dialog');
  await user.click(within(dialog).getByRole('button', { name: 'Save and Close' }));
  expect(
    within(dialog).getByRole<HTMLButtonElement>('button', { name: 'Back to editing' }).disabled,
  ).toBe(true);
  await user.keyboard('{Escape}');
  expect(screen.getByRole('dialog')).toBe(dialog);
  expect(api.remove).not.toHaveBeenCalled();
  await act(async () => {
    pending.reject(new Error('Permission denied'));
  });
  await screen.findByRole('alert');
  dialog = screen.getByRole('dialog');
  await user.click(within(dialog).getByRole('button', { name: 'Discard changes and close' }));
  expect(api.save).toHaveBeenCalledTimes(1);
  expect(api.remove).toHaveBeenCalledWith('workspace-a', false);
});

test('a native close request with running tasks waits for confirmation and removes its listener on unmount', async () => {
  const user = userEvent.setup();
  const { unmount } = render(<Workbench activeTasks={2} />);
  const onClose = api.on.mock.calls.find(([name]) => name === 'app:close-requested')![1];
  act(() => onClose());
  const dialog = await screen.findByRole('dialog');
  expect(dialog.textContent).toContain('2');
  expect(api.quit).not.toHaveBeenCalled();
  await user.click(within(dialog).getByRole('button', { name: 'Cancel tasks and quit' }));
  await waitFor(() => expect(api.quit).toHaveBeenCalledTimes(1));
  expect(api.flush).toHaveBeenCalledTimes(1);
  unmount();
  expect(api.off).toHaveBeenCalledTimes(1);
});

test('a local persistence error remains visible and requires explicit discard before quitting', async () => {
  const user = userEvent.setup();
  api.flush.mockRejectedValueOnce(new Error('Local storage unavailable'));
  render(<Workbench />);
  const onClose = api.on.mock.calls.find(([name]) => name === 'app:close-requested')![1];
  act(() => onClose());
  const dialog = await screen.findByRole('dialog');
  expect((await screen.findByRole('alert')).textContent).toContain('Local storage unavailable');
  expect(api.quit).not.toHaveBeenCalled();
  await user.click(
    within(dialog).getByRole('button', { name: 'Ignore local save errors and quit' }),
  );
  await waitFor(() => expect(api.quit).toHaveBeenCalledTimes(1));
  expect(api.flush).toHaveBeenCalledTimes(1);
});
