import { t as translate } from '../../i18n/index.ts';
import {
  autocompletion,
  completeAnyWord,
  completeFromList,
  completionKeymap,
  snippet,
  startCompletion,
  type Completion,
} from '@codemirror/autocomplete';
import { syntaxTree } from '@codemirror/language';
import { EditorState, Prec, type Extension } from '@codemirror/state';
import { hoverTooltip, keymap } from '@codemirror/view';
import { tooltipDelay } from '../../components/Tooltip';
import type { EditorLanguageID } from './editorLanguage';
import { editorDiagnostics } from './editorDiagnostics';

const words: Partial<Record<EditorLanguageID, string>> = {
  json: 'true false null',
  rust: 'as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while',
  c: 'auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while',
  cpp: 'alignas alignof auto bool break case catch char class const constexpr continue default delete do double else enum explicit extern false float for friend if inline int long namespace new noexcept nullptr operator override private protected public return short signed sizeof static struct switch template this throw true try typedef typename union unsigned using virtual void volatile while',
  java: 'abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for if implements import instanceof int interface long native new null package private protected public return short static strictfp super switch synchronized this throw throws transient true false try void volatile while',
  csharp:
    'abstract as async await base bool break case catch char checked class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach get if implicit in int interface internal is lock long namespace new null object operator out override params private protected public readonly ref return sealed set short sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using virtual void volatile while yield',
  ruby: 'alias and begin break case class def defined do else elsif end ensure false for if in module next nil not or redo rescue retry return self super then true undef unless until when while yield',
  lua: 'and break do else elseif end false for function goto if in local nil not or repeat return then true until while',
  perl: 'my our local sub use require package if elsif else unless while until for foreach continue last next redo return undef defined print say strict warnings',
  shell:
    'if then elif else fi for in do done while until case esac function select return exit export local readonly unset set source printf echo test trap',
  powershell:
    'begin break catch class continue data define do dynamicparam else elseif end enum exit filter finally for foreach from function if in param process return switch throw trap try until using var while workflow',
  batch:
    'echo set setlocal endlocal if else for in do call goto exit shift not exist defined errorlevel pushd popd cd dir copy move del mkdir rmdir pause start type title timeout',
  dockerfile:
    'FROM RUN CMD LABEL MAINTAINER EXPOSE ENV ADD COPY ENTRYPOINT VOLUME USER WORKDIR ARG ONBUILD STOPSIGNAL HEALTHCHECK SHELL',
  makefile:
    'include ifdef ifndef ifeq ifneq else endif define endef export unexport override private vpath PHONY',
  toml: 'true false',
  ini: 'true false',
  yaml: 'true false null',
};
const configuration = (): Partial<Record<EditorLanguageID, readonly [string, string][]>> => ({
  nginx: [
    ['server', translate('files:defineAVirtualHostBlock')],
    ['location', translate('files:matchConfigurationByRequestPath')],
    ['listen', translate('files:listeningAddressPortAndProtocolOptions')],
    ['server_name', translate('files:matchRequestedHostnames')],
    ['root', translate('files:documentRootDirectory')],
    ['index', translate('files:defaultIndexFiles')],
    ['proxy_pass', translate('files:upstreamProxyAddress')],
    ['proxy_set_header', translate('files:setRequestHeadersForwardedUpstream')],
    ['upstream', translate('files:defineAnUpstreamServiceGroup')],
    ['include', translate('files:includeOtherConfigurationFiles')],
    ['access_log', translate('files:accessLogPathAndFormat')],
    ['error_log', translate('files:errorLogPathAndLevel')],
    ['try_files', translate('files:checkFilesInOrderAndChooseHowTo')],
    ['return', translate('files:returnAStatusCodeOrRedirect')],
    ['ssl_certificate', translate('files:serverCertificateFile')],
    ['ssl_certificate_key', translate('files:serverCertificatePrivateKeyFile')],
  ],
  systemd: [
    ['Unit', translate('files:unitDescriptionAndDependenciesSection')],
    ['Service', translate('files:serviceRuntimeParametersSection')],
    ['Install', translate('files:installationRelationshipsWhenEnablingAUnit')],
    ['Description', translate('files:unitDescription')],
    ['After', translate('files:startAfterTheSpecifiedUnits')],
    ['Requires', translate('files:requiredUnits')],
    ['Wants', translate('files:wantedUnits')],
    ['Type', translate('files:serviceProcessAndReadinessType')],
    ['User', translate('files:runAsUser')],
    ['WorkingDirectory', translate('files:processWorkingDirectory')],
    ['ExecStart', translate('files:startCommand')],
    ['ExecStop', translate('files:stopCommand')],
    ['Restart', translate('files:restartPolicyAfterProcessExit')],
    ['RestartSec', translate('files:delayBeforeRestarting')],
    ['Environment', translate('files:processEnvironmentVariables')],
    ['EnvironmentFile', translate('files:environmentFile')],
    ['WantedBy', translate('files:targetUnitsAssociatedOnEnable')],
  ],
  ssh: [
    ['Host', translate('files:clientHostMatchingPattern')],
    ['HostName', translate('files:actualDestinationHostname')],
    ['User', translate('files:loginUsername')],
    ['Port', translate('files:connectionPort')],
    ['IdentityFile', translate('files:clientPrivateKeyFilePath')],
    ['IdentityAgent', translate('files:sSHAgentAddress')],
    ['ProxyJump', translate('files:jumpHostsAlongTheConnectionRoute')],
    ['ServerAliveInterval', translate('files:clientApplicationKeepaliveInterval')],
    ['ServerAliveCountMax', translate('files:maximumMissedKeepalives')],
    ['Include', translate('files:includeConfigurationFiles')],
    ['Match', translate('files:conditionalConfigurationSection')],
    ['PermitRootLogin', translate('files:serverRootLoginPolicy')],
    ['PasswordAuthentication', translate('files:serverPasswordAuthenticationPolicy')],
    ['PubkeyAuthentication', translate('files:publicKeyAuthenticationPolicy')],
    ['AllowUsers', translate('files:allowedLoginUsernamePatterns')],
    ['ListenAddress', translate('files:serverListeningAddress')],
  ],
  dockerfile: [
    ['FROM', translate('files:chooseABaseImageAndOptionallyNameThe')],
    ['RUN', translate('files:executeACommandDuringBuild')],
    ['COPY', translate('files:copyFilesFromTheBuildContextOrAnother')],
    ['WORKDIR', translate('files:setTheWorkingDirectoryForSubsequentCommands')],
    ['ARG', translate('files:buildArguments')],
    ['ENV', translate('files:imageEnvironmentVariables')],
    ['EXPOSE', translate('files:declareContainerServicePorts')],
    ['CMD', translate('files:defaultContainerArguments')],
    ['ENTRYPOINT', translate('files:containerEntrypointCommand')],
    ['USER', translate('files:userForSubsequentStepsAndRuntime')],
    ['HEALTHCHECK', translate('files:containerHealthCheckCommand')],
  ],
});
const templates = (): Partial<Record<EditorLanguageID, readonly [string, string, string][]>> => ({
  go: [
    ['func', translate('files:defineAFunction'), 'func ${name}(${args}) ${result} {\n\t${}\n}'],
    ['iferr', translate('files:checkAnError'), 'if err != nil {\n\treturn ${err}\n}'],
    [
      'forrange',
      translate('files:iterateACollection'),
      'for ${key}, ${value} := range ${items} {\n\t${}\n}',
    ],
  ],
  rust: [
    ['fn', translate('files:defineAFunction'), 'fn ${name}(${args}) -> ${Result} {\n\t${}\n}'],
    [
      'match',
      translate('files:patternMatching'),
      'match ${value} {\n\t${pattern} => ${result},\n}',
    ],
  ],
  shell: [
    ['if', translate('files:conditionalBranch'), 'if ${command}; then\n\t${}\nfi'],
    ['for', translate('files:iterateArguments'), 'for ${item} in ${items}; do\n\t${}\ndone'],
  ],
  nginx: [
    [
      'server-block',
      translate('files:virtualHostBlock'),
      'server {\n\tlisten ${80};\n\tserver_name ${example.com};\n\troot ${/var/www/html};\n\t${}\n}',
    ],
    ['location-block', translate('files:pathMatchingBlock'), 'location ${/} {\n\t${}\n}'],
  ],
  systemd: [
    [
      'service-unit',
      translate('files:basicServiceUnit'),
      translate('files:unitDescriptionServiceNameAfterNetworkTargetService'),
    ],
  ],
  dockerfile: [
    [
      'copy-stage',
      translate('files:copyFilesFromAnotherBuildStage'),
      'COPY --from=${build} ${/app/program} ${/usr/local/bin/program}',
    ],
    [
      'healthcheck',
      translate('files:healthCheck'),
      'HEALTHCHECK --interval=${30s} --timeout=${3s} CMD ${command}',
    ],
  ],
  markdown: [
    ['link', translate('files:insertLink'), translate('files:titleURL')],
    ['image', translate('files:insertImage'), translate('files:altTextImagePath')],
    ['code', translate('files:fencedCodeBlock'), translate('files:languageCode')],
    ['table', translate('files:insertTable'), translate('files:column1Column2ContentContent')],
  ],
  makefile: [
    ['target', translate('files:defineABuildTarget'), '${target}: ${dependencies}\n\t${command}'],
  ],
});

export function editorIntelligence(
  language: EditorLanguageID,
  onDiagnosticError: (error: unknown) => void,
  diagnostics = true,
): Extension {
  const descriptions = new Map(configuration()[language] || []);
  const completions: Completion[] = [
    ...new Set(
      (words[language] || '')
        .split(' ')
        .filter(Boolean)
        .concat([...descriptions.keys()]),
    ),
  ].map((label) => ({ label, type: 'keyword', info: descriptions.get(label) }));
  for (const [label, info, text] of templates()[language] || [])
    completions.push({ label, type: 'snippet', info, apply: snippet(text) });
  const complete = completeFromList(completions);
  return [
    autocompletion({ activateOnTypingDelay: 150, maxRenderedOptions: 30, defaultKeymap: false }),
    Prec.high(keymap.of(completionKeymap.filter((binding) => binding.key !== 'Ctrl-Space'))),
    EditorState.languageData.of(() => [
      {
        autocomplete: (context) => {
          if (context.view?.composing) return null;
          if (!context.explicit && (context.matchBefore(/[\w.-]+/)?.text.length || 0) < 2)
            return null;
          if (
            !context.explicit &&
            /comment|string|template/i.test(
              syntaxTree(context.state).resolveInner(context.pos, -1).name,
            )
          )
            return null;
          return completeAnyWord(context);
        },
      },
      ...(completions.length ? [{ autocomplete: complete }] : []),
    ]),
    hoverTooltip(
      (view, pos) => {
        const line = view.state.doc.lineAt(pos);
        const before = line.text.slice(0, pos - line.from).match(/[\w_]+$/)?.[0] || '';
        const after = line.text.slice(pos - line.from).match(/^[\w_]+/)?.[0] || '';
        const text = descriptions.get(before + after);
        if (!text) return null;
        return {
          pos: pos - before.length,
          end: pos + after.length,
          above: true,
          create() {
            const dom = document.createElement('div');
            dom.className = 'editor-word-help';
            dom.textContent = text;
            return { dom };
          },
        };
      },
      { hoverTime: tooltipDelay, hideOnChange: true },
    ),
    diagnostics && (language === 'json' || language === 'yaml')
      ? editorDiagnostics(language, onDiagnosticError)
      : [],
  ];
}

export { startCompletion };
