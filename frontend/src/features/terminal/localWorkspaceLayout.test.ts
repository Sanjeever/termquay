import { expect, test } from 'vitest';
import { localSplitPlan } from './localWorkspaceLayout';

test('directional splits retain existing panes and insert next to the focused terminal', () => {
  expect(localSplitPlan('single', ['a'], 'a', 'Right')).toEqual({
    layout: 'columns2',
    panes: ['a', ''],
    position: 1,
  });
  expect(localSplitPlan('columns2', ['a', 'b'], 'a', 'Right')).toEqual({
    layout: 'columns3',
    panes: ['a', '', 'b'],
    position: 1,
  });
  expect(localSplitPlan('rows2', ['a', 'b'], 'b', 'Right')).toEqual({
    layout: 'grid',
    panes: ['a', '', 'b', ''],
    position: 3,
  });
  expect(localSplitPlan('columns2', ['a', 'b'], 'b', 'Down')).toEqual({
    layout: 'grid',
    panes: ['a', 'b', '', ''],
    position: 3,
  });
});

test('empty neighboring cells are filled without expanding or replacing a session', () => {
  expect(localSplitPlan('grid', ['a', 'b'], 'a', 'Down')).toEqual({
    layout: 'grid',
    panes: ['a', 'b'],
    position: 2,
  });
  expect(localSplitPlan('grid', ['a', 'b', 'c', 'd'], 'a', 'Right')).toBeUndefined();
  expect(localSplitPlan('columns3', ['a', 'b', 'c'], 'b', 'Right')).toBeUndefined();
});
