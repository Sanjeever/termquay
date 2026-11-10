import type {
  WorkspaceLayout,
  WorkspaceLayoutEntry,
} from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import type { Workspace } from './workspace';

export function captureWorkspaceLayout(
  workspaces: Workspace[],
  active: string,
): WorkspaceLayout | undefined {
  const entries: WorkspaceLayoutEntry[] = [];
  for (const workspace of workspaces) {
    const connection = workspace.rdp?.connection || workspace.connection;
    if (!connection) continue;
    const ssh = workspace.ssh?.current?.layout() || workspace.restore;
    if (connection.protocol === 'ssh' && !ssh) return;
    entries.push({
      id: workspace.id,
      connection_id: workspace.connectionID,
      name: workspace.name,
      target: {
        name: connection.name,
        protocol: connection.protocol,
        host: connection.host,
        port: connection.port,
        username: connection.username,
        domain: connection.domain || '',
        auth_method: connection.auth_method || '',
        identity_agent: connection.identity_agent || '',
        jump_id: connection.jump_id || '',
        mfa: connection.mfa,
        proxy_address: connection.proxy_address,
      },
      ...(ssh ? { ssh } : {}),
    });
  }
  const version = entries.some((entry) => entry.ssh?.tabs?.some((tab) => tab.tmux_session))
    ? 8
    : entries.some((entry) => entry.target.jump_id)
      ? 7
      : entries.some((entry) => entry.target.proxy_address)
        ? 6
        : entries.some(
              (entry) => entry.target.mfa || entry.target.auth_method === 'keyboard_interactive',
            )
          ? 4
          : entries.some((entry) => entry.target.auth_method || entry.target.identity_agent)
            ? 2
            : 1;
  return { version, active: entries.some((entry) => entry.id === active) ? active : '', entries };
}
