import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { catalogConnections } from './catalog.ts';
import type { Connection, ConnectionPreference, Group } from '../../../bindings/github.com/Sanjeever/termquay/internal/store/models';

const connections = [
  { id: 'a', name: '节点 10', host: 'host10', port: 22, username: 'admin', group_id: 'child', protocol: 'ssh' },
  { id: 'b', name: '节点 2', host: 'host2', port: 3389, username: 'operator', group_id: '', protocol: 'rdp' },
  { id: 'c', name: '节点 3', host: 'host3', port: 22, username: 'admin', group_id: 'parent', protocol: 'ssh' },
] as Connection[];
const groups = [{ id: 'parent', name: '生产', parent_id: '' }, { id: 'child', name: '应用', parent_id: 'parent' }] as Group[];
const preferences = { a: { favorite: true, environment: '', last_connected: '2026-11-01T00:00:00Z' }, b: { favorite: false, environment: '', last_connected: '2026-11-02T00:00:00Z' } } as Record<string, ConnectionPreference>;
const scope = { view: 'all', group: '', protocol: 'all', search: '', sort: 'name' as const };
const ids = (values: Connection[]) => values.map(c => c.id);

test('范围、子分组、协议与检索字段可组合', () => {
  assert.deepEqual(ids(catalogConnections(connections, groups, preferences, { ...scope, group: 'parent', protocol: 'ssh', search: '应用' })), ['a']);
  assert.deepEqual(ids(catalogConnections(connections, groups, preferences, { ...scope, view: 'favorite', search: 'admin' })), ['a']);
  assert.deepEqual(ids(catalogConnections(connections, groups, preferences, { ...scope, group: 'ungrouped', search: '3389' })), ['b']);
});
test('自然排序、地址排序及缺失最近记录顺序稳定且不修改源数据', () => {
  assert.deepEqual(ids(catalogConnections(connections, groups, preferences, scope)), ['b', 'c', 'a']);
  assert.deepEqual(ids(catalogConnections(connections, groups, preferences, { ...scope, sort: 'address' })), ['b', 'c', 'a']);
  assert.deepEqual(ids(catalogConnections(connections, groups, preferences, { ...scope, sort: 'recent' })), ['b', 'a', 'c']);
  assert.deepEqual(ids(catalogConnections(connections, groups, preferences, { ...scope, view: 'recent', sort: 'recent' })), ['b', 'a']);
  assert.deepEqual(ids(connections), ['a', 'b', 'c']);
});
