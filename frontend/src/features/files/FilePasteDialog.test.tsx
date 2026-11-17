import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import type { DirectorySyncPreview } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import FilePasteDialog from './FilePasteDialog';

const api = vi.hoisted(() => ({
  execute: vi.fn().mockResolvedValue({}),
  preview: vi.fn(),
  cancel: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice', () => ({
  ExecuteFilePaste: api.execute,
  PreviewClipboardPaste: api.preview,
  CancelDirectorySyncPreview: api.cancel,
}));
const preview = {
  id: 'plan',
  direction: 'copy',
  local: '/',
  remote: '/target',
  paste_items: [{ source: '/source/file', name: 'file', exists: false }],
  entries: [{ path: 'file', state: 'new', directory: false, size: 1 }],
} as DirectorySyncPreview;

test('renaming requires a new preview before copying', async () => {
  const user = userEvent.setup();
  const close = vi.fn();
  api.preview.mockResolvedValue({
    ...preview,
    id: 'renamed',
    paste_items: [{ ...preview.paste_items![0], name: 'renamed' }],
  });
  api.execute.mockClear();
  render(<FilePasteDialog workspace="workspace" initialPreview={preview} onClose={close} />);
  const input = screen.getByRole('textbox');
  await user.clear(input);
  await user.type(input, 'renamed');
  await user.click(screen.getByRole('button', { name: 'Preview' }));
  await waitFor(() =>
    expect(api.preview).toHaveBeenCalledWith('workspace', '/target', ['renamed']),
  );
  expect(api.execute).not.toHaveBeenCalled();
  await user.click(await screen.findByRole('button', { name: 'Copy' }));
  await waitFor(() =>
    expect(api.execute).toHaveBeenCalledWith('renamed', [{ name: 'renamed', action: 'copy' }]),
  );
  expect(close).toHaveBeenCalled();
});

test('unsupported contents require acknowledging the skipped paths', async () => {
  const user = userEvent.setup();
  render(
    <FilePasteDialog
      workspace="workspace"
      initialPreview={{
        ...preview,
        entries: [
          ...preview.entries!,
          { path: 'file/link', state: 'conflict', directory: false, size: 0 },
        ],
      }}
      onClose={() => {}}
    />,
  );
  expect((screen.getByRole('button', { name: 'Copy' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText('file/link')).toBeTruthy();
  await user.click(screen.getByRole('checkbox'));
  expect((screen.getByRole('button', { name: 'Copy' }) as HTMLButtonElement).disabled).toBe(false);
});
