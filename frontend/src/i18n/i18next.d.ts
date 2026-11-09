import status from './locales/en/status.json';
import backend from './locales/en/backend.json';
import terminal from './locales/en/terminal.json';
import files from './locales/en/files.json';
import workspaces from './locales/en/workspaces.json';
import tunnels from './locales/en/tunnels.json';
import rdp from './locales/en/rdp.json';
import monitor from './locales/en/monitor.json';
import logs from './locales/en/logs.json';
import docker from './locales/en/docker.json';
import demo from './locales/en/demo.json';
import connections from './locales/en/connections.json';
import ai from './locales/en/ai.json';
import 'i18next';
import common from './locales/en/common.json';
import settings from './locales/en/settings.json';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common';
    resources: { common: typeof common; status: typeof status; backend: typeof backend; terminal: typeof terminal; files: typeof files; workspaces: typeof workspaces; tunnels: typeof tunnels; rdp: typeof rdp; monitor: typeof monitor; logs: typeof logs; docker: typeof docker; demo: typeof demo; connections: typeof connections; ai: typeof ai; settings: typeof settings };
  }
}
