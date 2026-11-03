import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import type { Entry } from '../../../bindings/github.com/Sanjeever/termquay/internal/files/models';
import { directoryAncestors, fileTreeRows, inDirectory, entryMetadata, uploadRefreshPaths } from './fileTree.ts';

const entry = (path: string, directory = false, size = 0): Entry => ({ path, name: path.split('/').pop()!, directory, size, modified: 1700000000000, mode: directory ? 'drwxr-xr-x' : '-rw-r--r--', symlink: false, uid: 0, gid: 1000 });
const nodes = { '/': { entries: [entry('/root', true), entry('/etc', true)], loading: false, error: '' }, '/root': { entries: [entry('/root/.cache', true), entry('/root/main.go'), entry('/root/config.json', false, 2048)], loading: false, error: '' } };
const options = { filter: '', showHidden: true, sort: 'name', descending: false };

test('上传完成刷新实际目标分支，目录同步覆盖已缓存子目录', () => {
  const cached = ['/', '/root', '/root/child', '/root-other', '/etc'];
  const task = { state: 'done', direction: 'upload', destination_path: '/root/file', directory: false };
  assert.deepEqual(uploadRefreshPaths(task, cached), ['/root']);
  assert.deepEqual(uploadRefreshPaths({ ...task, destination_path: '/file' }, cached), ['/']);
  assert.deepEqual(uploadRefreshPaths({ ...task, destination_path: '/uncached/file' }, cached), []);
  assert.deepEqual(uploadRefreshPaths({ ...task, destination_path: '/root', directory: true }, cached), ['/root', '/root/child']);
  for (const state of ['queued', 'running', 'failed', 'skipped', 'cancelled']) assert.deepEqual(uploadRefreshPaths({ ...task, state }, cached), []);
  assert.deepEqual(uploadRefreshPaths({ ...task, direction: 'download' }, cached), []);
});

test('展示所有根节点，展开目录后保持父子关系及层级', () => {
  const rows = fileTreeRows(nodes, new Set(['/', '/root']), options);
  assert.deepEqual(rows.map(row => [row.entry.path, row.depth]), [['/etc', 0], ['/root', 0], ['/root/.cache', 1], ['/root/config.json', 1], ['/root/main.go', 1]]);
  assert.deepEqual(fileTreeRows(nodes, new Set(['/']), options).map(row => row.entry.path), ['/etc', '/root']);
});
test('过滤保留匹配项祖先，隐藏项与各目录排序可组合', () => {
  assert.deepEqual(fileTreeRows(nodes, new Set(['/', '/root']), { ...options, filter: 'main' }).map(row => row.entry.path), ['/root', '/root/main.go']);
  assert.ok(!fileTreeRows(nodes, new Set(['/', '/root']), { ...options, showHidden: false }).some(row => row.entry.name === '.cache'));
  assert.equal(fileTreeRows(nodes, new Set(['/', '/root']), { ...options, sort: 'size', descending: true }).slice(-2)[0].entry.name, 'config.json');
});
test('路径边界不混淆相似目录名，根目录没有重复祖先', () => {
  assert.deepEqual(directoryAncestors('/'), ['/']);
  assert.deepEqual(directoryAncestors('/root/.config'), ['/', '/root', '/root/.config']);
  assert.ok(inDirectory('/root/file', '/root'));
  assert.ok(!inDirectory('/root-other', '/root'));
});
test('元数据保留零 UID、毫秒时间与准确字节数', () => {
  const data = Object.fromEntries(entryMetadata(entry('/root/config.json', false, 2048)));
  assert.equal(data['UID / GID'], '0 / 1000');
  assert.match(data['大小'], /2.0 KiB/);
  assert.equal(data['修改时间'], new Date(1700000000000).toLocaleString());
});

test('目录链接按目录展开，元数据显示原始目标和真实路径', () => {
  const link = { ...entry('/alias', true), symlink: true, link_target: 'root', link_resolved: '/root' };
  const rows = fileTreeRows({ '/': { entries: [link], loading: false, error: '' }, '/alias': { entries: [entry('/alias/file')], loading: false, error: '' } }, new Set(['/', '/alias']), options);
  assert.deepEqual(rows.map(row => row.entry.path), ['/alias', '/alias/file']);
  const metadata = Object.fromEntries(entryMetadata(link));
  assert.equal(metadata['链接指向'], 'root');
  assert.equal(metadata['实际路径'], '/root');
  assert.equal(metadata['目标类型'], '目录');
});
