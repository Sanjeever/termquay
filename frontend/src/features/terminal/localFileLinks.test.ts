import { expect, test } from 'vitest';
import { absoluteLocalPath, localFileReferences } from './localFileLinks';

test('file references preserve line and column and support native, relative and quoted paths', () => {
  for (const [text, path, line, column] of [
    ['/work/main.go:42:8', '/work/main.go', 42, 8],
    ['src/App.tsx:12', 'src/App.tsx', 12, 1],
    ['./src/App.tsx#L12C5', './src/App.tsx', 12, 5],
    ['C:\\work\\main.go:42:8', 'C:\\work\\main.go', 42, 8],
    ['"/work/中文 space.go":42:8', '/work/中文 space.go', 42, 8],
    ['`src/App.tsx:12`', 'src/App.tsx', 12, 1],
    ['README.md', 'README.md', 1, 1],
  ] as const) {
    const links = localFileReferences(text);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ path, line, column });
  }
  expect(absoluteLocalPath('C:\\work\\file')).toBe(true);
  expect(absoluteLocalPath('../file')).toBe(false);
});

test('file reference parsing ignores prose and URLs and bounds work', () => {
  expect(localFileReferences('https://example.com/file.go ordinary words')).toEqual([]);
  expect(localFileReferences('src/app.ts:0')).toEqual([]);
  expect(localFileReferences('src/app.ts:999999999999')).toEqual([]);
  expect(localFileReferences('x'.repeat(8193))).toEqual([]);
  expect(localFileReferences('a.ts '.repeat(100))).toHaveLength(32);
});
