type IconEntry = { name: string; directory: boolean; symlink: boolean; mode: string };

export function fileIconKind(entry: IconEntry) {
  const name = entry.name.toLowerCase();
  if (entry.symlink) return 'link';
  if (entry.directory) {
    if (name === '.ssh') return 'folder-secure';
    if (name === '.git' || name === '.github') return 'folder-git';
    if (name === '.config' || name === 'config' || name === 'etc') return 'folder-config';
    if (name === '.docker') return 'folder-docker';
    if (['src', 'source', 'lib', 'include'].includes(name)) return 'folder-code';
    if (['node_modules', 'vendor', '.venv'].includes(name)) return 'folder-package';
    return 'folder';
  }
  if (/^dockerfile(?:\.|$)/.test(name) || /^(?:docker-)?compose.*\.ya?ml$/.test(name)) return 'docker';
  if (/^go\.(mod|sum)$/.test(name)) return 'go';
  if (/^cargo\.(toml|lock)$/.test(name)) return 'rust';
  if (/^package(?:-lock)?\.json$/.test(name) || name === 'pnpm-lock.yaml' || name === 'yarn.lock') return 'package';
  if (/^\.git/.test(name)) return 'git';
  if (/^\.env(?:\.|$)/.test(name) || /^(\.?(bashrc|bash_profile|zshrc|zprofile|profile)|makefile|justfile)$/.test(name)) return name.startsWith('.env') ? 'config' : 'shell';
  if (/^tsconfig.*\.json$/.test(name)) return 'typescript';
  if (/^nginx(?:\.conf)?$/.test(name)) return 'nginx';
  if (/^(license|notice|copying)(\.|$)/.test(name)) return 'license';
  const extension = name.split('.').pop() || '';
  return extensions[extension] || (entry.mode.startsWith('-') && /[xst]/.test(entry.mode.slice(1)) ? 'executable' : 'file');
}

const extensions: Record<string, string> = {
    ts: 'typescript', mts: 'typescript', cts: 'typescript', js: 'javascript', mjs: 'javascript', cjs: 'javascript',
    tsx: 'react', jsx: 'react', vue: 'vue', svelte: 'html', go: 'go', py: 'python', pyw: 'python', rs: 'rust',
    java: 'java', class: 'java', jar: 'java', c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp', cs: 'csharp',
    swift: 'swift', kt: 'kotlin', kts: 'kotlin', rb: 'ruby', php: 'php', lua: 'lua',
    json: 'json', jsonc: 'json', jsonl: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml',
    ini: 'config', cfg: 'config', conf: 'config', properties: 'config', env: 'config', service: 'config',
    sh: 'shell', bash: 'shell', zsh: 'shell', fish: 'shell', ps1: 'shell', bat: 'shell', cmd: 'shell',
    html: 'html', htm: 'html', xml: 'xml', svg: 'image', css: 'css', scss: 'css', less: 'css',
    md: 'markdown', mdx: 'markdown', rst: 'text', txt: 'text', log: 'log', csv: 'spreadsheet', tsv: 'spreadsheet',
    sql: 'database', db: 'database', sqlite: 'database', sqlite3: 'database',
    zip: 'archive', gz: 'archive', bz2: 'archive', xz: 'archive', tar: 'archive', tgz: 'archive', '7z': 'archive', rar: 'archive', zst: 'archive',
    png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', ico: 'image', avif: 'image', heic: 'image',
    mp4: 'video', mov: 'video', mkv: 'video', webm: 'video', mp3: 'audio', wav: 'audio', flac: 'audio', ogg: 'audio',
    pdf: 'pdf', doc: 'document', docx: 'document', odt: 'document', xls: 'spreadsheet', xlsx: 'spreadsheet',
    ttf: 'font', otf: 'font', woff: 'font', woff2: 'font', lock: 'lock', pem: 'lock', key: 'lock', crt: 'lock',
};
