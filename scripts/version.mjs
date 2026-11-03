import {readFileSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const {parseDocument} = require('yaml');
const {XMLParser, XMLValidator} = require('fast-xml-parser');
const parser = new XMLParser({ignoreAttributes: false});
const root = fileURLToPath(new URL('../', import.meta.url));
const formalVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function xml(text) {
  if (XMLValidator.validate(text) !== true) throw new Error('平台 XML 资源无效');
  return parser.parse(text);
}

export function versionCommand(directory, command, value) {
  const changes = new Map();
  const read = name => readFileSync(resolve(directory, name), 'utf8');
  const pkg = JSON.parse(read('frontend/package.json'));
  const version = command === 'bump' ? value : pkg.version;
  if (!formalVersion.test(version ?? '') || version.split('.').some(v => Number(v) > 65535)) throw new Error('请输入各段不超过 65535 的正式版本，例如 1.0.0');
  if (!['bump', 'check'].includes(command)) throw new Error('用法：version.mjs bump <version> 或 check <tag>');
  if (command === 'check' && value !== `v${version}`) throw new Error('tag 与 frontend/package.json 版本不一致');
  let notes;
  try { notes = read(`docs/releases/${version}.md`); } catch { throw new Error(`缺少更新日志 docs/releases/${version}.md`); }
  if (!notes.trim()) throw new Error('更新日志不能为空');
  const assign = (name, original, current, expected, updated) => {
    if (command === 'check' && current !== expected) throw new Error(`${name} 版本不一致：${current}，期望 ${expected}`);
    if (command === 'bump' && original !== updated) changes.set(name, updated);
  };
  const yaml = (name, keys) => {
    const text = read(name), doc = parseDocument(text);
    if (doc.errors.length) throw doc.errors[0];
    const node = doc.getIn(keys, true);
    const current = node?.value;
    if (typeof current !== 'string') throw new Error(`${name} 缺少版本字段`);
    const updated = text.slice(0, node.range[0]) + JSON.stringify(version) + text.slice(node.range[1]);
    assign(name, text, current, version, updated);
  };
  yaml('build/config.yml', ['info', 'version']);
  yaml('build/linux/nfpm/nfpm.yaml', ['version']);
  const infoName = 'build/windows/info.json', infoText = read(infoName), info = JSON.parse(infoText);
  for (const current of [info.fixed.file_version, info.fixed.product_version]) {
    assign(infoName, infoText, current, `${version}.0`, infoText);
  }
  for (const current of [info.info['0409'].FileVersion, info.info['0409'].ProductVersion]) assign(infoName, infoText, current, version, infoText);
  info.fixed.file_version = info.fixed.product_version = `${version}.0`;
  info.info['0409'].FileVersion = info.info['0409'].ProductVersion = version;
  if (command === 'bump') changes.set(infoName, JSON.stringify(info, null, '\t') + '\n');
  for (const name of ['build/darwin/Info.plist', 'build/darwin/Info.dev.plist']) {
    const text = read(name);
    xml(text);
    const ordered = new XMLParser({preserveOrder: true}).parse(text);
    const entries = ordered.find(node => node.plist)?.plist.find(node => node.dict)?.dict;
    if (!entries) throw new Error(`${name} 缺少 plist 字典`);
    let updated = text;
    for (const key of ['CFBundleVersion', 'CFBundleShortVersionString']) {
      const index = entries.findIndex(node => node.key?.[0]?.['#text'] === key);
      if (index < 0) throw new Error(`${name} 缺少 ${key}`);
      const pattern = new RegExp(`(<key>${key}</key>\\s*<string>)[^<]*(</string>)`);
      updated = updated.replace(pattern, (_, before, after) => before + version + after);
      assign(name, text, String(entries[index + 1]?.string?.[0]?.['#text']), version, updated);
    }
    if (command === 'bump') changes.set(name, updated);
  }
  const msixName = 'build/windows/msix/app_manifest.xml', msix = read(msixName);
  const msixVersion = xml(msix).Package.Identity['@_Version'];
  assign(msixName, msix, msixVersion, `${version}.0`, msix.replace(/(<Identity\b[^>]*\bVersion=")[^"]*(")/s, (_, before, after) => before + version + '.0' + after));
  const templateName = 'build/windows/msix/template.xml', template = read(templateName);
  assign(templateName, template, xml(template).MsixPackagingToolTemplate.PackageInformation['@_Version'], `${version}.0`, template.replace(/(<PackageInformation\b[^>]*\bVersion=")[^"]*(")/s, (_, before, after) => before + version + '.0' + after));
  const manifestName = 'build/windows/wails.exe.manifest', manifest = read(manifestName);
  assign(manifestName, manifest, xml(manifest).assembly.assemblyIdentity['@_version'], `${version}.0`, manifest.replace(/(<assemblyIdentity\b[^>]*\bversion=")[^"]*(")/, (_, before, after) => before + version + '.0' + after));
  const nsisName = 'build/windows/nsis/wails_tools.nsh', nsis = read(nsisName);
  const pattern = /(!define INFO_PRODUCTVERSION ")([^"]*)(")/;
  const match = nsis.match(pattern);
  if (!match) throw new Error(`${nsisName} 缺少版本字段`);
  assign(nsisName, nsis, match[2], version, nsis.replace(pattern, (_, before, _old, after) => before + version + after));
  if (command === 'bump') {
    pkg.version = version;
    changes.set('frontend/package.json', JSON.stringify(pkg, null, 2) + '\n');
    for (const [name, text] of changes) writeFileSync(resolve(directory, name), text);
  }
  return [...changes.keys()];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, value] = process.argv.slice(2);
    const changed = versionCommand(root, command, value);
    console.log(changed.length ? `版本已同步，请将版本资源与 docs/releases/${value}.md 一并提交。` : '版本与更新日志检查通过。');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
