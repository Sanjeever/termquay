import { commandByName, posixCommands, type CommandArgument, type PosixCommand } from './posixCommands.ts';
import type { ShellSnapshot } from './shellCompletionProtocol.ts';

type Word = { from: number; to: number; value: string; operator?: boolean };
export type CommandCandidate = { label: string; description: string; text: string; kind: 'command' | 'option' | 'value' | 'file' | 'directory' };
export type CompletionContext = { from: number; to: number; prefix: string; command?: PosixCommand; candidates: CommandCandidate[]; argument?: CommandArgument; path?: { directory: string; prefix: string; displayPrefix: string; tilde: boolean }; unsupported?: string };

function words(line: string): Word[] | null {
  const result: Word[] = [];
  let index = 0;
  while (index < line.length) {
    if (/\s/.test(line[index])) { index++; continue; }
    const from = index;
    if (/[|&;<>]/.test(line[index])) {
      const first = line[index++]; if (line[index] === first) index++;
      result.push({ from, to: index, value: line.slice(from,index), operator: true }); continue;
    }
    let value = '', quote = '';
    while (index < line.length) {
      const char = line[index];
      if (!quote && /[\s|&;<>]/.test(char)) break;
      if (char === '`' && quote !== "'" || char === '$' && line[index+1] === '(' && quote !== "'" || char === '#' && !quote && !value) return null;
      if (!quote && (char === "'" || char === '"')) { quote = char; index++; continue; }
      if (quote && char === quote) { quote = ''; index++; continue; }
      if (char === '\\' && quote !== "'") {
        if (quote === '"' && !/["$`\\\n]/.test(line[index+1] || '')) { value += char; index++; continue; }
        index++; if (index < line.length) value += line[index++]; continue;
      }
      value += char; index++;
    }
    result.push({ from, to: index, value });
  }
  return result;
}
function quoted(value: string) { return /^[a-zA-Z0-9_./:@%+,-]+$/.test(value) ? value : "'" + value.replace(/'/g, "'\\''") + "'"; }
function segment(line: string, cursor: number) {
  const all = words(line), before = words(line.slice(0,cursor));
  if (!all || !before) return null;
  const current = all.find(word=>!word.operator && word.from<=cursor && word.to>=cursor);
  const previous = before.filter(word=>word.to<=cursor && (!current || word.from<current.from));
  let boundary = -1;
  for (let i=0;i<previous.length;i++) if (previous[i].operator && !/[<>]/.test(previous[i].value)) boundary=i;
  return { current, previous: previous.slice(boundary+1), prefix: current ? words(line.slice(current.from,cursor))?.[0]?.value || '' : '' };
}
export function commandContext(snapshot: ShellSnapshot): CompletionContext {
  const { line, cursor, directory, home } = snapshot;
  const part = segment(line,cursor);
  if (!part) return { from:cursor,to:cursor,prefix:'',candidates:[],unsupported:'此处请使用 Shell 原生补全' };
  const {current,previous,prefix}=part;
  const from=current?.from??cursor, to=current?.to??cursor;
  const space = /\s/.test(line[to] || '') ? '' : ' ';
  const context: CompletionContext = { from,to,prefix,candidates:[] };
  if (!previous.length) {
    context.candidates=posixCommands.filter(command=>command.name.startsWith(prefix)).sort((a,b)=>a.name.localeCompare(b.name)).slice(0,50).map(command=>({label:command.name,description:command.description,text:command.name+space,kind:'command'}));
    context.command=commandByName.get(prefix);return context;
  }
  const command=commandByName.get(previous[0].value);context.command=command;
  let argument: CommandArgument | undefined, operand=0, endOptions=false;
  const used = new Set<string>();
  for (const word of previous.slice(1)) {
    if (argument) {argument=undefined;continue;}
    if (word.operator && /[<>]/.test(word.value)) {argument={name:'文件',kind:'file'};continue;}
    if (word.value==='--') {endOptions=true;continue;}
    if (!endOptions && word.value.startsWith('-') && word.value!=='-') {
      const exact=command?.options.find(option=>option.name===word.value);
      if (exact) {used.add(exact.name);argument=exact.argument;continue;}
      for (let i=1;i<word.value.length;i++) {
        const option=command?.options.find(option=>option.name===`-${word.value[i]}`);
        if (!option) break;
        used.add(option.name);
        if (option.argument) {if(i===word.value.length-1)argument=option.argument;break;}
      }
      continue;
    }
    operand++;
  }
  if (!argument && !endOptions && prefix.startsWith('-') && command) {
    context.candidates=command.options.filter(option=>option.name.startsWith(prefix)&&(!used.has(option.name)||!!option.argument)&&!option.exclusive?.some(name=>used.has(name)&&name!==option.name)).map(option=>({label:option.name+(option.argument?` ${option.argument.name}`:''),description:option.description,text:option.name+space,kind:'option'}));return context;
  }
  if (!argument && command) {
    let operands=command.operands;
    if ((command.name==='grep'||command.name==='sed')&&(used.has('-e')||used.has('-f')) || command.name==='awk'&&used.has('-f')) operands=operands.slice(1);
    argument=operands[Math.min(operand,operands.length-1)];
  }
  context.argument=argument;
  if (argument?.values) context.candidates=argument.values.filter(([value])=>value.startsWith(prefix)).map(([value,description])=>({label:value,description,text:quoted(value)+space,kind:'value'}));
  if (argument?.kind==='file'||argument?.kind==='directory'||!command) {
    if (/[\x00-\x1f\x7f$*?\[\]{}]/.test(prefix)) return context;
    const slash=prefix.lastIndexOf('/'), displayPrefix=slash<0?'':prefix.slice(0,slash+1);
    const tilde=line[from]==='~'&&prefix.startsWith('~/');
    if (prefix.startsWith('~')&&!tilde) return context;
    let path=displayPrefix;
    if (tilde) path=home+displayPrefix.slice(1);
    if (!path.startsWith('/')) path=directory+'/'+path;
    context.path={directory:path,prefix:prefix.slice(slash+1),displayPrefix,tilde};
  }
  return context;
}
export function pathCandidates(context: CompletionContext, entries: readonly {name:string;directory:boolean}[]): CommandCandidate[] {
  if(!context.path)return [];
  return entries.map(entry=>{
    let value=context.path!.displayPrefix+entry.name+(entry.directory?'/':'');
    if(value.startsWith('-'))value='./'+value;
    const text=context.path!.tilde?'~/'+quoted(value.slice(2)):quoted(value);
    return {label:entry.name+(entry.directory?'/':''),description:'',text:text+(entry.directory?'':' '),kind:entry.directory?'directory':'file'};
  });
}
