import {copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const input = process.argv[2];
if (!input) throw new Error('用法：先将 pnpm licenses list --prod --json 输出到临时文件，再执行 licenses.mjs <文件>');
const groups = JSON.parse(readFileSync(resolve(input), 'utf8'));
const metadataPath = join(root, 'build/licenses/frontend/packages.json');
const previous = JSON.parse(readFileSync(metadataPath, 'utf8'));
const order = new Map(previous.map((pkg, index) => [pkg.name, index]));
const packages = Object.values(groups).flat();
const metadata = [];
const missing = [];
for (const pkg of packages) {
  metadata.push({name: pkg.name, versions: pkg.versions, license: pkg.license, homepage: pkg.homepage ?? null, author: pkg.author ?? null});
  for (const path of pkg.paths) {
    const info = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'));
    if (info.name !== pkg.name || !pkg.versions.includes(info.version)) throw new Error(`包路径与元数据不符：${pkg.name}`);
    const target = join(root, 'build/licenses/frontend', pkg.name, info.version);
    mkdirSync(target, {recursive: true});
    for (const file of readdirSync(path, {withFileTypes: true})) {
      if (file.isFile() && /^(licen[cs]e|notice|copying|copyright)([._-]|$)/i.test(file.name)) copyFileSync(join(path, file.name), join(target, file.name));
    }
    if (!existsSync(target) || !readdirSync(target, {recursive: true}).some(name => /(^|[/\\])(licen[cs]e|notice|copying|copyright)([._-]|$)/i.test(name))) missing.push(`${pkg.name}@${info.version}`);
  }
}
metadata.sort((a, b) => (order.get(a.name) ?? Infinity) - (order.get(b.name) ?? Infinity) || a.name.localeCompare(b.name, 'en'));
writeFileSync(metadataPath, JSON.stringify(metadata, null, 2) + '\n');
console.log(`已收集 ${metadata.length} 项生产依赖元数据。缺少包内许可原文的项目需另外核对：\n${[...new Set(missing)].join('\n')}`);
