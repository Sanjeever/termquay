export type CommandKind = 'workspace' | 'connection' | 'command';
export const commandKinds: CommandKind[] = ['workspace', 'connection', 'command'];
export function commandResults<
  T extends {
    kind: CommandKind;
    label: string;
    detail?: string;
    search?: string;
    alternateName?: string;
    priority?: number;
    queryOnly?: boolean;
  },
>(commands: T[], query: string, scope: 'all' | CommandKind) {
  const normalized = query.trim().toLowerCase();
  const terms = normalized.split(/\s+/).filter(Boolean);
  const limits = normalized
    ? { workspace: 16, command: 20, connection: 14 }
    : { workspace: 4, command: 8, connection: 5 };
  const results = commandKinds.flatMap((kind) => {
    if (scope !== 'all' && kind !== scope) return [];
    const matches = commands
      .filter((command) => command.kind === kind && (!command.queryOnly || !!normalized))
      .flatMap((command) => {
        const label = command.label.toLowerCase();
        const alternate = command.alternateName?.toLowerCase() || '';
        const text =
          `${label} ${alternate} ${command.detail || ''} ${command.search || ''}`.toLowerCase();
        if (!terms.every((term) => text.includes(term))) return [];
        const relevance = !normalized
          ? 0
          : label === normalized || alternate === normalized
            ? 2
            : Number(label.startsWith(normalized) || alternate.startsWith(normalized));
        return [{ command, relevance }];
      });
    matches.sort(
      (a, b) => b.relevance - a.relevance || (b.command.priority ?? 0) - (a.command.priority ?? 0),
    );
    const limit = scope === 'workspace' ? matches.length : scope === 'all' ? limits[kind] : 50;
    return matches.slice(0, limit);
  });
  if (normalized && scope === 'all') results.sort((a, b) => b.relevance - a.relevance);
  return results.map(({ command }) => command);
}
