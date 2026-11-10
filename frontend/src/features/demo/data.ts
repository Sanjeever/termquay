import type {
  Connection,
  ConnectionPreference,
  Group,
} from '../../../bindings/github.com/Sanjeever/termquay/internal/store/models';
import type { Entry } from '../../../bindings/github.com/Sanjeever/termquay/internal/files/models';
import type { Sample } from '../../../bindings/github.com/Sanjeever/termquay/internal/monitor/models';
import type useConnectionLatency from '../connections/useConnectionLatency';

export const demoTime = Date.UTC(2026, 9, 20, 8, 30);
export const demoGroups: Group[] = [
  { id: 'demo-production', parent_id: '', name: '生产环境', sort_order: 0 },
  { id: 'demo-staging', parent_id: '', name: '预发布', sort_order: 1 },
  { id: 'demo-development', parent_id: '', name: '开发环境', sort_order: 2 },
];
export const demoConnections: Connection[] = [
  {
    id: 'demo-app-01',
    group_id: 'demo-production',
    name: '应用服务器 · 上海',
    protocol: 'ssh',
    host: 'app-01.example.com',
    port: 22,
    username: 'deploy',
    credential_id: '',
  },
  {
    id: 'demo-app-02',
    group_id: 'demo-production',
    name: '应用服务器 · 新加坡',
    protocol: 'ssh',
    host: 'app-02.example.com',
    port: 22,
    username: 'deploy',
    credential_id: '',
  },
  {
    id: 'demo-db-01',
    group_id: 'demo-production',
    name: '数据库服务器',
    protocol: 'ssh',
    host: 'db-01.example.com',
    port: 22,
    username: 'ops',
    credential_id: '',
  },
  {
    id: 'demo-gateway',
    group_id: 'demo-production',
    name: '运维网关',
    protocol: 'ssh',
    host: 'gateway.example.com',
    port: 22,
    username: 'ops',
    credential_id: '',
  },
  {
    id: 'demo-desktop',
    group_id: 'demo-staging',
    name: 'Windows 测试环境',
    protocol: 'rdp',
    host: 'desktop.example.com',
    port: 3389,
    username: 'tester',
    credential_id: '',
  },
  {
    id: 'demo-staging-app',
    group_id: 'demo-staging',
    name: '预发布应用',
    protocol: 'ssh',
    host: 'staging.example.com',
    port: 22,
    username: 'deploy',
    credential_id: '',
  },
  {
    id: 'demo-development-app',
    group_id: 'demo-development',
    name: '开发服务器',
    protocol: 'ssh',
    host: 'dev.example.com',
    port: 2222,
    username: 'developer',
    credential_id: '',
  },
  {
    id: 'demo-ci',
    group_id: 'demo-development',
    name: '构建节点',
    protocol: 'ssh',
    host: 'ci.example.com',
    port: 22,
    username: 'runner',
    credential_id: '',
  },
];
export const demoPreferences: Record<string, ConnectionPreference> = Object.fromEntries(
  demoConnections.map((connection, index) => [
    connection.id,
    {
      favorite: index === 0 || index === 2,
      environment:
        connection.group_id === 'demo-production'
          ? 'production'
          : connection.group_id === 'demo-staging'
            ? 'staging'
            : 'development',
      last_connected: index < 4 ? new Date(demoTime - index * 3600000).toISOString() : undefined,
    },
  ]),
);
export const demoLatency: ReturnType<typeof useConnectionLatency>['measurements'] =
  Object.fromEntries(
    demoConnections.map((connection, index) => [
      connection.id,
      {
        key: connection.id,
        refreshing: false,
        checkedAt: demoTime,
        result: {
          status: index === 7 ? 'timeout' : 'ok',
          milliseconds: [18, 86, 21, 16, 34, 22, 3, 0][index],
          error: '',
        },
      },
    ]),
  );

export const demoFiles: Record<string, string> = {
  '/srv/termquay/config/nginx.conf': `worker_processes auto;
pid /run/nginx.pid;

events {
    worker_connections 4096;
}

http {
    include       mime.types;
    default_type  application/octet-stream;
    sendfile      on;
    keepalive_timeout 65;

    upstream application {
        server 127.0.0.1:8080;
        keepalive 32;
    }

    server {
        listen 80;
        server_name app.example.com;

        location / {
            proxy_pass http://application;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
        }

        location /health {
            access_log off;
            return 200 "ok\\n";
        }
    }
}
`,
  '/srv/termquay/config/application.yaml': `server:
  address: 127.0.0.1
  port: 8080

application:
  name: termquay-demo
  environment: production

logging:
  level: info
  format: json

health:
  path: /health
  interval: 30s
`,
  '/srv/termquay/README.md': '# 示例应用\n\n此目录用于 TermQuay 界面演示。\n',
  '/srv/termquay/logs/application.log':
    '2026-10-20 08:30:00 INFO  服务已启动，监听 127.0.0.1:8080\n2026-10-20 08:30:01 INFO  健康检查通过\n',
};
function entry(path: string, directory: boolean): Entry {
  return {
    path,
    name: path.slice(path.lastIndexOf('/') + 1),
    directory,
    symlink: false,
    mode: directory ? 'drwxr-xr-x' : '-rw-r--r--',
    size: directory ? 4096 : new TextEncoder().encode(demoFiles[path]).length,
    modified: demoTime,
    uid: 1000,
    gid: 1000,
  };
}
export const demoDirectories: Record<string, Entry[]> = {
  '/': [entry('/etc', true), entry('/srv', true), entry('/var', true)],
  '/etc': [],
  '/var': [],
  '/srv': [entry('/srv/termquay', true)],
  '/srv/termquay': [
    entry('/srv/termquay/config', true),
    entry('/srv/termquay/logs', true),
    entry('/srv/termquay/README.md', false),
  ],
  '/srv/termquay/config': [
    entry('/srv/termquay/config/nginx.conf', false),
    entry('/srv/termquay/config/application.yaml', false),
  ],
  '/srv/termquay/logs': [entry('/srv/termquay/logs/application.log', false)],
};
export const demoTerminal = [
  '\x1b[1;32mdeploy@app-01\x1b[0m:\x1b[34m/srv/termquay\x1b[0m$ systemctl status application --no-pager',
  '\x1b[32m●\x1b[0m application.service - Application Server',
  '     Loaded: loaded (/etc/systemd/system/application.service; enabled)',
  '     Active: \x1b[32mactive (running)\x1b[0m since Tue 2026-10-20 08:00:00 UTC',
  '   Main PID: 1842 (application)',
  '      Tasks: 12',
  '     Memory: 128.4M',
  '        CPU: 24.810s',
  '',
  '\x1b[1;32mdeploy@app-01\x1b[0m:\x1b[34m/srv/termquay\x1b[0m$ curl -s http://127.0.0.1:8080/health',
  '{"status":"ok","uptime":"30m","version":"1.0.0"}',
  '',
  '\x1b[1;32mdeploy@app-01\x1b[0m:\x1b[34m/srv/termquay\x1b[0m$ tail -n 4 logs/application.log',
  '08:29:56 INFO  请求完成  GET /api/connections  200  12ms',
  '08:29:57 INFO  请求完成  GET /api/health       200   1ms',
  '08:29:58 INFO  后台任务完成，处理 24 项',
  '08:30:00 INFO  健康检查通过',
  '',
  '\x1b[1;32mdeploy@app-01\x1b[0m:\x1b[34m/srv/termquay\x1b[0m$ ',
].join('\r\n');
export const demoSamples: Sample[] = Array.from({ length: 100 }, (_, index) => ({
  time: new Date(demoTime - (99 - index) * 3000).toISOString(),
  system: 'Ubuntu 24.04 LTS · 4 vCPU',
  cpu: Math.round((16 + Math.sin(index * 0.21) * 5 + Math.cos(index * 0.57) * 3) * 10) / 10,
  memory_total: 8 * 1024 ** 3,
  memory_available: Math.round((5.2 + Math.sin(index * 0.08) * 0.15) * 1024 ** 3),
  network: [
    {
      name: 'eth0',
      read: 0,
      write: 0,
      read_rate: Math.round((180 + Math.sin(index * 0.18) * 60) * 1024),
      write_rate: Math.round((90 + Math.cos(index * 0.22) * 30) * 1024),
    },
  ],
  disks: [{ name: 'vda', read: 0, write: 0, read_rate: 0, write_rate: 32 * 1024 }],
  file_systems: {
    time: new Date(demoTime).toISOString(),
    error: '',
    items: [
      {
        source: '/dev/vda1',
        target: '/',
        type: 'ext4',
        size: 80 * 1024 ** 3,
        used: 24 * 1024 ** 3,
        available: 56 * 1024 ** 3,
      },
    ],
  },
}));
