import { posixCatalog } from './posixCatalog.ts';

export type CommandArgument = { name: string; kind?: 'file' | 'directory' | 'value'; values?: readonly (readonly [string, string])[] };
export type CommandOption = { name: string; description: string; argument?: CommandArgument; exclusive?: readonly string[] };
export type PosixCommand = { name: string; description: string; synopsis: string; options: CommandOption[]; operands: CommandArgument[]; examples: readonly string[] };
type OptionRow = readonly [string, string, CommandArgument?, (readonly string[])?];
type Details = { synopsis: string; options?: readonly OptionRow[]; operands?: CommandArgument[]; examples: readonly string[] };
const file: CommandArgument = { name: '文件', kind: 'file' };
const directory: CommandArgument = { name: '目录', kind: 'directory' };
const count: CommandArgument = { name: '数量', kind: 'value' };
const pattern: CommandArgument = { name: '模式', kind: 'value' };
const logical = ['-L', '-P'];
const overwrite = ['-f', '-i'];
const details: Record<string, Details> = {
  ls: { synopsis: 'ls [选项] [文件…]', examples: ['ls -la', 'ls -lt /var/log'], options: [
    ['-a','包含点开头的文件'],['-A','包含隐藏项，但不列出 . 和 ..'],['-l','使用长格式'],['-1','每行一项'],['-C','按列输出'],['-x','按行排列多列'],['-m','用逗号分隔'],['-R','递归列出子目录'],['-d','列出目录自身'],['-F','追加文件类型标记'],['-p','在目录后追加 /'],['-i','显示 inode'],['-s','显示分配块数'],['-k','以 1024 字节块计数'],['-n','用数字显示用户和组'],['-g','长格式省略所有者'],['-o','长格式省略所属组'],['-r','反转排序'],['-t','按时间排序'],['-S','按大小排序'],['-f','按目录顺序输出'],['-u','使用访问时间'],['-c','使用状态变化时间'],['-q','替换不可打印字符'],['-H','跟随命令行中的符号链接'],['-L','跟随所有符号链接']], operands: [file] },
  cd: { synopsis: 'cd [-L|-P] [目录]', examples: ['cd /var/log', 'cd -'], options: [['-L','使用逻辑路径',undefined,logical],['-P','解析符号链接',undefined,logical]], operands: [directory] },
  pwd: { synopsis: 'pwd [-L|-P]', examples: ['pwd -P'], options: [['-L','显示逻辑路径',undefined,logical],['-P','显示物理路径',undefined,logical]] },
  cp: { synopsis: 'cp [选项] 源… 目标', examples: ['cp -i config.conf config.conf.bak', 'cp -R source destination'], options: [['-f','移除无法打开的已有目标'],['-i','覆盖前询问'],['-p','保留权限、所有者和时间'],['-R','递归复制目录'],['-H','递归时跟随命令行符号链接'],['-L','递归时跟随所有符号链接'],['-P','复制链接自身']], operands: [file] },
  mv: { synopsis: 'mv [-f|-i] 源… 目标', examples: ['mv -i old.conf new.conf'], options: [['-f','直接替换目标',undefined,overwrite],['-i','替换前询问',undefined,overwrite]], operands: [file] },
  rm: { synopsis: 'rm [-fiRr] 文件…', examples: ['rm -i old.conf', 'rm -r old-directory'], options: [['-f','忽略不存在的项并取消询问',undefined,overwrite],['-i','删除前询问',undefined,overwrite],['-R','递归删除目录'],['-r','递归删除目录']], operands: [file] },
  mkdir: { synopsis: 'mkdir [-p] [-m 权限] 目录…', examples: ['mkdir -p logs/archive', 'mkdir -m 700 private'], options: [['-p','同时创建缺失的父目录'],['-m','设置新目录权限',{name:'权限，如 755 或 u=rwx',kind:'value'}]], operands: [directory] },
  rmdir: { synopsis: 'rmdir [-p] 目录…', examples: ['rmdir empty-directory'], options: [['-p','继续移除变空的父目录']], operands: [directory] },
  ln: { synopsis: 'ln [-fs] [-L|-P] 源… 目标', examples: ['ln -s app.conf current.conf'], options: [['-f','替换已有目标'],['-s','创建符号链接'],['-L','硬链接跟随源符号链接',undefined,logical],['-P','硬链接指向符号链接自身',undefined,logical]], operands: [file] },
  chmod: { synopsis: 'chmod [-R] 权限 文件…', examples: ['chmod 600 config.conf', 'chmod u+x script.sh'], options: [['-R','递归修改权限']], operands: [{name:'权限',kind:'value',values:[['600','所有者可读写'],['644','所有者可写，所有人可读'],['700','仅所有者可访问'],['755','所有者可写，所有人可读和执行'],['u+x','为所有者增加执行权限']]},file] },
  chown: { synopsis: 'chown [-R] [-H|-L|-P] 所有者[:组] 文件…', examples: ['chown user:group app.conf'], options: [['-R','递归修改所有者'],['-H','跟随命令行目录链接'],['-L','跟随所有目录链接'],['-P','不跟随目录链接']], operands: [{name:'所有者[:组]',kind:'value'},file] },
  chgrp: { synopsis: 'chgrp [-R] [-H|-L|-P] 组 文件…', examples: ['chgrp group app.conf'], options: [['-R','递归修改所属组'],['-H','跟随命令行目录链接'],['-L','跟随所有目录链接'],['-P','不跟随目录链接']], operands: [{name:'组',kind:'value'},file] },
  cat: { synopsis: 'cat [-u] [文件…]', examples: ['cat config.conf'], options: [['-u','尽快写出读取的内容']], operands: [file] },
  head: { synopsis: 'head [-n 行数] [文件…]', examples: ['head -n 20 app.log'], options: [['-n','指定开头行数',count]], operands: [file] },
  tail: { synopsis: 'tail [-f] [-c 字节数|-n 行数] [文件]', examples: ['tail -n 100 app.log', 'tail -f app.log'], options: [['-f','继续读取追加内容'],['-c','按字节选择末尾内容',count,['-c','-n']],['-n','按行选择末尾内容',count,['-c','-n']]], operands: [file] },
  grep: { synopsis: 'grep [选项] 模式 [文件…]', examples: ["grep -n 'ERROR' app.log", "grep -E 'warn|error' app.log"], options: [['-E','使用扩展正则',undefined,['-E','-F']],['-F','按固定文本匹配',undefined,['-E','-F']],['-e','追加匹配模式',pattern],['-f','从文件读取模式',file],['-c','只输出匹配行数'],['-i','忽略大小写'],['-l','只列出匹配文件名'],['-n','显示行号'],['-q','仅通过退出码反馈'],['-s','抑制文件读取错误'],['-v','选择不匹配的行'],['-x','要求整行匹配']], operands: [pattern,file] },
  find: { synopsis: 'find [-H|-L] 路径… [表达式]', examples: ["find . -type f -name '*.log'", 'find /var/log -type f -mtime +7 -print'], options: [
    ['-H','跟随命令行路径的符号链接'],['-L','跟随所有符号链接'],['-name','按名称模式匹配',pattern],['-path','按路径模式匹配',pattern],['-type','按文件类型匹配',{name:'类型',kind:'value',values:[['f','普通文件'],['d','目录'],['l','符号链接'],['b','块设备'],['c','字符设备'],['p','命名管道'],['s','套接字']]}],['-user','按所有者匹配',{name:'用户',kind:'value'}],['-group','按所属组匹配',{name:'组',kind:'value'}],['-nouser','匹配无对应用户的文件'],['-nogroup','匹配无对应组的文件'],['-perm','按权限匹配',{name:'权限',kind:'value'}],['-links','按硬链接数匹配',count],['-size','按大小匹配，c 后缀表示字节',count],['-atime','按访问天数匹配',count],['-ctime','按状态变化天数匹配',count],['-mtime','按修改天数匹配',count],['-newer','匹配比参照文件更新的项',file],['-xdev','不跨越文件系统'],['-depth','先处理子项，再处理目录'],['-prune','不进入当前目录'],['-print','输出匹配路径'],['-exec','对匹配项执行命令，以 {} 和分号或 + 组合',{name:'命令',kind:'value'}],['-ok','确认后对匹配项执行命令',{name:'命令',kind:'value'}],['-a','连接同时成立的表达式'],['-o','连接任一成立的表达式']], operands: [directory] },
  sed: { synopsis: 'sed [-n] [-e 脚本] [-f 文件] [文件…]', examples: ["sed -n '1,20p' app.log", "sed 's/old/new/g' input.txt"], options: [['-n','只输出显式打印的内容'],['-e','添加编辑脚本',{name:'脚本',kind:'value'}],['-f','从文件读取编辑脚本',file]], operands: [{name:'脚本',kind:'value'},file] },
  awk: { synopsis: 'awk [-F 分隔符] [-v 变量=值] [-f 程序文件] [程序] [文件…]', examples: ["awk -F ':' '{print $1}' /etc/passwd"], options: [['-F','设置字段分隔符',{name:'分隔符',kind:'value'}],['-v','执行程序前设置变量',{name:'变量=值',kind:'value'}],['-f','从文件读取程序',file]], operands: [{name:'程序',kind:'value'},file] },
  sort: { synopsis: 'sort [选项] [-o 输出文件] [文件…]', examples: ['sort -u names.txt', 'sort -n -k 2 data.txt'], options: [['-b','忽略字段开头空白'],['-c','检查输入是否已排序'],['-d','仅比较空白和字母数字'],['-f','忽略大小写'],['-i','忽略不可打印字符'],['-m','合并已排序文件'],['-n','按数值比较'],['-r','反转排序'],['-u','合并相同排序键'],['-k','指定排序键',{name:'起始字段[,结束字段]',kind:'value'}],['-o','写入指定文件',file],['-t','设置字段分隔符',{name:'分隔符',kind:'value'}]], operands: [file] },
  uniq: { synopsis: 'uniq [-c|-d|-u] [-f 字段数] [-s 字符数] [输入 [输出]]', examples: ['sort names.txt | uniq -c'], options: [['-c','显示重复次数'],['-d','只输出重复行',undefined,['-d','-u']],['-u','只输出未重复行',undefined,['-d','-u']],['-f','比较时跳过字段',count],['-s','比较时跳过字符',count]], operands: [file] },
  cut: { synopsis: 'cut -b 列表|-c 列表|-f 列表 [-d 分隔符] [-s] [文件…]', examples: ["cut -d ':' -f 1 /etc/passwd"], options: [['-b','选择字节位置',{name:'位置列表',kind:'value'},['-b','-c','-f']],['-c','选择字符位置',{name:'位置列表',kind:'value'},['-b','-c','-f']],['-f','选择字段',{name:'字段列表',kind:'value'},['-b','-c','-f']],['-d','设置字段分隔符',{name:'分隔符',kind:'value'}],['-s','跳过不含分隔符的行'],['-n','不拆开多字节字符']], operands: [file] },
  tr: { synopsis: 'tr [-c|-C] [-d] [-s] 字符集1 [字符集2]', examples: ["tr '[:lower:]' '[:upper:]'", "tr -s ' '"], options: [['-c','使用字节集合的补集',undefined,['-c','-C']],['-C','使用字符集合的补集',undefined,['-c','-C']],['-d','删除匹配字符'],['-s','压缩连续重复字符']], operands: [{name:'字符集',kind:'value'}] },
  wc: { synopsis: 'wc [-c|-m] [-lw] [文件…]', examples: ['wc -l app.log'], options: [['-c','统计字节数',undefined,['-c','-m']],['-m','统计字符数',undefined,['-c','-m']],['-l','统计行数'],['-w','统计词数']], operands: [file] },
  du: { synopsis: 'du [-a|-s] [-H|-L] [-kx] [文件…]', examples: ['du -sk /var/log'], options: [['-a','同时列出文件',undefined,['-a','-s']],['-s','每个参数只显示汇总',undefined,['-a','-s']],['-H','跟随命令行符号链接'],['-L','跟随所有符号链接'],['-k','按 1024 字节计数'],['-x','不跨越文件系统']], operands: [file] },
  df: { synopsis: 'df [-k] [-P|-t] [文件…]', examples: ['df -Pk /var'], options: [['-k','按 1024 字节计数'],['-P','使用便于处理的标准格式'],['-t','显示分配总量']], operands: [file] },
  touch: { synopsis: 'touch [-acm] [-r 参照文件|-t 时间] 文件…', examples: ['touch new.txt', 'touch -r source.txt target.txt'], options: [['-a','只更新访问时间'],['-m','只更新修改时间'],['-c','不创建缺失文件'],['-r','使用参照文件的时间',file,['-r','-t']],['-t','指定 [[CC]YY]MMDDhhmm[.SS] 时间',{name:'时间',kind:'value'},['-r','-t']]], operands: [file] },
  tee: { synopsis: 'tee [-ai] [文件…]', examples: ['printf hello | tee output.txt'], options: [['-a','追加到文件'],['-i','忽略中断信号']], operands: [file] },
  xargs: { synopsis: 'xargs [选项] [命令 [参数…]]', examples: ['printf "%s\\n" one two | xargs -n 1 printf "%s\\n"'], options: [['-E','设置逻辑输入结束标记',{name:'结束标记',kind:'value'}],['-I','按行替换指定占位符',{name:'占位符',kind:'value'},['-I','-L','-n']],['-L','每次处理的非空输入行数',count,['-I','-L','-n']],['-n','每次传递的参数数量',count,['-I','-L','-n']],['-p','执行前询问'],['-s','限制命令行字节数',count],['-t','显示将执行的命令'],['-x','超过长度限制时停止']], operands: [{name:'命令及参数',kind:'value'}] },
  printf: { synopsis: 'printf 格式 [参数…]', examples: ['printf "%s\\n" hello'], operands: [{name:'格式',kind:'value'},{name:'参数',kind:'value'}] },
  echo: { synopsis: 'echo [参数…]', examples: ['echo hello'], operands: [{name:'参数',kind:'value'}] },
  env: { synopsis: 'env [-i] [名称=值…] [命令 [参数…]]', examples: ['env', 'env LC_ALL=C sort names.txt'], options: [['-i','从空环境开始']], operands: [{name:'名称=值或命令',kind:'value'}] },
  export: { synopsis: 'export [-p] [名称[=值]…]', examples: ['export EDITOR=vi', 'export -p'], options: [['-p','列出导出的变量']], operands: [{name:'名称[=值]',kind:'value'}] },
  unset: { synopsis: 'unset [-f|-v] 名称…', examples: ['unset VARIABLE'], options: [['-f','移除函数',undefined,['-f','-v']],['-v','移除变量',undefined,['-f','-v']]], operands: [{name:'名称',kind:'value'}] },
  command: { synopsis: 'command [-p] 命令 [参数…] | command -v|-V 命令…', examples: ['command -v sh'], options: [['-p','使用标准工具搜索路径'],['-v','显示命令解释结果'],['-V','显示详细解释']], operands: [{name:'命令',kind:'value'}] },
  type: { synopsis: 'type 名称…', examples: ['type ls'], operands: [{name:'命令名称',kind:'value'}] },
  sleep: { synopsis: 'sleep 秒数', examples: ['sleep 5'], operands: [{name:'秒数',kind:'value'}] },
  basename: { synopsis: 'basename 路径 [后缀]', examples: ['basename /var/log/app.log .log'], operands: [file,{name:'后缀',kind:'value'}] },
  dirname: { synopsis: 'dirname 路径', examples: ['dirname /var/log/app.log'], operands: [file] },
  uname: { synopsis: 'uname [-amnrsv]', examples: ['uname -a'], options: [['-a','显示全部系统信息'],['-m','显示硬件类型'],['-n','显示节点名称'],['-r','显示系统发行号'],['-s','显示系统名称'],['-v','显示系统版本']] },
  id: { synopsis: 'id [-G|-g|-u] [-nr] [用户]', examples: ['id', 'id -u'], options: [['-G','显示所有组 ID',undefined,['-G','-g','-u']],['-g','显示有效组 ID',undefined,['-G','-g','-u']],['-u','显示有效用户 ID',undefined,['-G','-g','-u']],['-n','使用名称代替数字'],['-r','显示实际身份']], operands: [{name:'用户',kind:'value'}] },
  kill: { synopsis: 'kill [-s 信号] 进程… | kill -l [状态]', examples: ['kill -s TERM 1234', 'kill -l'], options: [['-s','选择发送的信号',{name:'信号',kind:'value',values:[['TERM','请求正常终止'],['HUP','挂断或重新加载'],['INT','中断'],['QUIT','退出'],['KILL','强制终止'],['STOP','暂停'],['CONT','继续']]}],['-l','列出或转换信号名称']], operands: [{name:'进程 ID 或作业',kind:'value'}] },
  nice: { synopsis: 'nice [-n 调整量] 命令 [参数…]', examples: ['nice -n 10 command'], options: [['-n','设置调度优先级调整量',{name:'调整量',kind:'value'}]], operands: [{name:'命令及参数',kind:'value'}] },
  nohup: { synopsis: 'nohup 命令 [参数…]', examples: ['nohup command > output.log 2>&1 &'], operands: [{name:'命令及参数',kind:'value'}] },
  test: { synopsis: 'test 表达式', examples: ['test -f config.conf', 'test -d /var/log'], options: [['-b','判断块设备',file],['-c','判断字符设备',file],['-d','判断目录',directory],['-e','判断路径存在',file],['-f','判断普通文件',file],['-g','判断 set-group-ID 位',file],['-h','判断符号链接',file],['-L','判断符号链接',file],['-n','判断字符串非空',{name:'字符串',kind:'value'}],['-p','判断命名管道',file],['-r','判断可读',file],['-S','判断套接字',file],['-s','判断文件非空',file],['-t','判断终端描述符',{name:'文件描述符',kind:'value'}],['-u','判断 set-user-ID 位',file],['-w','判断可写',file],['-x','判断可执行',file],['-z','判断字符串为空',{name:'字符串',kind:'value'}]], operands: [{name:'表达式',kind:'value'}] },
};

export const posixCommands: PosixCommand[] = Object.entries(posixCatalog).map(([name, description]) => {
  const value = details[name];
  return { name, description, synopsis: value?.synopsis || name, examples: value?.examples || [], operands: value?.operands || [], options: value?.options?.map(([name,description,argument,exclusive])=>({name,description,argument,exclusive})) || [] };
});
export const detailedCommandCount = Object.keys(details).length;
export const commandByName = new Map(posixCommands.map(command => [command.name, command]));
