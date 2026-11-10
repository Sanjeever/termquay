export const localWorkspaceLayouts = {
  single: { columns: 1, rows: 1 },
  columns2: { columns: 2, rows: 1 },
  rows2: { columns: 1, rows: 2 },
  columns3: { columns: 3, rows: 1 },
  rows3: { columns: 1, rows: 3 },
  grid: { columns: 2, rows: 2 },
} as const;

export type LocalWorkspaceLayout = keyof typeof localWorkspaceLayouts;

export function localPaneCount(layout: LocalWorkspaceLayout) {
  const { columns, rows } = localWorkspaceLayouts[layout];
  return columns * rows;
}

export function localPaneNeighbor(layout: LocalWorkspaceLayout, index: number, direction: string) {
  const { columns, rows } = localWorkspaceLayouts[layout];
  const column = index % columns;
  const row = Math.floor(index / columns);
  if (direction === 'Left' && column > 0) return index - 1;
  if (direction === 'Right' && column < columns - 1) return index + 1;
  if (direction === 'Up' && row > 0) return index - columns;
  if (direction === 'Down' && row < rows - 1) return index + columns;
  return index;
}

export function localGridTracks(boundaries: number[]) {
  return [...boundaries, 100]
    .map((value, index) => `minmax(0,${value - (boundaries[index - 1] ?? 0)}fr)`)
    .join(' 5px ');
}

export function equalPaneBoundaries(count: number) {
  return Array.from({ length: count - 1 }, (_, index) => ((index + 1) * 100) / count);
}
