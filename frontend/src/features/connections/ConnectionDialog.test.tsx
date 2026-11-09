import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';
import type { Connection } from '../../../bindings/github.com/Sanjeever/termquay/internal/store/models';
import { deferred } from '../../test/deferred';
import ConnectionDialog from './ConnectionDialog';

const api = vi.hoisted(() => ({
  save: vi.fn(), references: vi.fn(), preferences: vi.fn(), preference: vi.fn(), tags: vi.fn(), parse: vi.fn(),
}));
vi.mock('../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice', () => ({
  SaveConnection: api.save, ListCredentialReferences: api.references,
  GetConnectionPreferences: api.preferences, SetConnectionPreference: api.preference, SetConnectionTags: api.tags,
  ParseQuickConnection: api.parse, GetConnectionPassword: vi.fn(), SetRDPResolution: vi.fn(), SetRDPClient: vi.fn(),
  SelectPrivateKey: vi.fn(), ReleasePrivateKey: vi.fn(), SaveConnectionWithCredential: vi.fn(), SelectSSHCertificate: vi.fn(),
}));

const saved: Connection = { id: 'connection-a', group_id: '', name: 'server.example', protocol: 'ssh', host: 'server.example', port: 22, username: 'operator', credential_id: '' };

function setupDialog(overrides: Partial<ComponentProps<typeof ConnectionDialog>> = {}) {
  const props: ComponentProps<typeof ConnectionDialog> = {
    temporary: false, groups: [], connections: [], busy: false, systemRDP: false, connectionError: '',
    onConnect: vi.fn().mockResolvedValue(false), onSaved: vi.fn(), onClose: vi.fn(), onCancel: vi.fn(), ...overrides,
  };
  return { ...render(<ConnectionDialog {...props} />), props };
}

async function fillTarget(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByRole('textbox', { name: /^Host/ }), saved.host);
  await user.type(screen.getByRole('textbox', { name: /^Username/ }), saved.username);
}

beforeEach(() => {
  vi.resetAllMocks();
  api.references.mockResolvedValue([]);
  api.preferences.mockResolvedValue({});
  api.preference.mockResolvedValue(undefined);
  api.tags.mockResolvedValue(undefined);
  api.save.mockResolvedValue(saved);
});

test('required fields and invalid ports prevent a save until the form is valid', async () => {
  const user = userEvent.setup();
  const { props } = setupDialog();
  await user.click(screen.getByRole('button', { name: 'Save' }));
  expect(api.save).not.toHaveBeenCalled();
  await fillTarget(user);
  const port = screen.getByRole<HTMLInputElement>('spinbutton', { name: /^Port/ });
  await user.clear(port);
  await user.type(port, '65536');
  await user.click(screen.getByRole('button', { name: 'Save' }));
  expect(port.validity.rangeOverflow).toBe(true);
  expect(api.save).not.toHaveBeenCalled();
  await user.clear(port);
  await user.type(port, '22');
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(props.onClose).toHaveBeenCalledTimes(1));
  expect(api.save).toHaveBeenCalledWith(expect.objectContaining({ host: saved.host, port: 22, username: saved.username, protocol: 'ssh' }), expect.objectContaining({ host: saved.host, port: 22 }));
});

test('a pending save blocks repeated submission and cancellation', async () => {
  const user = userEvent.setup();
  const pending = deferred<Connection>();
  api.save.mockReturnValueOnce(pending.promise);
  const { props } = setupDialog();
  await fillTarget(user);
  const save = screen.getByRole<HTMLButtonElement>('button', { name: 'Save' });
  await user.dblClick(save);
  expect(api.save).toHaveBeenCalledTimes(1);
  expect(save.disabled).toBe(true);
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Cancel' }).disabled).toBe(true);
  await user.keyboard('{Escape}');
  expect(props.onClose).not.toHaveBeenCalled();
  await act(async () => { pending.resolve(saved); });
  await waitFor(() => expect(props.onClose).toHaveBeenCalledTimes(1));
});

test('a backend save failure remains visible and the entered target can be corrected and retried', async () => {
  const user = userEvent.setup();
  api.save.mockRejectedValueOnce(new Error('Storage unavailable'));
  const { props } = setupDialog();
  await fillTarget(user);
  await user.click(screen.getByRole('button', { name: 'Save' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Storage unavailable');
  const host = screen.getByRole<HTMLInputElement>('textbox', { name: /^Host/ });
  expect(host.value).toBe(saved.host);
  expect(props.onClose).not.toHaveBeenCalled();
  await user.clear(host);
  await user.type(host, 'other.example');
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(props.onClose).toHaveBeenCalledTimes(1));
  expect(api.save).toHaveBeenLastCalledWith(expect.objectContaining({ host: 'other.example' }), expect.objectContaining({ host: 'other.example' }));
});

test('a preference failure reports partial success and prevents connecting or closing', async () => {
  const user = userEvent.setup();
  api.preference.mockRejectedValueOnce(new Error('Preferences unavailable'));
  const { props } = setupDialog();
  await fillTarget(user);
  await user.click(screen.getByRole('button', { name: 'Save and connect' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Preferences unavailable');
  expect(api.save).toHaveBeenCalledTimes(1);
  expect(props.onSaved).toHaveBeenCalled();
  expect(props.onConnect).not.toHaveBeenCalled();
  expect(props.onClose).not.toHaveBeenCalled();
});

test('a failed connection keeps the saved configuration available for another attempt', async () => {
  const user = userEvent.setup();
  const { props, rerender } = setupDialog();
  await fillTarget(user);
  await user.click(screen.getByRole('button', { name: 'Save and connect' }));
  await waitFor(() => expect(props.onConnect).toHaveBeenCalledWith(saved, undefined, expect.any(Object)));
  expect(props.onSaved).toHaveBeenCalled();
  expect(props.onClose).not.toHaveBeenCalled();
  rerender(<ConnectionDialog {...props} connectionError="Authentication failed" />);
  expect(screen.getByRole('alert').textContent).toBe('Authentication failed');
  expect(screen.getByText('Configuration saved; connection did not succeed.')).toBeTruthy();
  vi.mocked(props.onConnect).mockResolvedValueOnce(true);
  await user.click(screen.getByRole('button', { name: 'Save and connect' }));
  await waitFor(() => expect(props.onClose).toHaveBeenCalledTimes(1));
});

test('quick connect parsing errors remain editable and connecting never saves the temporary target', async () => {
  const user = userEvent.setup();
  api.parse.mockRejectedValueOnce(new Error('Unsupported SSH option'));
  api.parse.mockResolvedValueOnce(saved);
  const { props } = setupDialog({ temporary: true });
  const address = screen.getByRole('textbox', { name: 'Address or SSH command' });
  await user.type(address, 'ssh -unsupported server.example');
  await user.click(screen.getByRole('button', { name: 'Parse' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Unsupported SSH option');
  expect(props.onConnect).not.toHaveBeenCalled();
  await user.clear(address);
  await user.type(address, 'operator@server.example:22');
  await user.click(screen.getByRole('button', { name: 'Parse' }));
  await waitFor(() => expect(screen.getByRole<HTMLInputElement>('textbox', { name: /^Host/ }).value).toBe(saved.host));
  expect(props.onConnect).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Connect' }));
  await waitFor(() => expect(props.onConnect).toHaveBeenCalledWith(expect.objectContaining({ host: saved.host }), expect.objectContaining({ host: saved.host }), expect.any(Object)));
  expect(api.save).not.toHaveBeenCalled();
});
