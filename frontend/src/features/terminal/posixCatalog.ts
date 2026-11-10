import { t as translate } from '../../i18n/index.ts';
export const posixCatalog: Record<string, string> = {
  get admin() {
    return translate('terminal:manageSCCSVersionFiles');
  },
  get alias() {
    return translate('terminal:defineOrDisplayCommandAliases');
  },
  get ar() {
    return translate('terminal:maintainArchiveLibraries');
  },
  get asa() {
    return translate('terminal:convertPrintControlCharacters');
  },
  get at() {
    return translate('terminal:scheduleAOneTimeTask');
  },
  get awk() {
    return translate('terminal:matchFieldsAndProcessText');
  },
  get basename() {
    return translate('terminal:extractTheLastPathComponent');
  },
  get batch() {
    return translate('terminal:scheduleBatchJobs');
  },
  get bc() {
    return translate('terminal:evaluateArbitraryPrecisionExpressions');
  },
  get bg() {
    return translate('terminal:resumeAJobInTheBackground');
  },
  get break() {
    return translate('terminal:exitALoop');
  },
  get c17() {
    return translate('terminal:compileC17Programs');
  },
  get cal() {
    return translate('terminal:displayACalendar');
  },
  get cat() {
    return translate('terminal:concatenateAndOutputFiles');
  },
  get cd() {
    return translate('terminal:changeCurrentDirectory');
  },
  get cflow() {
    return translate('terminal:generateProgramCallGraphs');
  },
  get chgrp() {
    return translate('terminal:changeFileGroupOwnership');
  },
  get chmod() {
    return translate('terminal:changeFilePermissions');
  },
  get chown() {
    return translate('terminal:changeFileOwnership');
  },
  get cksum() {
    return translate('terminal:computeFileChecksums');
  },
  get cmp() {
    return translate('terminal:compareFilesByteByByte');
  },
  get ':'() {
    return translate('terminal:doNothingAndReturnSuccess');
  },
  get comm() {
    return translate('terminal:compareTwoSortedTextFiles');
  },
  get command() {
    return translate('terminal:executeACommandOrLocateIt');
  },
  get compress() {
    return translate('terminal:compressFiles');
  },
  get uncompress() {
    return translate('terminal:decompressCompressFiles');
  },
  get zcat() {
    return translate('terminal:outputDecompressedContents');
  },
  get continue() {
    return translate('terminal:continueToTheNextLoopIteration');
  },
  get cp() {
    return translate('terminal:copyFilesOrDirectories');
  },
  get crontab() {
    return translate('terminal:manageCrontabEntries');
  },
  get csplit() {
    return translate('terminal:splitTextByContext');
  },
  get ctags() {
    return translate('terminal:generateSourceTagIndexes');
  },
  get cut() {
    return translate('terminal:extractTextFieldsOrCharacters');
  },
  get cxref() {
    return translate('terminal:generateCCrossReferences');
  },
  get date() {
    return translate('terminal:displayOrSetTheTime');
  },
  get dd() {
    return translate('terminal:copyAndConvertDataInBlocks');
  },
  get delta() {
    return translate('terminal:recordSCCSChanges');
  },
  get df() {
    return translate('terminal:displayFilesystemSpace');
  },
  get diff() {
    return translate('terminal:compareTextDifferences');
  },
  get dirname() {
    return translate('terminal:extractDirectoryFromAPath');
  },
  get '.'() {
    return translate('terminal:sourceAFileInTheCurrentShell');
  },
  get du() {
    return translate('terminal:estimateFileDiskUsage');
  },
  get echo() {
    return translate('terminal:outputArgumentText');
  },
  get ed() {
    return translate('terminal:editTextLineByLine');
  },
  get env() {
    return translate('terminal:displayOrModifyCommandEnvironment');
  },
  get eval() {
    return translate('terminal:joinArgumentsAndEvaluateAsAShellCommand');
  },
  get ex() {
    return translate('terminal:useALineModeEditor');
  },
  get exec() {
    return translate('terminal:replaceTheCurrentProcessWithACommand');
  },
  get exit() {
    return translate('terminal:exitTheShell');
  },
  get expand() {
    return translate('terminal:convertTabsToSpaces');
  },
  get export() {
    return translate('terminal:setExportedEnvironmentVariables');
  },
  get expr() {
    return translate('terminal:evaluateExpressions');
  },
  get false() {
    return translate('terminal:returnFailure');
  },
  get fc() {
    return translate('terminal:displayOrEditShellHistory');
  },
  get fg() {
    return translate('terminal:resumeAJobInTheForeground');
  },
  get file() {
    return translate('terminal:determineFileType');
  },
  get find() {
    return translate('terminal:findDirectoryEntriesByConditions');
  },
  get fold() {
    return translate('terminal:wrapTextToASpecifiedWidth');
  },
  get fuser() {
    return translate('terminal:findProcessesUsingFiles');
  },
  get gencat() {
    return translate('terminal:generateMessageCatalogs');
  },
  get get() {
    return translate('terminal:retrieveSCCSFileRevisions');
  },
  get getconf() {
    return translate('terminal:querySystemConfigurationValues');
  },
  get getopts() {
    return translate('terminal:parseShellScriptOptions');
  },
  get gettext() {
    return translate('terminal:queryTranslatedMessages');
  },
  get ngettext() {
    return translate('terminal:queryPluralTranslations');
  },
  get grep() {
    return translate('terminal:filterTextLinesByPattern');
  },
  get hash() {
    return translate('terminal:rememberOrDisplayCommandLocations');
  },
  get head() {
    return translate('terminal:outputTheBeginningOfFiles');
  },
  get iconv() {
    return translate('terminal:convertTextEncoding');
  },
  get id() {
    return translate('terminal:displayUserAndGroupIdentities');
  },
  get ipcrm() {
    return translate('terminal:removeInterprocessCommunicationObjects');
  },
  get ipcs() {
    return translate('terminal:displayInterprocessCommunicationObjects');
  },
  get jobs() {
    return translate('terminal:displayCurrentShellJobs');
  },
  get join() {
    return translate('terminal:joinSortedTextOnCommonFields');
  },
  get kill() {
    return translate('terminal:sendSignalsToProcesses');
  },
  get lex() {
    return translate('terminal:generateLexicalAnalyzers');
  },
  get link() {
    return translate('terminal:createHardLinks');
  },
  get ln() {
    return translate('terminal:createFileLinks');
  },
  get locale() {
    return translate('terminal:displayLocaleSettings');
  },
  get localedef() {
    return translate('terminal:generateLocaleDefinitions');
  },
  get logger() {
    return translate('terminal:writeToTheSystemLog');
  },
  get logname() {
    return translate('terminal:displayLoginUsername');
  },
  get lp() {
    return translate('terminal:submitPrintJobs');
  },
  get ls() {
    return translate('terminal:listDirectoryContents');
  },
  get m4() {
    return translate('terminal:expandMacros');
  },
  get mailx() {
    return translate('terminal:sendAndReceiveMail');
  },
  get make() {
    return translate('terminal:buildTargetsByDependencies');
  },
  get man() {
    return translate('terminal:viewSystemManuals');
  },
  get mesg() {
    return translate('terminal:controlTerminalMessageReception');
  },
  get mkdir() {
    return translate('terminal:createDirectories');
  },
  get mkfifo() {
    return translate('terminal:createNamedPipes');
  },
  get more() {
    return translate('terminal:pageThroughText');
  },
  get msgfmt() {
    return translate('terminal:compileMessageCatalogs');
  },
  get mv() {
    return translate('terminal:moveOrRenameFiles');
  },
  get newgrp() {
    return translate('terminal:changeCurrentGroup');
  },
  get nice() {
    return translate('terminal:startACommandWithSpecifiedPriority');
  },
  get nl() {
    return translate('terminal:numberTextLines');
  },
  get nm() {
    return translate('terminal:displayObjectFileSymbols');
  },
  get nohup() {
    return translate('terminal:runCommandsIgnoringHangupSignals');
  },
  get od() {
    return translate('terminal:displayFileBytesInSpecifiedFormats');
  },
  get paste() {
    return translate('terminal:mergeTextLinesByColumns');
  },
  get patch() {
    return translate('terminal:applyTextPatches');
  },
  get pathchk() {
    return translate('terminal:checkPathValidity');
  },
  get pax() {
    return translate('terminal:readCreateOrCopyArchives');
  },
  get pr() {
    return translate('terminal:formatTextForPrinting');
  },
  get printf() {
    return translate('terminal:printFormattedArguments');
  },
  get prs() {
    return translate('terminal:displaySCCSFileInformation');
  },
  get ps() {
    return translate('terminal:displayProcessStatus');
  },
  get pwd() {
    return translate('terminal:displayCurrentDirectory');
  },
  get read() {
    return translate('terminal:readALineIntoVariables');
  },
  get readlink() {
    return translate('terminal:readSymbolicLinkContents');
  },
  get readonly() {
    return translate('terminal:setReadOnlyVariables');
  },
  get realpath() {
    return translate('terminal:resolvePaths');
  },
  get renice() {
    return translate('terminal:adjustProcessSchedulingPriority');
  },
  get return() {
    return translate('terminal:returnFromAFunctionOrScript');
  },
  get rm() {
    return translate('terminal:removeFilesOrDirectories');
  },
  get rmdel() {
    return translate('terminal:removeSCCSChanges');
  },
  get rmdir() {
    return translate('terminal:removeEmptyDirectories');
  },
  get sact() {
    return translate('terminal:displaySCCSEditingStatus');
  },
  get sccs() {
    return translate('terminal:accessSCCSVersionManagementTools');
  },
  get sed() {
    return translate('terminal:transformTextStreamsUsingRules');
  },
  get set() {
    return translate('terminal:setShellParametersAndOptions');
  },
  get sh() {
    return translate('terminal:runTheStandardShell');
  },
  get shift() {
    return translate('terminal:shiftPositionalParameters');
  },
  get sleep() {
    return translate('terminal:waitForASpecifiedDuration');
  },
  get sort() {
    return translate('terminal:sortTextLines');
  },
  get split() {
    return translate('terminal:splitFiles');
  },
  get strings() {
    return translate('terminal:extractPrintableStringsFromFiles');
  },
  get strip() {
    return translate('terminal:stripObjectFileSymbols');
  },
  get stty() {
    return translate('terminal:displayOrSetTerminalAttributes');
  },
  get tabs() {
    return translate('terminal:setTerminalTabStops');
  },
  get tail() {
    return translate('terminal:outputTheEndOfFiles');
  },
  get talk() {
    return translate('terminal:communicateInteractivelyWithOtherUsers');
  },
  get tee() {
    return translate('terminal:writeToStdoutAndFilesSimultaneously');
  },
  get test() {
    return translate('terminal:evaluateExpressionTruth');
  },
  get time() {
    return translate('terminal:measureCommandExecutionTime');
  },
  get timeout() {
    return translate('terminal:limitCommandExecutionTime');
  },
  get times() {
    return translate('terminal:displayCumulativeShellExecutionTimes');
  },
  get touch() {
    return translate('terminal:updateFileTimestamps');
  },
  get tput() {
    return translate('terminal:queryOrSetTerminalCapabilities');
  },
  get tr() {
    return translate('terminal:translateDeleteOrSqueezeCharacters');
  },
  get trap() {
    return translate('terminal:setSignalHandlingActions');
  },
  get true() {
    return translate('terminal:returnSuccess');
  },
  get tsort() {
    return translate('terminal:performTopologicalSorting');
  },
  get tty() {
    return translate('terminal:displayTerminalDeviceName');
  },
  get type() {
    return translate('terminal:describeHowTheShellInterpretsACommandName');
  },
  get ulimit() {
    return translate('terminal:displayOrSetResourceLimits');
  },
  get umask() {
    return translate('terminal:displayOrSetDefaultPermissionMask');
  },
  get unalias() {
    return translate('terminal:removeCommandAliases');
  },
  get uname() {
    return translate('terminal:displaySystemInformation');
  },
  get unexpand() {
    return translate('terminal:convertSpacesToTabs');
  },
  get unget() {
    return translate('terminal:cancelSCCSEditing');
  },
  get uniq() {
    return translate('terminal:filterAdjacentDuplicateTextLines');
  },
  get unlink() {
    return translate('terminal:removeAFileLink');
  },
  get unset() {
    return translate('terminal:removeVariablesOrFunctions');
  },
  get uucp() {
    return translate('terminal:copyFilesBetweenSystems');
  },
  get uudecode() {
    return translate('terminal:decodeUuencodedData');
  },
  get uuencode() {
    return translate('terminal:encodeBinaryDataAsText');
  },
  get uustat() {
    return translate('terminal:displayUUCPJobStatus');
  },
  get uux() {
    return translate('terminal:requestRemoteCommandExecution');
  },
  get val() {
    return translate('terminal:validateSCCSFiles');
  },
  get vi() {
    return translate('terminal:editTextFilesInteractively');
  },
  get wait() {
    return translate('terminal:waitForBackgroundProcessesOrJobs');
  },
  get wc() {
    return translate('terminal:countLinesWordsAndBytes');
  },
  get what() {
    return translate('terminal:displayFileVersionIdentifiers');
  },
  get who() {
    return translate('terminal:displayLoggedInUsers');
  },
  get write() {
    return translate('terminal:sendMessagesToUserTerminals');
  },
  get xargs() {
    return translate('terminal:convertInputToCommandArguments');
  },
  get xgettext() {
    return translate('terminal:extractTranslatableMessages');
  },
  get yacc() {
    return translate('terminal:generateParsers');
  },
};
