import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = new URL('../', import.meta.url);
const requireFrontend = createRequire(new URL('frontend/package.json', root));
const [{ default: Markdown }, { default: remarkGfm }, { default: rehypeSlug }] = await Promise.all(
  ['react-markdown', 'remark-gfm', 'rehype-slug'].map(
    (name) => import(pathToFileURL(requireFrontend.resolve(name))),
  ),
);
const origin = 'https://repository.invalid';
const files = new Set(
  execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: fileURLToPath(root),
    encoding: 'utf8',
  })
    .split('\0')
    .filter((file) => file && existsSync(new URL(encodeURI(file), root))),
);
const importedSkills = Object.keys(
  JSON.parse(readFileSync(new URL('skills-lock.json', root), 'utf8')).skills,
);
const docs = [...files].filter(
  (file) =>
    file.endsWith('.md') &&
    !file.startsWith('build/licenses/') &&
    !importedSkills.some((skill) => file.startsWith(`.agents/skills/${skill}/`)),
);
const parsed = new Map();

function readMarkdown(file) {
  if (parsed.has(file)) return parsed.get(file);
  const anchors = new Set();
  const links = [];

  function collect(node) {
    if (node.type === 'element') {
      if (node.properties.id) anchors.add(node.properties.id);
      const url = node.tagName === 'img' ? node.properties.src : node.properties.href;
      if (url) links.push({ url, line: node.position?.start.line });
    } else if (node.type === 'raw') {
      // The guides use empty HTML anchors to preserve old section links.
      for (const [, id] of node.value.matchAll(/^<a id="([^"]+)">/gm)) anchors.add(id);
    }
    node.children?.forEach(collect);
  }

  // Use the preview's parser and heading slugs without mounting a React tree.
  Markdown({
    children: readFileSync(new URL(encodeURI(file), root), 'utf8'),
    remarkPlugins: [remarkGfm],
    rehypePlugins: [rehypeSlug, () => collect],
  });
  const result = { anchors, links };
  parsed.set(file, result);
  return result;
}

let checked = 0;
for (const file of docs) {
  const base = new URL(`/${encodeURI(file)}`, origin);
  for (const { url, line } of readMarkdown(file).links) {
    const destination = new URL(url, base);
    if (destination.origin !== origin) continue;
    checked++;

    const target = decodeURIComponent(destination.pathname.slice(1)).replace(/\/$/, '');
    const fragment = decodeURIComponent(destination.hash.slice(1));
    const exists =
      !target || files.has(target) || [...files].some((p) => p.startsWith(`${target}/`));
    const validAnchor =
      !fragment ||
      !target.endsWith('.md') ||
      !files.has(target) ||
      readMarkdown(target).anchors.has(fragment);
    if (!exists || !validAnchor) {
      console.error(`${file}:${line}: ${exists ? 'missing anchor' : 'missing path'}: ${url}`);
      process.exitCode = 1;
    }
  }
}

if (!process.exitCode)
  console.log(`Checked ${checked} local links across ${docs.length} Markdown files.`);
