__termquay_shell=bash
__termquay_record_bash() {
  [[ -o history ]] && [ "${HISTSIZE:-0}" -gt 0 ] || return
  local recent
  recent=$(HISTTIMEFORMAT= builtin history 1)
  if [[ $recent =~ ^[[:space:]]*([0-9]+)[[:space:]]+(.*)$ ]] && [ "${BASH_REMATCH[1]}" -gt "${__termquay_history_base:-0}" ]; then
    __termquay_record "${BASH_REMATCH[2]}"
  fi
}
if [ -z "${__termquay_command_capture-}" ]; then
  __termquay_command_capture=1
  PS0='$(__termquay_record_bash)'"$PS0"
fi
__termquay_complete_request() { __termquay_snapshot "$READLINE_LINE" "$READLINE_POINT"; }
__termquay_complete_apply() {
  local packet LC_ALL=C
  IFS= read -r -s -t 1 -d $'\a' packet || { __termquay_emit 'E;补全响应未完整到达;terminal:completionResponseIncomplete'; return; }
  if [ "$READLINE_LINE" != "$__termquay_saved_line" ] || [ "$READLINE_POINT" != "$__termquay_saved_point" ]; then
    __termquay_emit 'E;命令已变化，请重新触发补全;terminal:completionCommandChanged'; return
  fi
  if ! __termquay_edit_packet "$packet" || [ "$__termquay_new_point" -gt "${#__termquay_decoded}" ]; then
    __termquay_emit 'E;补全响应无效;terminal:completionResponseInvalid'; return
  fi
  READLINE_LINE=$__termquay_decoded; READLINE_POINT=$__termquay_new_point
  __termquay_saved_line=; __termquay_saved_point=; __termquay_decoded=
  __termquay_emit "A;$__termquay_sequence"
}
for __termquay_map in emacs-standard vi-insert vi-command; do
  bind -m "$__termquay_map" -x '"\e[9270~":__termquay_complete_request'
  bind -m "$__termquay_map" -x '"\e[9271~":__termquay_complete_apply'
done
unset __termquay_map
