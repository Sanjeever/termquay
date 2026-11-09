export type CommandKind = 'workspace' | 'connection' | 'command';
export const commandKinds: CommandKind[] = ['workspace', 'command', 'connection'];
export function commandResults<T extends { kind: CommandKind; label: string; detail?: string; search?: string }>(commands: T[], query: string, scope: 'all' | CommandKind) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const limits = { workspace: 16, command: 20, connection: 14 };
  return commandKinds.flatMap(kind => scope !== 'all' && kind !== scope ? [] : commands.filter(c => c.kind === kind && terms.every(term => `${c.label} ${c.detail || ''} ${c.search || ''}`.toLowerCase().includes(term))).slice(0, scope === 'workspace' ? commands.length : scope === 'all' ? limits[kind] : 50));
}
