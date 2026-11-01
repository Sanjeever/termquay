set -eu
test "$(uname -s)" = Linux || { printf '%s\n' '首版监控支持 Linux' >&2; exit 2; }
printf '%s\n' '[system]'
uname -sr
printf '%s\n' '[cpu]'
head -n 1 /proc/stat
printf '%s\n' '[memory]'
cat /proc/meminfo
printf '%s\n' '[network]'
cat /proc/net/dev
printf '%s\n' '[disk]'
cat /proc/diskstats
