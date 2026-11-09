import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import { captureWorkspaceLayout } from './workspaceLayout.ts';
import type { Workspace } from './workspace';
import type { SSHLayout } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';

const ssh: SSHLayout = { tabs: [{ kind: 'file', path: '/tmp/test-config', pane: 0 }], selected: [0, -1], active_pane: 0, split: false, maximized: false, ratio: 50, directory: '/tmp', files_open: true, files_width: 248, monitor_open: false, focus: false };
const workspace = (): Workspace => ({ id: 'workspace', connectionID: 'connection', name: '测试工作区', connection: { id: 'connection', group_id: '', credential_id: 'test-credential-reference', name: '测试连接', protocol: 'ssh', host: 'example.invalid', port: 22, username: 'test' }, restore: ssh });

test('布局保留文件入口和活动工作区，排除凭据引用与本地终端', () => {
  const item = workspace();
  const layout = captureWorkspaceLayout([item, { id: 'local', name: '本地终端', connectionID: '' }], item.id)!;
  assert.equal(layout.active, item.id);
  assert.equal(layout.entries?.length, 1);
  assert.deepEqual(layout.entries?.[0].ssh, ssh);
  assert.equal(JSON.stringify(layout).includes('test-credential-reference'), false);
  assert.equal(captureWorkspaceLayout([item], 'local')?.active, '');
});

test('SSH 布局未就绪时不产生可覆盖旧布局的快照', () => {
  const item = workspace();
  item.restore = undefined;
  assert.equal(captureWorkspaceLayout([item], item.id), undefined);
});

test('布局版本随认证、代理与跳板能力选择', () => {
  for (const [patch, version] of [
    [{}, 1],
    [{ auth_method: 'password' }, 2],
    [{ identity_agent: '/tmp/test-agent' }, 2],
    [{ mfa: true }, 4],
    [{ proxy_address: '127.0.0.1:1080' }, 6],
    [{ jump_id: 'test-jump', proxy_address: '127.0.0.1:1080' }, 7],
  ] as const) {
    const item = workspace();
    item.connection = { ...item.connection!, ...patch };
    assert.equal(captureWorkspaceLayout([item], item.id)?.version, version);
  }
});
