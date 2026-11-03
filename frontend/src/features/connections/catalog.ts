import type { Connection, ConnectionPreference, Group } from '../../../bindings/github.com/Sanjeever/termquay/internal/store/models';

export type CatalogSort = 'name' | 'address' | 'username' | 'protocol' | 'recent';

export function catalogConnections(connections: Connection[], groups: Group[], preferences: Record<string, ConnectionPreference | undefined>, scope: { view: string; group: string; protocol: string; search: string; sort: CatalogSort; descending?: boolean }) {
  const descendants = new Set([scope.group]);
  for (let i = 0; i < groups.length; i++) for (const group of groups) if (descendants.has(group.parent_id)) descendants.add(group.id);
  const query = scope.search.trim().toLowerCase();
  const groupNames = new Map(groups.map(group => [group.id, group.name]));
  return connections.filter(c => (scope.view === 'all' || (scope.view === 'favorite' ? preferences[c.id]?.favorite : preferences[c.id]?.last_connected))
    && (scope.protocol === 'all' || c.protocol === scope.protocol)
    && (!scope.group || (scope.group === 'ungrouped' ? !c.group_id : descendants.has(c.group_id)))
    && `${c.name} ${c.host} ${c.username} ${c.port} ${groupNames.get(c.group_id) || ''}`.toLowerCase().includes(query))
    .sort((a, b) => ((scope.sort === 'recent' ? (Date.parse(preferences[b.id]?.last_connected || '') || 0) - (Date.parse(preferences[a.id]?.last_connected || '') || 0)
      : scope.sort === 'address' ? a.host.localeCompare(b.host, undefined, { numeric: true }) || a.port - b.port
      : scope.sort === 'username' ? a.username.localeCompare(b.username, undefined, { numeric: true })
      : scope.sort === 'protocol' ? a.protocol.localeCompare(b.protocol) : a.name.localeCompare(b.name, 'zh-CN', { numeric: true })) || a.name.localeCompare(b.name, 'zh-CN') || a.id.localeCompare(b.id)) * (scope.descending ? -1 : 1));
}
