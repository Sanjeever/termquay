import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import type { Transfer } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import { deferred } from '../../test/deferred';
import TransferPanel from './TransferPanel';
import useTransfers from './useTransfers';

const api = vi.hoisted(() => ({ list: vi.fn(), clear: vi.fn(), clearFinished: vi.fn(), discard: vi.fn(), on: vi.fn() }));
vi.mock('@wailsio/runtime', () => ({ Events: { On: api.on } }));
vi.mock('../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice', () => ({
  ListTransfers: api.list, RestoreTransferResumes: vi.fn().mockResolvedValue(undefined),
  ClearTransfer: api.clear, ClearFinishedTransfers: api.clearFinished, DiscardTransferResume: api.discard,
  CancelTransfer: vi.fn(), CancelAndDiscardTransfer: vi.fn(), RetryTransfer: vi.fn(), ResumeTransfer: vi.fn(),
  GetTransferRate: vi.fn().mockResolvedValue(0), SetTransferRate: vi.fn(),
}));

const retained = {
  id: 'retained', workspace: 'closed-workspace', name: 'archive.zip', direction: 'upload', state: 'cancelled',
  total: 100, completed: 50, sequence: 1, target: 'test@example.invalid:22',
  source_path: '/local/archive.zip', destination_path: '/remote/archive.zip',
  resumable: true, cleanup_required: false, resume_persisted: true, temporary_path: '/remote/.termquay-test/data',
  error: '', retryable: false, batch_id: 'batch', phase: '', speed: 0, remaining_seconds: -1, directory: false,
} satisfies Transfer;

function Panel({ workspaces = [] }: { workspaces?: { id: string; name: string; target: string }[] }) {
  const tasks = useTransfers(true);
  return <TransferPanel tasks={tasks} reveal="" height={240} onHeight={()=>{}} onClose={()=>{}} onLocate={()=>{}} workspaces={workspaces} />;
}

beforeEach(() => {
  vi.clearAllMocks();
  api.on.mockReturnValue(()=>{});
  api.list.mockResolvedValue([retained]);
  api.clear.mockResolvedValue('retained');
  api.clearFinished.mockResolvedValue(['retained']);
  api.discard.mockResolvedValue(undefined);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(()=>callback(0), 0));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
});

test('removes a retained record offline after confirming loss of resume data', async () => {
  const user = userEvent.setup();
  render(<Panel />);
  await user.click(await screen.findByRole('button', { name: 'Remove record' }));
  const dialog = await screen.findByRole('dialog');
  expect(dialog.textContent).toContain('can no longer be resumed');
  expect(within(dialog).queryByRole('combobox')).toBeNull();
  expect(api.clear).not.toHaveBeenCalled();
  await user.click(within(dialog).getByRole('button', { name: 'Remove record' }));
  await screen.findByText('No transfers');
  expect(api.clear).toHaveBeenCalledWith('retained');
  expect(api.discard).not.toHaveBeenCalled();
});

test('bulk clearing removes retained and ordinary history while preserving active transfers', async () => {
  const user = userEvent.setup();
  api.list.mockResolvedValue([retained, { ...retained, id: 'running', name: 'active.zip', state: 'running', resumable: false, sequence: 2 }]);
  render(<Panel />);
  await user.click(await screen.findByRole('button', { name: 'Clear finished' }));
  const dialog = await screen.findByRole('dialog');
  await user.click(within(dialog).getByRole('button', { name: 'Clear transfer records' }));
  await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.queryByText('archive.zip')).toBeNull();
  expect(screen.getByText('active.zip')).toBeTruthy();
  expect(api.clearFinished).toHaveBeenCalledTimes(1);
  expect(api.discard).not.toHaveBeenCalled();
});

test('remote cleanup without a connection explains the requirement and offers offline removal', async () => {
  const user = userEvent.setup();
  render(<Panel />);
  await user.click(await screen.findByRole('button', { name: 'Clear staging files' }));
  let dialog = await screen.findByRole('dialog');
  expect(dialog.textContent).toContain('Connect to this server');
  expect((within(dialog).getByRole('button', { name: 'Delete temporary file and remove record' }) as HTMLButtonElement).disabled).toBe(true);
  await user.click(within(dialog).getByRole('button', { name: 'Remove record' }));
  dialog = await screen.findByRole('dialog');
  await user.click(within(dialog).getByRole('button', { name: 'Remove record' }));
  await screen.findByText('No transfers');
  expect(api.discard).not.toHaveBeenCalled();
});

test('local staging cleanup requires no workspace and preserves errors until a successful retry', async () => {
  const user = userEvent.setup();
  api.list.mockResolvedValue([{ ...retained, direction: 'download' }]);
  api.discard.mockRejectedValueOnce(new Error('Permission denied'));
  render(<Panel />);
  await user.click(await screen.findByRole('button', { name: 'Clear staging files' }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).queryByRole('combobox')).toBeNull();
  const remove = within(dialog).getByRole('button', { name: 'Delete temporary file and remove record' });
  await user.click(remove);
  expect((await within(dialog).findByRole('alert')).textContent).toContain('Permission denied');
  expect(screen.getByText('archive.zip')).toBeTruthy();
  await user.click(remove);
  await screen.findByText('No transfers');
  expect(api.discard).toHaveBeenLastCalledWith('retained', '');
});

test('record removal failure stays visible until a successful retry', async () => {
  const user = userEvent.setup();
  const pending = deferred<string>();
  api.clear.mockReturnValueOnce(pending.promise);
  render(<Panel />);
  await user.click(await screen.findByRole('button', { name: 'Remove record' }));
  const dialog = await screen.findByRole('dialog');
  const remove = within(dialog).getByRole('button', { name: 'Remove record' });
  await user.click(remove);
  expect(api.clear).toHaveBeenCalledTimes(1);
  pending.reject(new Error('Storage unavailable'));
  expect((await within(dialog).findByRole('alert')).textContent).toContain('Storage unavailable');
  await waitFor(()=>expect((within(dialog).getByRole('button', { name: 'Remove record' }) as HTMLButtonElement).disabled).toBe(false));
  await user.click(within(dialog).getByRole('button', { name: 'Remove record' }));
  expect(api.clear).toHaveBeenCalledTimes(2);
  await screen.findByText('No transfers');
});

test('record removal cannot be submitted again while pending', async () => {
  const user = userEvent.setup();
  const pending = deferred<string>();
  api.clear.mockReturnValueOnce(pending.promise);
  render(<Panel />);
  await user.click(await screen.findByRole('button', { name: 'Remove record' }));
  const dialog = await screen.findByRole('dialog');
  const remove = within(dialog).getByRole('button', { name: 'Remove record' });
  await user.click(remove);
  await user.click(remove);
  expect(api.clear).toHaveBeenCalledTimes(1);
  pending.resolve('retained');
  await screen.findByText('No transfers');
});
