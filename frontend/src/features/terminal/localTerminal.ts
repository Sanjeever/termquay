import { fileTabContexts } from '../files/fileTypes';
import type { Workspace } from '../workspaces/workspace';

export function localDirectoryName(directory: string) {
  const path = directory.replace(/\\/g, '/').replace(/\/$/, '');
  return path.slice(path.lastIndexOf('/') + 1) || directory;
}

export function localTerminalLabels(workspaces: Workspace[]) {
  const directories = workspaces.flatMap((workspace) =>
    workspace.local && !workspace.local.renamed
      ? [workspace.local.directory.replace(/\\/g, '/').replace(/\/$/, '')]
      : [],
  );
  const contexts = fileTabContexts(directories);
  return new Map(
    workspaces.map((workspace) => {
      const path = workspace.local?.directory.replace(/\\/g, '/').replace(/\/$/, '');
      const context = path && !workspace.local?.renamed ? contexts.get(path) : undefined;
      return [workspace.id, context ? `${workspace.name} · ${context}` : workspace.name];
    }),
  );
}

export function localDirectoryReport(path: string, host: string, hostname: string, kind: string) {
  if (kind === 'wsl') return undefined;
  const name = hostname.toLowerCase();
  if (host && !['localhost', name, name.split('.')[0]].includes(host.toLowerCase()))
    return undefined;
  return /^\/[a-z]:\//i.test(path) ? path.slice(1).replace(/\//g, '\\') : path;
}
