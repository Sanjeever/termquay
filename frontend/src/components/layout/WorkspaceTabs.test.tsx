import { fireEvent, render, screen } from '@testing-library/react';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import WorkspaceTabs from './WorkspaceTabs';

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
});
afterAll(() => Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView'));

test('middle click closes the target workspace or tool without selecting it and keeps connection center fixed', () => {
  const onClose = vi.fn();
  const onSelect = vi.fn();
  render(
    <WorkspaceTabs
      items={[
        { id: 'active', name: 'Active' },
        { id: 'background', name: 'Background' },
        { id: 'tool', name: 'Tool', tool: true },
      ]}
      active="active"
      onClose={onClose}
      onSelect={onSelect}
      onNew={() => {}}
      onRename={() => {}}
      onMove={() => {}}
      onSearch={() => {}}
    />,
  );
  for (const name of ['Background', 'Active', 'Tool', 'Connection center']) {
    const tab = screen.getByRole('tab', { name });
    expect(fireEvent.mouseDown(tab, { button: 1 })).toBe(false);
    fireEvent(tab, new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true }));
  }
  expect(onClose.mock.calls).toEqual([
    ['background', false],
    ['active', false],
    ['tool', false],
  ]);
  expect(onSelect).not.toHaveBeenCalled();
  const tab = screen.getByRole('tab', { name: 'Background' });
  fireEvent(tab, new MouseEvent('auxclick', { button: 2, bubbles: true }));
  fireEvent.click(tab);
  expect(onClose).toHaveBeenCalledTimes(3);
  expect(onSelect).toHaveBeenCalledWith('background');
  fireEvent.doubleClick(tab);
  fireEvent(screen.getByRole('textbox'), new MouseEvent('auxclick', { button: 1, bubbles: true }));
  expect(onClose).toHaveBeenCalledTimes(3);
});
