import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import LocalTerminalLauncher from './LocalTerminalLauncher';

test('the visible launcher opens a shell, picks a directory and reuses a recent path', async () => {
  const user = userEvent.setup();
  const open = vi.fn();
  const choose = vi.fn();
  render(
    <LocalTerminalLauncher
      compact
      shells={[
        { id: 'shell', name: 'Shell' },
        { id: 'powershell', name: 'PowerShell' },
      ]}
      shell="shell"
      directory="/work/project"
      recent={['/work/project', '/work/another']}
      disabled={false}
      onOpen={open}
      onChooseDirectory={choose}
    />,
  );
  await user.click(screen.getByRole('button', { name: 'New local terminal' }));
  expect(open).toHaveBeenCalledWith('shell');
  await user.click(screen.getByRole('button', { name: 'Local terminal options' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Open in directory…' }));
  expect(choose).toHaveBeenCalledWith('shell');
  await user.click(screen.getByRole('button', { name: 'Local terminal options' }));
  await user.click(await screen.findByRole('menuitem', { name: 'PowerShell' }));
  expect(open).toHaveBeenCalledWith('powershell');
  await user.click(screen.getByRole('button', { name: 'Local terminal options' }));
  await user.click(await screen.findByRole('menuitem', { name: '/work/another' }));
  expect(open).toHaveBeenCalledWith('shell', '/work/another');
});
