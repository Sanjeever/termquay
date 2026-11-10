import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const notices = readFileSync(new URL('../THIRD_PARTY_NOTICES.md', import.meta.url), 'utf8');
const marker = '## 发行前待办';
const index = notices.indexOf(marker);
if (index < 0) throw new Error('缺少第三方依赖发行审计入口');
const pending = notices.slice(index + marker.length).trim();
if (pending) {
  console.error(`发行审计尚有未完成事项，拒绝公开 Release：\n${pending}`);
  process.exitCode = 1;
} else {
  const root = new URL('../', import.meta.url);
  const audit = JSON.parse(readFileSync(new URL('build/licenses/review.json', root), 'utf8'));
  for (const [path, expected] of Object.entries(audit.inputs)) {
    const actual = createHash('sha256')
      .update(readFileSync(new URL(path, root)))
      .digest('hex');
    if (actual !== expected) throw new Error(`发行许可核对已过期，请重新核对 ${path}`);
  }
  const wasm = JSON.parse(readFileSync(new URL('build/licenses/wasm/packages.json', root), 'utf8'));
  if (!wasm.packages.length) throw new Error('WASM 许可清单为空');
  for (const pkg of wasm.packages) {
    if (!pkg.license_files.length) throw new Error(`缺少 WASM 依赖许可：${pkg.name}`);
    for (const path of pkg.license_files)
      if (!readFileSync(new URL(path, root)).length) throw new Error(`许可文件为空：${path}`);
  }
  console.log('发行前待办、依赖输入与 WASM 许可检查通过。');
}
