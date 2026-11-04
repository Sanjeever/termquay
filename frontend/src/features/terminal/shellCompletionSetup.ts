import common from './shell/completion-common.sh?raw';
import bash from './shell/completion-bash.sh?raw';
import zsh from './shell/completion-zsh.sh?raw';
import { shellSetupForHost } from './shellIntegration';
import type { CompletionShell } from './shellCompletionProtocol';

export function shellCompletionSetup(shell: CompletionShell, host: string, token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Shell 集成标识无效');
  const hooks = shell === 'bash' ? `if [ -z "\${__termquay_completion_enabled-}" ]; then
  __termquay_completion_enabled=1
  if declare -p PROMPT_COMMAND 2>/dev/null | grep -q 'declare -a'; then PROMPT_COMMAND+=(__termquay_prompt_state); else PROMPT_COMMAND="\${PROMPT_COMMAND:+$PROMPT_COMMAND; }__termquay_prompt_state"; fi
fi` : `if [ -z "\${__termquay_completion_enabled-}" ]; then
  __termquay_completion_enabled=1
  precmd_functions+=(__termquay_prompt_state)
fi`;
  const condition = shell === 'bash' ? '[ -n "${BASH_VERSION-}" ]' : '[ -n "${ZSH_VERSION-}" ]';
  const version = shell === 'bash' ? `if [ "\${BASH_VERSINFO[0]}" -lt 4 ] || { [ "\${BASH_VERSINFO[0]}" -eq 4 ] && [ "\${BASH_VERSINFO[1]}" -lt 4 ]; }; then
  __termquay_emit 'E;增强补全需要 Bash 4.4 或更新版本'
else\n${bash}\n${hooks}\nfi` : `${zsh}\n${hooks}`;
  return `${shellSetupForHost(shell, host)}\nif ${condition}; then\n${common.replace('__TERMQUAY_TOKEN__', token)}\n${version}\nelse\n  printf '\\033]777;termquay;${token};E;当前 Shell 与所选类型不一致\\007'\nfi`;
}
