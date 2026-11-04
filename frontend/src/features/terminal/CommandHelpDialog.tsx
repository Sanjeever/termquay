import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Modal, ModalBody, ModalContent, ModalHeader, ModalFooter } from '@heroui/react';
import { Browser } from '@wailsio/runtime';
import { commandByName, detailedCommandCount, posixCommands } from './posixCommands';
import ErrorNotice from '../../components/ErrorNotice';
import { errorMessage } from '../../lib/errors';

export default function CommandHelpDialog({initial='',enabled,onEnable,onClose}:{initial?:string;enabled:boolean;onEnable():void;onClose():void}) {
  const [query,setQuery]=useState('');
  const [selected,setSelected]=useState(initial||'ls');
  const [error,setError]=useState('');
  const navigation=useRef<HTMLElement>(null),article=useRef<HTMLElement>(null);
  const matches=useMemo(()=>posixCommands.filter(command=>`${command.name} ${command.description}`.toLowerCase().includes(query.toLowerCase())),[query]);
  const command=commandByName.get(selected);
  useEffect(()=>{if(article.current)article.current.scrollTop=0;navigation.current?.querySelector('[aria-current=page]')?.scrollIntoView({block:'nearest'});},[selected]);
  return <Modal isOpen onClose={onClose} className="app-dialog command-help-dialog" scrollBehavior="inside"><ModalContent><ModalHeader>POSIX 命令参考</ModalHeader><ModalBody>
    {!enabled&&<div className="command-help-enable"><span className="muted">增强补全尚未启用</span><Button size="sm" variant="flat" onPress={onEnable}>启用当前 Shell 集成</Button></div>}
    <input className="command-help-search" autoFocus aria-label="搜索 POSIX 命令" placeholder="搜索命令或用途" value={query} onChange={event=>setQuery(event.target.value)}/>
    <div className="command-help-layout"><nav ref={navigation} aria-label="POSIX 命令">{matches.map(item=><button key={item.name} aria-current={selected===item.name?'page':undefined} onClick={()=>setSelected(item.name)}><code>{item.name}</code><span>{item.description}</span></button>)}{!matches.length&&<p className="muted" role="status">无匹配命令</p>}</nav>
      {command&&<article ref={article}><h2>{command.name}</h2><p>{command.description}</p><pre>{command.synopsis}</pre>
        {!!command.operands.length&&<dl className="command-help-arguments">{command.operands.map((argument,index)=><div key={index}><dt>{argument.name}</dt><dd>{argument.values?.map(([value,description])=>`${value} · ${description}`).join('；')||({file:'文件路径',directory:'目录路径',value:'文本参数'}[argument.kind||'value'])}</dd></div>)}</dl>}
        {!!command.options.length&&<table><caption>选项</caption><tbody>{command.options.map(option=><tr key={option.name}><th><code>{option.name}{option.argument&&` ${option.argument.name}`}</code></th><td>{option.description}</td></tr>)}</tbody></table>}
        {!!command.examples.length&&<><h3>示例</h3>{command.examples.map(example=><pre key={example}>{example}</pre>)}</>}
        {!command.options.length&&!command.operands.length&&!command.examples.length&&<p className="muted">该命令当前提供用途索引，完整用法见原手册。</p>}
        <button className="session-tool" onClick={()=>void Browser.OpenURL(`https://manp.gs/posix/1/${encodeURIComponent(command.name==='.'?'dot':command.name===':'?'colon':command.name)}`).catch(error=>setError(errorMessage(error)))}>打开原手册</button>
      </article>}
    </div><ErrorNotice message={error} onDismiss={()=>setError('')}/>
  </ModalBody><ModalFooter><span className="muted">{posixCommands.length} 个命令 · {detailedCommandCount} 个参数定义</span><Button variant="light" onPress={onClose}>关闭</Button></ModalFooter></ModalContent></Modal>;
}
