import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {versionCommand} from './version.mjs';

const source = fileURLToPath(new URL('../', import.meta.url));
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'termquay-version-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  for (const name of ['frontend/package.json', 'build/config.yml', 'build/windows/info.json', 'build/windows/msix/app_manifest.xml', 'build/windows/msix/template.xml', 'build/windows/wails.exe.manifest', 'build/windows/nsis/wails_tools.nsh', 'build/darwin/Info.plist', 'build/darwin/Info.dev.plist', 'build/linux/nfpm/nfpm.yaml']) {
    const target = join(root, name); mkdirSync(join(target, '..'), {recursive: true}); cpSync(join(source, name), target);
  }
  mkdirSync(join(root, 'docs/releases'), {recursive: true});
  return root;
}

test('缺少或空白日志时，bump 保持版本文件原值', t => {
  const root = fixture(t), path = join(root, 'frontend/package.json'), before = readFileSync(path, 'utf8');
  assert.throws(() => versionCommand(root, 'bump', '1.2.3'), /缺少更新日志/);
  writeFileSync(join(root, 'docs/releases/1.2.3.md'), ' \n');
  assert.throws(() => versionCommand(root, 'bump', '1.2.3'), /不能为空/);
  assert.equal(readFileSync(path, 'utf8'), before);
});

test('同步所有平台版本，保留应用身份及开发 plist 网络配置', t => {
  const root = fixture(t);
  writeFileSync(join(root, 'docs/releases/1.2.3.md'), '## 修复\n\n- 保存文件。\n');
  versionCommand(root, 'bump', '1.2.3');
  versionCommand(root, 'check', 'v1.2.3');
  assert.equal(readFileSync(join(root, 'build/linux/nfpm/nfpm.yaml'), 'utf8'), readFileSync(join(source, 'build/linux/nfpm/nfpm.yaml'), 'utf8').replace(/^version: ".*"/m, 'version: "1.2.3"'));
  assert.match(readFileSync(join(root, 'build/darwin/Info.dev.plist'), 'utf8'), /NSAllowsLocalNetworking/);
  assert.match(readFileSync(join(root, 'build/darwin/Info.plist'), 'utf8'), /com\.termquay\.app/);
  assert.match(readFileSync(join(root, 'build/windows/msix/app_manifest.xml'), 'utf8'), /Version="1\.2\.3\.0"/);
  assert.throws(() => versionCommand(root, 'check', 'v1.2.4'), /不一致/);
  const path = join(root, 'build/windows/info.json'), info = JSON.parse(readFileSync(path, 'utf8'));
  info.info['0409'].ProductVersion = '1.2.2'; writeFileSync(path, JSON.stringify(info));
  assert.throws(() => versionCommand(root, 'check', 'v1.2.3'), /不一致/);
});

test('平台资源损坏时，bump 在写入前失败', t => {
  const root = fixture(t), path = join(root, 'frontend/package.json'), before = readFileSync(path, 'utf8');
  writeFileSync(join(root, 'docs/releases/2.0.0.md'), '版本说明');
  writeFileSync(join(root, 'build/windows/msix/app_manifest.xml'), '<Package>');
  assert.throws(() => versionCommand(root, 'bump', '2.0.0'), /XML/);
  assert.equal(readFileSync(path, 'utf8'), before);
  for (const version of ['v1.0.0', '01.0.0', '1.0.0-rc.1', '65536.0.0']) assert.throws(() => versionCommand(root, 'bump', version), /正式版本/);
});
