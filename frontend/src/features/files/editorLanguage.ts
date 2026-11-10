import { t as translate } from '../../i18n/index.ts';
import {
  LanguageDescription,
  LanguageSupport,
  StreamLanguage,
  type Language,
} from '@codemirror/language';
import type { Extension } from '@codemirror/state';

export const editorLanguages = () =>
  [
    ['text', translate('files:plainText')],
    ['json', 'JSON'],
    ['json5', 'JSON5 / JSONC'],
    ['yaml', 'YAML'],
    ['javascript', 'JavaScript'],
    ['typescript', 'TypeScript'],
    ['jsx', 'JSX'],
    ['tsx', 'TSX'],
    ['python', 'Python'],
    ['go', 'Go'],
    ['rust', 'Rust'],
    ['c', 'C'],
    ['cpp', 'C++'],
    ['java', 'Java'],
    ['csharp', 'C#'],
    ['php', 'PHP'],
    ['ruby', 'Ruby'],
    ['lua', 'Lua'],
    ['perl', 'Perl'],
    ['kotlin', 'Kotlin'],
    ['scala', 'Scala'],
    ['swift', 'Swift'],
    ['r', 'R'],
    ['html', 'HTML'],
    ['xml', translate('files:xMLSVGSource')],
    ['css', 'CSS'],
    ['scss', 'SCSS'],
    ['less', 'LESS'],
    ['sass', 'Sass'],
    ['sql', 'SQL'],
    ['markdown', 'Markdown'],
    ['shell', 'Shell'],
    ['powershell', 'PowerShell'],
    ['batch', 'Windows Batch'],
    ['dockerfile', 'Dockerfile'],
    ['makefile', 'Makefile'],
    ['cmake', 'CMake'],
    ['toml', 'TOML'],
    ['ini', 'INI / Properties'],
    ['nginx', 'nginx'],
    ['systemd', 'systemd'],
    ['ssh', translate('files:sSHConfiguration')],
    ['env', '.env'],
    ['gitignore', translate('files:gitIgnoreRules')],
    ['diff', 'Diff / Patch'],
    ['protobuf', 'Protocol Buffers'],
  ] as const;
export type EditorLanguageID = ReturnType<typeof editorLanguages>[number][0];
const aliases: Record<string, EditorLanguageID> = {
  js: 'javascript',
  ts: 'typescript',
  py: 'python',
  rb: 'ruby',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  yml: 'yaml',
  'c++': 'cpp',
  cxx: 'cpp',
  cs: 'csharp',
  'c#': 'csharp',
  ps1: 'powershell',
  ps: 'powershell',
  md: 'markdown',
  proto: 'protobuf',
};
export function languageFromTag(tag: string): EditorLanguageID | undefined {
  const value = tag.trim().split(/\s/, 1)[0].toLowerCase();
  return aliases[value] || editorLanguages().find(([id]) => id === value)?.[0];
}

export function detectEditorLanguage(path: string, content = ''): EditorLanguageID {
  const name = (path.split('/').pop() || '').toLowerCase();
  if (/^(readme|changelog|changes)$/.test(name)) return 'markdown';
  if (/^dockerfile(?:\..*)?$/.test(name) || /\.dockerfile$/.test(name)) return 'dockerfile';
  if (/^(?:gnumakefile|makefile)(?:\..*)?$/.test(name) || /\.mk$/.test(name)) return 'makefile';
  if (name === 'cmakelists.txt' || /\.cmake$/.test(name)) return 'cmake';
  if (/^\.(?:gitignore|dockerignore|ignore)$/.test(name)) return 'gitignore';
  if (/^(?:sshd?_config|ssh_config)(?:\..*)?$/.test(name) || /\/.ssh\/config$/i.test(path))
    return 'ssh';
  if (/^\.env(?:\..*)?$/.test(name)) return 'env';
  if (/\.(service|socket|timer|target|mount|automount|path|slice|scope)$/.test(name))
    return 'systemd';
  if (name === 'nginx.conf' || /(^|\/)nginx\//i.test(path)) return 'nginx';
  if (/^\.?(?:bashrc|bash_profile|bash_login|zshrc|zprofile|zshenv|profile)$/.test(name))
    return 'shell';
  if (name === 'cargo.lock' || name === 'uv.lock') return 'toml';
  if (name === '.gitconfig') return 'ini';
  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '';
  const extensions: Record<string, EditorLanguageID> = {
    json: 'json',
    json5: 'json5',
    jsonc: 'json5',
    yml: 'yaml',
    yaml: 'yaml',
    js: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    ts: 'typescript',
    mts: 'typescript',
    cts: 'typescript',
    jsx: 'jsx',
    tsx: 'tsx',
    py: 'python',
    pyw: 'python',
    go: 'go',
    rs: 'rust',
    c: 'c',
    h: 'c',
    cc: 'cpp',
    cpp: 'cpp',
    cxx: 'cpp',
    hpp: 'cpp',
    hh: 'cpp',
    hxx: 'cpp',
    java: 'java',
    cs: 'csharp',
    php: 'php',
    phtml: 'php',
    rb: 'ruby',
    rake: 'ruby',
    lua: 'lua',
    pl: 'perl',
    pm: 'perl',
    kt: 'kotlin',
    kts: 'kotlin',
    scala: 'scala',
    swift: 'swift',
    r: 'r',
    html: 'html',
    htm: 'html',
    xml: 'xml',
    svg: 'xml',
    xsd: 'xml',
    xsl: 'xml',
    css: 'css',
    scss: 'scss',
    less: 'less',
    sass: 'sass',
    sql: 'sql',
    md: 'markdown',
    markdown: 'markdown',
    mdown: 'markdown',
    mkd: 'markdown',
    sh: 'shell',
    bash: 'shell',
    zsh: 'shell',
    fish: 'shell',
    ps1: 'powershell',
    psm1: 'powershell',
    psd1: 'powershell',
    bat: 'batch',
    cmd: 'batch',
    toml: 'toml',
    ini: 'ini',
    cfg: 'ini',
    conf: 'ini',
    properties: 'ini',
    diff: 'diff',
    patch: 'diff',
    proto: 'protobuf',
  };
  if (extensions[extension]) return extensions[extension];
  const firstLine = content.slice(0, 256).split('\n', 1)[0];
  if (/^#!.*\bpython(?:\d(?:\.\d+)?)?\b/.test(firstLine)) return 'python';
  if (/^#!.*\b(?:ba|z|k|da)?sh\b/.test(firstLine)) return 'shell';
  if (/^#!.*\b(?:node|deno|bun)\b/.test(firstLine)) return 'javascript';
  if (/^#!.*\bruby\b/.test(firstLine)) return 'ruby';
  if (/^#!.*\bperl\b/.test(firstLine)) return 'perl';
  return 'text';
}

const loaders: Record<EditorLanguageID, () => Promise<Extension>> = {
  text: async () => [],
  json: () => import('@codemirror/lang-json').then((module) => module.json()),
  json5: () =>
    import('@codemirror/legacy-modes/mode/javascript').then((module) =>
      StreamLanguage.define(module.javascript),
    ),
  yaml: () => import('@codemirror/lang-yaml').then((module) => module.yaml()),
  javascript: () => import('@codemirror/lang-javascript').then((module) => module.javascript()),
  typescript: () =>
    import('@codemirror/lang-javascript').then((module) => module.javascript({ typescript: true })),
  jsx: () =>
    import('@codemirror/lang-javascript').then((module) => module.javascript({ jsx: true })),
  tsx: () =>
    import('@codemirror/lang-javascript').then((module) =>
      module.javascript({ typescript: true, jsx: true }),
    ),
  python: () => import('@codemirror/lang-python').then((module) => module.python()),
  go: () => import('@codemirror/lang-go').then((module) => module.go()),
  rust: () => import('@codemirror/lang-rust').then((module) => module.rust()),
  c: () =>
    import('@codemirror/legacy-modes/mode/clike').then((module) => StreamLanguage.define(module.c)),
  cpp: () => import('@codemirror/lang-cpp').then((module) => module.cpp()),
  java: () => import('@codemirror/lang-java').then((module) => module.java()),
  csharp: () =>
    import('@codemirror/legacy-modes/mode/clike').then((module) =>
      StreamLanguage.define(module.csharp),
    ),
  php: () => import('@codemirror/lang-php').then((module) => module.php()),
  ruby: () =>
    import('@codemirror/legacy-modes/mode/ruby').then((module) =>
      StreamLanguage.define(module.ruby),
    ),
  lua: () =>
    import('@codemirror/legacy-modes/mode/lua').then((module) => StreamLanguage.define(module.lua)),
  perl: () =>
    import('@codemirror/legacy-modes/mode/perl').then((module) =>
      StreamLanguage.define(module.perl),
    ),
  kotlin: () =>
    import('@codemirror/legacy-modes/mode/clike').then((module) =>
      StreamLanguage.define(module.kotlin),
    ),
  scala: () =>
    import('@codemirror/legacy-modes/mode/clike').then((module) =>
      StreamLanguage.define(module.scala),
    ),
  swift: () =>
    import('@codemirror/legacy-modes/mode/swift').then((module) =>
      StreamLanguage.define(module.swift),
    ),
  r: () =>
    import('@codemirror/legacy-modes/mode/r').then((module) => StreamLanguage.define(module.r)),
  html: () => import('@codemirror/lang-html').then((module) => module.html()),
  xml: () => import('@codemirror/lang-xml').then((module) => module.xml()),
  css: () => import('@codemirror/lang-css').then((module) => module.css()),
  scss: () =>
    import('@codemirror/legacy-modes/mode/css').then((module) =>
      StreamLanguage.define(module.sCSS),
    ),
  less: () =>
    import('@codemirror/legacy-modes/mode/css').then((module) =>
      StreamLanguage.define(module.less),
    ),
  sass: () =>
    import('@codemirror/legacy-modes/mode/sass').then((module) =>
      StreamLanguage.define(module.sass),
    ),
  sql: () => import('@codemirror/lang-sql').then((module) => module.sql()),
  markdown: () =>
    import('@codemirror/lang-markdown').then((module) =>
      module.markdown({
        codeLanguages: editorLanguages()
          .filter(([id]) => id !== 'text' && id !== 'markdown')
          .map(([id, name]) =>
            LanguageDescription.of({
              name,
              alias: [id, ...Object.keys(aliases).filter((alias) => aliases[alias] === id)],
              load: async () => {
                const support = await loadEditorLanguage(id);
                return support instanceof LanguageSupport
                  ? support
                  : new LanguageSupport(support as Language);
              },
            }),
          ),
      }),
    ),
  shell: () =>
    import('@codemirror/legacy-modes/mode/shell').then((module) =>
      StreamLanguage.define(module.shell),
    ),
  powershell: () =>
    import('@codemirror/legacy-modes/mode/powershell').then((module) =>
      StreamLanguage.define(module.powerShell),
    ),
  dockerfile: () =>
    import('@codemirror/legacy-modes/mode/dockerfile').then((module) =>
      StreamLanguage.define(module.dockerFile),
    ),
  cmake: () =>
    import('@codemirror/legacy-modes/mode/cmake').then((module) =>
      StreamLanguage.define(module.cmake),
    ),
  toml: () =>
    import('@codemirror/legacy-modes/mode/toml').then((module) =>
      StreamLanguage.define(module.toml),
    ),
  ini: () =>
    import('@codemirror/legacy-modes/mode/properties').then((module) =>
      StreamLanguage.define(module.properties),
    ),
  nginx: () =>
    import('@codemirror/legacy-modes/mode/nginx').then((module) =>
      StreamLanguage.define(module.nginx),
    ),
  systemd: () => loadEditorLanguage('ini'),
  ssh: () => loadEditorLanguage('ini'),
  env: () => loadEditorLanguage('ini'),
  gitignore: () => loadEditorLanguage('ini'),
  diff: () =>
    import('@codemirror/legacy-modes/mode/diff').then((module) =>
      StreamLanguage.define(module.diff),
    ),
  protobuf: () =>
    import('@codemirror/legacy-modes/mode/protobuf').then((module) =>
      StreamLanguage.define(module.protobuf),
    ),
  batch: () =>
    import('./editorScriptModes.ts').then((module) => StreamLanguage.define(module.batch)),
  makefile: () =>
    import('./editorScriptModes.ts').then((module) => StreamLanguage.define(module.makefile)),
};
const loaded = new Map<EditorLanguageID, Promise<Extension>>();
export function loadEditorLanguage(id: EditorLanguageID): Promise<Extension> {
  let pending = loaded.get(id);
  if (!pending) {
    pending = loaders[id]().catch((error) => {
      loaded.delete(id);
      throw error;
    });
    loaded.set(id, pending);
  }
  return pending;
}
export function editorLanguage(path: string, content = '') {
  return loadEditorLanguage(detectEditorLanguage(path, content));
}
