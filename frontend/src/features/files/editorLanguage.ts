import { StreamLanguage } from '@codemirror/language';
import { json } from '@codemirror/lang-json';
import { yaml } from '@codemirror/lang-yaml';
import { javascript } from '@codemirror/lang-javascript';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { toml } from '@codemirror/legacy-modes/mode/toml';
import { properties } from '@codemirror/legacy-modes/mode/properties';
import { nginx } from '@codemirror/legacy-modes/mode/nginx';

export function editorLanguage(path: string) {
  const name = path.split('/').pop() || '';
  if (/\.json$/i.test(name)) return json();
  if (/\.ya?ml$/i.test(name)) return yaml();
  if (/\.[cm]?[jt]sx?$/i.test(name)) return javascript({ typescript: /\.[cm]?tsx?$/i.test(name), jsx: /[jt]sx$/i.test(name) });
  if (/\.(sh|bash|zsh)$/i.test(name) || /^\.?(bashrc|bash_profile|zshrc|zprofile|profile)$/i.test(name)) return StreamLanguage.define(shell);
  if (/^nginx\.conf$/i.test(name) || /(^|\/)nginx\//i.test(path)) return StreamLanguage.define(nginx);
  if (/\.toml$/i.test(name) || name === 'Cargo.lock' || name === 'uv.lock') return StreamLanguage.define(toml);
  if (/\.(ini|cfg|properties|conf)$/i.test(name) || name === '.gitconfig') return StreamLanguage.define(properties);
  return [];
}
