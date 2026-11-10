import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { deferred } from '../../test/deferred';
import i18n from '../../i18n';
import FileHistoryDialog from './FileHistoryDialog';

const api = vi.hoisted(() => ({ history: vi.fn(), configure: vi.fn(), action: vi.fn() }));
vi.mock('../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice', () => ({
  GetFileHistory: api.history,
  ConfigureFileWorkflow: api.configure,
  RunFileAction: api.action,
  ClearFileHistory: vi.fn(),
  ReadFileVersion: vi.fn(),
}));

const history = {
  enabled: true,
  validate: 'check-config',
  reload: 'reload-service',
  health_check: 'check-health',
  versions: [],
};
const document = {
  path: '/tmp/config',
  content: 'edited',
  revision: 'revision-1',
  encoding: 'UTF-8',
  line_ending: 'LF',
  bom: false,
};
function response<T>(value: T) {
  return Object.assign(Promise.resolve(value), { cancel: vi.fn() });
}
function setup(validateOnOpen = false, save = vi.fn().mockResolvedValue(true)) {
  return {
    save,
    ...render(
      <FileHistoryDialog
        workspace="owner-1"
        target="user@example.invalid:22"
        document={document}
        dirty={false}
        validateOnOpen={validateOnOpen}
        onSave={save}
        onRestore={() => {}}
        onClose={() => {}}
      />,
    ),
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  api.history.mockImplementation(() => response(history));
  api.configure.mockImplementation(() => response(undefined));
  api.action.mockImplementation(() =>
    response({
      stdout: 'ok',
      stderr: '',
      exit_code: 0,
      duration_ms: 20,
      truncated: false,
      error: '',
    }),
  );
});

test('opening history does not save or run commands', async () => {
  const { save } = setup();
  await screen.findByDisplayValue('check-config');
  expect(save).not.toHaveBeenCalled();
  expect(api.action).not.toHaveBeenCalled();
});

test('explicit save and validate runs once, then reload needs confirmation and runs the configured health check', async () => {
  const user = userEvent.setup();
  const { save } = setup(true);
  await waitFor(() =>
    expect(api.action).toHaveBeenCalledWith('owner-1', '/tmp/config', 'validate', 'check-config'),
  );
  expect(save).toHaveBeenCalledTimes(1);
  await act(() => i18n.changeLanguage('zh-CN'));
  await act(() => i18n.changeLanguage('en'));
  expect(save).toHaveBeenCalledTimes(1);
  expect(api.action).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole('button', { name: 'Confirm reload' }));
  expect(api.action).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole('button', { name: /^Confirm$/ }));
  await waitFor(() => expect(api.action).toHaveBeenCalledTimes(3));
  expect(api.action.mock.calls.slice(1)).toEqual([
    ['owner-1', '/tmp/config', 'reload', 'reload-service'],
    ['owner-1', '/tmp/config', 'health', 'check-health'],
  ]);
});

test('save failure prevents validation and reload', async () => {
  setup(true, vi.fn().mockResolvedValue(false));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('not saved'));
  expect(api.action).not.toHaveBeenCalled();
  expect(
    (screen.getByRole('button', { name: 'Confirm reload' }) as HTMLButtonElement).disabled,
  ).toBe(true);
});

test('missing configuration opens the workflow without saving or executing a guessed command', async () => {
  api.history.mockImplementation(() => response({ ...history, validate: '' }));
  const { save } = setup(true);
  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toContain('Configure and save'),
  );
  expect(save).not.toHaveBeenCalled();
  expect(api.action).not.toHaveBeenCalled();
});

test('failed validation never enables reload', async () => {
  api.action.mockImplementation(() =>
    response({
      stdout: 'invalid config',
      stderr: '',
      exit_code: 1,
      duration_ms: 20,
      truncated: false,
      error: '',
    }),
  );
  setup(true);
  await waitFor(() => expect(api.action).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('failed'));
  expect(
    (screen.getByRole('button', { name: 'Confirm reload' }) as HTMLButtonElement).disabled,
  ).toBe(true);
});

test('closing the owner during the post-save refresh prevents late command execution', async () => {
  const refresh = deferred<typeof history>();
  const cancel = vi.fn();
  api.history
    .mockReturnValueOnce(response(history))
    .mockReturnValueOnce(Object.assign(refresh.promise, { cancel }));
  const { unmount } = setup(true);
  await waitFor(() => expect(api.history).toHaveBeenCalledTimes(2));
  unmount();
  await act(() => refresh.resolve(history));
  expect(cancel).toHaveBeenCalled();
  expect(api.action).not.toHaveBeenCalled();
});
