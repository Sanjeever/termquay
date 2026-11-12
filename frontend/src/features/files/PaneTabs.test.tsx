import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import PaneTabs from './PaneTabs';

test('middle click uses the targeted tab close flow and respects disabled closing', () => {
  const onClose = vi.fn();
  const onSelect = vi.fn();
  render(
    <PaneTabs
      pane={1}
      column={3}
      focused={false}
      hidden={false}
      creating={false}
      selected="terminal"
      items={[
        { id: 'terminal', label: 'Terminal', terminal: true },
        { id: '/dirty.txt', label: 'dirty.txt', terminal: false, dirty: true },
        { id: '/saving.txt', label: 'saving.txt', terminal: false, closingDisabled: true },
      ]}
      onClose={onClose}
      onSelect={onSelect}
      onNew={() => {}}
      newShortcut="Ctrl+T"
      closeShortcut="Ctrl+W"
    />,
  );
  for (const tab of screen.getAllByRole('tab')) {
    expect(fireEvent.mouseDown(tab, { button: 1 })).toBe(false);
    fireEvent(tab, new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true }));
  }
  expect(onClose.mock.calls).toEqual([['terminal'], ['/dirty.txt']]);
  expect(onSelect).not.toHaveBeenCalled();
  const tab = screen.getByRole('tab', { name: '/dirty.txt' });
  fireEvent(tab, new MouseEvent('auxclick', { button: 2, bubbles: true }));
  fireEvent.click(tab);
  expect(onClose).toHaveBeenCalledTimes(2);
  expect(onSelect).toHaveBeenCalledWith('/dirty.txt');
});
