__termquay_shell=zsh
__termquay_preexec() { __termquay_record "$1"; printf '\033]133;C\007'; }
__termquay_complete_request() { __termquay_snapshot "$BUFFER" "$CURSOR"; }
__termquay_complete_apply() {
  local packet= char count=0
  while read -rsk 1 -t 1 char; do
    [ "$char" != $'\a' ] || break
    packet=$packet$char; count=$((count + 1))
    [ "$count" -le 16500 ] || { __termquay_emit 'E;补全响应超过上限'; return; }
  done
  if [ "$char" != $'\a' ]; then __termquay_emit 'E;补全响应未完整到达'; return; fi
  if [ "$BUFFER" != "$__termquay_saved_line" ] || [ "$CURSOR" != "$__termquay_saved_point" ]; then
    __termquay_emit 'E;命令已变化，请重新触发补全'; return
  fi
  if ! __termquay_edit_packet "$packet" || [ "$__termquay_new_point" -gt "${#__termquay_decoded}" ]; then
    __termquay_emit 'E;补全响应无效'; return
  fi
  BUFFER=$__termquay_decoded; CURSOR=$__termquay_new_point
  __termquay_saved_line=; __termquay_saved_point=; __termquay_decoded=
  __termquay_emit "A;$__termquay_sequence"
  zle redisplay
}
zle -N __termquay_complete_request
zle -N __termquay_complete_apply
for __termquay_map in emacs viins vicmd; do
  bindkey -M "$__termquay_map" $'\e[9270~' __termquay_complete_request
  bindkey -M "$__termquay_map" $'\e[9271~' __termquay_complete_apply
done
unset __termquay_map
