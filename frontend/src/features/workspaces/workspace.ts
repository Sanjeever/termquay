import type { RefObject } from 'react';
import type {
  SSHLayout,
  SSHRouteHop,
} from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import type { Connection } from '../../../bindings/github.com/Sanjeever/termquay/internal/store/models';
import type { Grant } from '../../../bindings/github.com/Sanjeever/termquay/internal/rdp/models';
import type { SSHWorkspaceHandle } from '../files/SSHWorkspace';
import type { RDPHandle, RDPOptions } from '../rdp/RDPView';
import type { TerminalHandle } from '../terminal/TerminalView';
import type { CommandAttention } from '../terminal/commandAttention';

export type Workspace = {
  id: string;
  sessionID?: string;
  route?: SSHRouteHop[];
  connection?: Connection;
  connectionID: string;
  name: string;
  state?: string;
  restore?: SSHLayout;
  restored?: boolean;
  rdp?: { connection: Connection; grant?: Grant; error?: unknown; options: RDPOptions };
  local?: {
    shell: string;
    kind: string;
    directory: string;
    hostname: string;
    renamed?: boolean;
    terminal: RefObject<TerminalHandle>;
  };
  view?: RefObject<RDPHandle>;
  ssh?: RefObject<SSHWorkspaceHandle>;
  dirty?: boolean;
  attention?: CommandAttention;
};
