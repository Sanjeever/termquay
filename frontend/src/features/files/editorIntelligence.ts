import { autocompletion, completeAnyWord, completeFromList, completionKeymap, snippet, startCompletion, type Completion } from '@codemirror/autocomplete';
import { syntaxTree } from '@codemirror/language';
import { EditorState, Prec, type Extension } from '@codemirror/state';
import { hoverTooltip, keymap } from '@codemirror/view';
import { tooltipDelay } from '../../components/Tooltip';
import type { EditorLanguageID } from './editorLanguage';
import { editorDiagnostics } from './editorDiagnostics';

const words: Partial<Record<EditorLanguageID,string>> = {
  json:'true false null',
  rust:'as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while',
  c:'auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while',
  cpp:'alignas alignof auto bool break case catch char class const constexpr continue default delete do double else enum explicit extern false float for friend if inline int long namespace new noexcept nullptr operator override private protected public return short signed sizeof static struct switch template this throw true try typedef typename union unsigned using virtual void volatile while',
  java:'abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for if implements import instanceof int interface long native new null package private protected public return short static strictfp super switch synchronized this throw throws transient true false try void volatile while',
  csharp:'abstract as async await base bool break case catch char checked class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach get if implicit in int interface internal is lock long namespace new null object operator out override params private protected public readonly ref return sealed set short sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using virtual void volatile while yield',
  ruby:'alias and begin break case class def defined do else elsif end ensure false for if in module next nil not or redo rescue retry return self super then true undef unless until when while yield',
  lua:'and break do else elseif end false for function goto if in local nil not or repeat return then true until while',
  perl:'my our local sub use require package if elsif else unless while until for foreach continue last next redo return undef defined print say strict warnings',
  shell:'if then elif else fi for in do done while until case esac function select return exit export local readonly unset set source printf echo test trap',
  powershell:'begin break catch class continue data define do dynamicparam else elseif end enum exit filter finally for foreach from function if in param process return switch throw trap try until using var while workflow',
  batch:'echo set setlocal endlocal if else for in do call goto exit shift not exist defined errorlevel pushd popd cd dir copy move del mkdir rmdir pause start type title timeout',
  dockerfile:'FROM RUN CMD LABEL MAINTAINER EXPOSE ENV ADD COPY ENTRYPOINT VOLUME USER WORKDIR ARG ONBUILD STOPSIGNAL HEALTHCHECK SHELL',
  makefile:'include ifdef ifndef ifeq ifneq else endif define endef export unexport override private vpath PHONY',
  toml:'true false',ini:'true false',yaml:'true false null',
};
const configuration: Partial<Record<EditorLanguageID,readonly [string,string][]>> = {
  nginx:[['server','定义虚拟主机配置块'],['location','按请求路径匹配配置'],['listen','监听地址、端口及协议选项'],['server_name','匹配请求的主机名'],['root','文件根目录'],['index','默认索引文件'],['proxy_pass','上游代理地址'],['proxy_set_header','设置转发到上游的请求头'],['upstream','定义上游服务组'],['include','引入其他配置文件'],['access_log','访问日志路径及格式'],['error_log','错误日志路径和级别'],['try_files','依次检查文件并选择处理方式'],['return','返回状态码或重定向'],['ssl_certificate','服务器证书文件'],['ssl_certificate_key','服务器证书私钥文件']],
  systemd:[['Unit','单元说明与依赖配置段'],['Service','服务运行参数配置段'],['Install','启用单元时的安装关系配置段'],['Description','单元说明'],['After','启动顺序，指定本单元在其后启动'],['Requires','强依赖的单元'],['Wants','弱依赖的单元'],['Type','服务进程与就绪判定方式'],['User','运行用户'],['WorkingDirectory','进程工作目录'],['ExecStart','启动命令'],['ExecStop','停止命令'],['Restart','进程退出后的重启策略'],['RestartSec','重启前等待时间'],['Environment','进程环境变量'],['EnvironmentFile','环境变量文件'],['WantedBy','启用时关联到的目标单元']],
  ssh:[['Host','客户端主机匹配模式'],['HostName','实际连接的主机地址'],['User','登录用户名'],['Port','连接端口'],['IdentityFile','客户端私钥文件路径'],['IdentityAgent','SSH Agent 地址'],['ProxyJump','连接经过的跳板'],['ServerAliveInterval','客户端应用层保活间隔'],['ServerAliveCountMax','保活失败次数上限'],['Include','引入配置文件'],['Match','条件匹配配置段'],['PermitRootLogin','服务端 root 登录策略'],['PasswordAuthentication','服务端密码认证策略'],['PubkeyAuthentication','公钥认证策略'],['AllowUsers','允许登录的用户名模式'],['ListenAddress','服务端监听地址']],
  dockerfile:[['FROM','选择基础镜像，可为构建阶段命名'],['RUN','构建时执行命令'],['COPY','复制构建上下文或其他构建阶段的文件'],['WORKDIR','设置后续命令的工作目录'],['ARG','构建参数'],['ENV','镜像环境变量'],['EXPOSE','声明容器服务端口'],['CMD','默认容器启动参数'],['ENTRYPOINT','容器入口命令'],['USER','后续步骤及运行时使用的用户'],['HEALTHCHECK','容器健康检查命令']],
};
const templates: Partial<Record<EditorLanguageID,readonly [string,string,string][]>> = {
  go:[['func','定义函数','func ${name}(${args}) ${result} {\n\t${}\n}'],['iferr','检查错误','if err != nil {\n\treturn ${err}\n}'],['forrange','遍历集合','for ${key}, ${value} := range ${items} {\n\t${}\n}']],
  rust:[['fn','定义函数','fn ${name}(${args}) -> ${Result} {\n\t${}\n}'],['match','模式匹配','match ${value} {\n\t${pattern} => ${result},\n}']],
  shell:[['if','条件分支','if ${command}; then\n\t${}\nfi'],['for','遍历参数','for ${item} in ${items}; do\n\t${}\ndone']],
  nginx:[['server-block','虚拟主机配置块','server {\n\tlisten ${80};\n\tserver_name ${example.com};\n\troot ${/var/www/html};\n\t${}\n}'],['location-block','路径匹配配置块','location ${/} {\n\t${}\n}']],
  systemd:[['service-unit','基础服务单元','[Unit]\nDescription=${服务名称}\nAfter=network.target\n\n[Service]\nType=simple\nExecStart=${/path/to/program}\nRestart=on-failure\n\n[Install]\nWantedBy=multi-user.target\n']],
  dockerfile:[['copy-stage','复制其他构建阶段的文件','COPY --from=${build} ${/app/program} ${/usr/local/bin/program}'],['healthcheck','健康检查','HEALTHCHECK --interval=${30s} --timeout=${3s} CMD ${command}']],
  markdown:[['link','插入链接','[${标题}](${地址})'],['image','插入图片','![${说明}](${图片路径})'],['code','围栏代码块','```${语言}\n${代码}\n```'],['table','插入表格','| ${列一} | ${列二} |\n| --- | --- |\n| ${内容} | ${内容} |']],
  makefile:[['target','定义构建目标','${target}: ${dependencies}\n\t${command}']],
};

export function editorIntelligence(language: EditorLanguageID, onDiagnosticError: (message:string)=>void,diagnostics=true): Extension {
  const descriptions = new Map(configuration[language] || []);
  const completions: Completion[] = [...new Set((words[language] || '').split(' ').filter(Boolean).concat([...descriptions.keys()]))].map(label=>({label,type:'keyword',info:descriptions.get(label)}));
  for (const [label,info,text] of templates[language] || []) completions.push({label,type:'snippet',info,apply:snippet(text)});
  const complete = completeFromList(completions);
  return [
    autocompletion({activateOnTypingDelay:150,maxRenderedOptions:30,defaultKeymap:false}),
    Prec.high(keymap.of(completionKeymap.filter(binding=>binding.key!=='Ctrl-Space'))),
    EditorState.languageData.of(()=>[{autocomplete:context=>{
      if (context.view?.composing) return null;
      if (!context.explicit && (context.matchBefore(/[\w.-]+/)?.text.length || 0)<2) return null;
      if (!context.explicit && /comment|string|template/i.test(syntaxTree(context.state).resolveInner(context.pos,-1).name)) return null;
      return completeAnyWord(context);
    }}, ...(completions.length?[{autocomplete:complete}]:[])]),
    hoverTooltip((view,pos)=>{
      const line = view.state.doc.lineAt(pos);
      const before = line.text.slice(0,pos-line.from).match(/[\w_]+$/)?.[0] || '';
      const after = line.text.slice(pos-line.from).match(/^[\w_]+/)?.[0] || '';
      const text = descriptions.get(before+after);
      if (!text) return null;
      return {pos:pos-before.length,end:pos+after.length,above:true,create(){const dom=document.createElement('div');dom.className='editor-word-help';dom.textContent=text;return {dom};}};
    }, { hoverTime: tooltipDelay, hideOnChange: true }),
    diagnostics&&(language==='json'||language==='yaml')?editorDiagnostics(language,onDiagnosticError):[],
  ];
}

export { startCompletion };
