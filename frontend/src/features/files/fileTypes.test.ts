import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import { fileTabContexts } from './fileTypes.ts';

test('duplicate filenames use the shortest distinguishing parent suffix across panes', () => {
  const paths = [
    '/etc/nginx/nginx.conf',
    '/srv/nginx/nginx.conf',
    '/etc/app.yaml',
    '/app.yaml',
    '/srv/unique.conf',
  ];
  const labels = fileTabContexts(paths);
  assert.equal(labels.get(paths[0]), 'etc/nginx');
  assert.equal(labels.get(paths[1]), 'srv/nginx');
  assert.equal(labels.get(paths[2]), 'etc');
  assert.equal(labels.get(paths[3]), '/');
  assert.equal(labels.has(paths[4]), false);
  assert.equal(
    fileTabContexts(['/etc/app.yaml', '/srv/etc/app.yaml']).get('/etc/app.yaml'),
    '/etc',
  );
  assert.equal(fileTabContexts(['/etc/app.yaml', '/etc/app.yaml']).size, 0);
});
