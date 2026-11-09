__termquay_token='__TERMQUAY_TOKEN__'
__termquay_owner=$$
__termquay_sequence=0
__termquay_emit() { printf '\033]777;termquay;%s;%s\007' "$__termquay_token" "$1"; }
__termquay_hex() {
  local LC_ALL=C value="$1" first number
  __termquay_encoded=
  while [ -n "$value" ]; do
    first=${value%"${value#?}"}; value=${value#?}
    printf -v number '%02x' "'$first"
    __termquay_encoded=$__termquay_encoded$number
  done
}
__termquay_unhex() {
  local value="$1" pair escaped=
  case "$value" in *[!0-9a-f]*) return 1;; esac
  [ $(( ${#value} % 2 )) -eq 0 ] && [ ${#value} -le 16384 ] || return 1
  while [ -n "$value" ]; do
    pair=${value%"${value#??}"}; value=${value#??}
    [ "$pair" != 00 ] || return 1
    escaped="$escaped\\x$pair"
  done
  printf -v __termquay_decoded '%b' "$escaped"
}
__termquay_prompt_state() {
  [ "$$" = "$__termquay_owner" ] || return
  local marker=$'\e]133;B\a'
  case "$PS1" in
    *"$marker"*) ;;
    *) if [ "$__termquay_shell" = bash ]; then PS1="$PS1"'\['"$marker"'\]'; else PS1="$PS1"'%{'"$marker"'%}'; fi ;;
  esac
  __termquay_saved_line=; __termquay_saved_point=
  if [ "$__termquay_shell" = bash ]; then
    local recent
    recent=$(HISTTIMEFORMAT= builtin history 1)
    if [[ $recent =~ ^[[:space:]]*([0-9]+) ]]; then __termquay_history_base=${BASH_REMATCH[1]}; else __termquay_history_base=; fi
  fi
  __termquay_emit "P;$__termquay_shell"
}
__termquay_record() {
  local LC_ALL=C command="$1"
  [ "$$" = "$__termquay_owner" ] && [ ${#command} -le 8192 ] || return
  __termquay_hex "$command"
  __termquay_emit "R;$__termquay_encoded"
  __termquay_encoded=
}
__termquay_snapshot() {
  local LC_ALL=C line="$1" point="$2" directory home
  if [ ${#line} -gt 8192 ] || [ ${#PWD} -gt 4096 ] || [ ${#HOME} -gt 4096 ]; then
    __termquay_emit 'E;输入或路径超过补全上限;terminal:completionInputLimit'; return
  fi
  __termquay_saved_line=$line; __termquay_saved_point=$point
  __termquay_sequence=$((__termquay_sequence + 1))
  __termquay_hex "$PWD"; directory=$__termquay_encoded
  __termquay_hex "$HOME"; home=$__termquay_encoded
  __termquay_hex "$line"
  __termquay_emit "S;$__termquay_sequence;$__termquay_shell;$point;$__termquay_encoded;$directory;$home"
  __termquay_encoded=
}
__termquay_edit_packet() {
  local packet="$1" token sequence point hex
  token=${packet%%;*}; packet=${packet#*;}
  sequence=${packet%%;*}; packet=${packet#*;}
  point=${packet%%;*}; hex=${packet#*;}
  [ "$token" = "$__termquay_token" ] && [ "$sequence" = "$__termquay_sequence" ] || return 1
  case "$point" in ''|*[!0-9]*) return 1;; esac
  [ ${#point} -le 5 ] && __termquay_unhex "$hex" || return 1
  __termquay_new_point=$point
}
