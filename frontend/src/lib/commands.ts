export type CommandKind = 'workspace' | 'connection' | 'command';
export const commandKinds: CommandKind[] = ['workspace', 'connection', 'command'];
export function commandResults<
  T extends {
    kind: CommandKind;
    label: string;
    detail?: string;
    search?: string;
    priority?: number;
    queryOnly?: boolean;
  },
>(commands: T[], query: string, scope: 'all' | CommandKind) {
  const normalized = query.trim().toLowerCase();
  const terms = normalized.split(/\s+/).filter(Boolean);
  const limits = normalized
    ? { workspace: 16, command: 20, connection: 14 }
    : { workspace: 4, command: 8, connection: 5 };
  return commandKinds.flatMap((kind) => {
    if (scope !== 'all' && kind !== scope) return [];
    const matches = commands
      .filter((command) => command.kind === kind && (!command.queryOnly || !!normalized))
      .flatMap((command) => {
        const label = command.label.toLowerCase();
        const text = `${label} ${command.detail || ''} ${command.search || ''}`.toLowerCase();
        if (!terms.every((term) => text.includes(term))) return [];
        const relevance = !normalized
          ? 0
          : label === normalized
            ? 2
            : +label.startsWith(normalized);
        return [{ command, relevance }];
      });
    matches.sort(
      (a, b) => b.relevance - a.relevance || (b.command.priority ?? 0) - (a.command.priority ?? 0),
    );
    const limit = scope === 'workspace' ? matches.length : scope === 'all' ? limits[kind] : 50;
    return matches.slice(0, limit).map(({ command }) => command);
  });
}
