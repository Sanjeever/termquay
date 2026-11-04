import { errorMessage } from "../../lib/errors";
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Button, Dropdown, DropdownItem, DropdownMenu, DropdownTrigger, Tooltip } from '@heroui/react';
import { Events, System } from '@wailsio/runtime';
import Workbench from '../../components/layout/Workbench';
import WorkspaceTabs from '../../components/layout/WorkspaceTabs';
import ResizeHandle from '../../components/layout/ResizeHandle';
import CommandPalette, { type WorkbenchCommand } from '../../components/CommandPalette';
import Icon from '../../components/Icon';
import ConnectionCenter from '../connections/ConnectionCenter';
import FileBrowser from '../files/FileBrowser';
import PaneTabs from '../files/PaneTabs';
import WorkspacePanes from '../files/WorkspacePanes';
import type { EditorFormat } from '../files/editorFormat';
import MonitorPanel from '../monitor/MonitorPanel';
import TerminalView, { type TerminalHandle } from '../terminal/TerminalView';
import AppearanceSettings from '../settings/AppearanceSettings';
import { useAppearance } from '../settings/AppearanceProvider';
import { uiZoomLevels } from '../settings/appearance';
import { eventShortcut, shortcutDefinitions, shortcutLabel, type Shortcuts } from '../../lib/shortcuts';
import type { Connection } from '../../../bindings/github.com/Sanjeever/termquay/internal/store/models';
import type { Entry } from '../../../bindings/github.com/Sanjeever/termquay/internal/files/models';
import { demoConnections, demoDirectories, demoFiles, demoGroups, demoLatency, demoPreferences, demoSamples, demoTerminal } from './data';
import { demoScenes, type DemoScene } from './scenes';

const CodeEditor = lazy(() => import('../files/CodeEditor'));
const initialFiles = ['/srv/termquay/config/nginx.conf', '/srv/termquay/config/application.yaml'];
type Draft = { content: string; saved: string; format: EditorFormat; savedFormat: string; epoch: number };

export default function DemoWorkbench({ scene, onScene, onExit, shortcuts, fontSize: initialFontSize }: {
  scene: DemoScene; onScene(scene: DemoScene): void; onExit(): void; shortcuts: Shortcuts; fontSize: number;
}) {
  const [items, setItems] = useState([demoConnections[0], demoConnections[2]]);
  const [active, setActive] = useState(scene === 'connections' ? '' : demoConnections[0].id);
  const [files, setFiles] = useState(initialFiles);
  const [terminalOpen, setTerminalOpen] = useState(true);
  const [documents, setDocuments] = useState<Record<string,Draft>>(() => Object.fromEntries(Object.entries(demoFiles).map(([path,content]) => {
    const format: EditorFormat = { encoding: 'UTF-8', line_ending: 'LF', bom: false };
    return [path, { content, saved: content, format, savedFormat: JSON.stringify(format), epoch: 0 }];
  })));
  const [selected, setSelected] = useState<[string,string]>([scene === 'editor' ? initialFiles[0] : 'terminal', initialFiles[0]]);
  const [split, setSplit] = useState(false);
  const [ratio, setRatio] = useState(50);
  const [activePane, setActivePane] = useState(0);
  const [filesOpen, setFilesOpen] = useState(true);
  const [filesWidth, setFilesWidth] = useState(248);
  const [monitorOpen, setMonitorOpen] = useState(scene === 'terminal');
  const [focus, setFocus] = useState(false);
  const [settings, setSettings] = useState(false);
  const [settingsSection, setSettingsSection] = useState<'appearance'|'terminal'>('appearance');
  const [fontSize, setFontSize] = useState(initialFontSize);
  const [palette, setPalette] = useState(false);
  const [error, setError] = useState('');
  const [narrow, setNarrow] = useState(() => matchMedia('(max-width: 1100px)').matches);
  const [narrowPanel, setNarrowPanel] = useState<'files'|'monitor'|null>(null);
  const root = useRef<HTMLDivElement>(null);
  const terminal = useRef<TerminalHandle>(null);
  const { appearance, update } = useAppearance();
  const current = items.find(item => item.id === active);
  const visible = !!current && !settings;
  const filesShown = !focus && filesOpen && (!narrow || narrowPanel === 'files');
  const monitorShown = !focus && monitorOpen && (!narrow || narrowPanel === 'monitor');
  const paneFor = (id: string) => split && id !== 'terminal' ? 1 : 0;
  const shown = (id: string) => selected[paneFor(id)] === id;
  const dirty = (path: string) => documents[path].content !== documents[path].saved || JSON.stringify(documents[path].format) !== documents[path].savedFormat;
  useEffect(() => { const media=matchMedia('(max-width: 1100px)');const resize=()=>{setNarrow(media.matches);setNarrowPanel(null);};media.addEventListener('change',resize);return()=>media.removeEventListener('change',resize); }, []);
  function selectWorkspace(id: string) { setActive(id); setSettings(false); }
  function activate(id: string) { const pane=paneFor(id);setSelected(previous=>pane===0?[id,previous[1]]:[previous[0],id]);setActivePane(pane); }
  function open(connection: Connection) { if(connection.protocol!=='ssh')return;setItems(previous=>previous.some(item=>item.id===connection.id)?previous:[...previous,connection]);selectWorkspace(connection.id); }
  function closeWorkspace(id = active) { setItems(previous=>previous.filter(item=>item.id!==id));if(active===id)setActive(''); }
  function closeTab(id: string) {
    if(id==='terminal'){setTerminalOpen(false);setSplit(false);setActivePane(0);setSelected([files[0]||'','']);return;}
    const remaining=files.filter(path=>path!==id);setFiles(remaining);
    if(split&&!remaining.length){setSplit(false);setActivePane(0);setSelected([terminalOpen?'terminal':'','']);return;}
    setSelected(previous=>[previous[0]===id?(terminalOpen?'terminal':remaining[0]||''):previous[0],previous[1]===id?remaining[0]||'':previous[1]]);
  }
  function closeCurrent() { if(settings)setSettings(false);else if(current){const id=selected[activePane];if(id==='terminal'&&terminalOpen||files.includes(id))closeTab(id);else closeWorkspace();} }
  async function openFile(entry: Entry) { if(!documents[entry.path])throw new Error('此文件没有演示内容');setFiles(previous=>previous.includes(entry.path)?previous:[...previous,entry.path]);activate(entry.path); }
  function toggleFiles() { setFocus(false);setFilesOpen(true);if(narrow)setNarrowPanel(previous=>previous==='files'?null:'files');else setFilesOpen(!filesOpen); }
  function toggleMonitor() { setFocus(false);setMonitorOpen(true);if(narrow)setNarrowPanel(previous=>previous==='monitor'?null:'monitor');else setMonitorOpen(!monitorOpen); }
  function moveWorkspace(id: string, target: string) { setItems(previous=>{const next=[...previous];const source=next.findIndex(item=>item.id===id);const destination=next.findIndex(item=>item.id===target);next.splice(destination,0,...next.splice(source,1));return next;}); }
  const commands: WorkbenchCommand[] = [
    ...demoScenes.map(item=>({id:`demo-${item.id}`,label:item.label,search:'demo 演示模式',kind:'command' as const,run:()=>onScene(item.id)})),
    {id:'exit-demo',label:'退出演示模式',kind:'command',run:onExit},
    {id:'palette',label:'命令搜索',kind:'command',shortcut:shortcutLabel(shortcuts.palette),run:()=>setPalette(true)},
    {id:'connections',label:'进入连接中心',kind:'command',run:()=>selectWorkspace('')},
    {id:'settings',label:'打开设置',kind:'command',shortcut:shortcutLabel(shortcuts.settings),run:()=>setSettings(true)},
    ...(current ? [
      {id:'files',label:'显示远端文件',kind:'command' as const,run:toggleFiles},
      {id:'monitor',label:'切换监控面板',kind:'command' as const,run:toggleMonitor},
      {id:'focus',label:'切换专注模式',kind:'command' as const,run:()=>setFocus(value=>!value)},
      {id:'closeTab',label:'关闭当前标签',kind:'command' as const,shortcut:shortcutLabel(shortcuts.closeTab),run:closeCurrent},
      {id:'closeWorkspace',label:'关闭工作区',kind:'command' as const,shortcut:shortcutLabel(shortcuts.closeWorkspace),run:()=>closeWorkspace()},
    ] : []),
    ...items.map(item=>({id:`workspace-${item.id}`,label:item.name,detail:`SSH · ${item.username}@${item.host}:${item.port}`,kind:'workspace' as const,run:()=>selectWorkspace(item.id)})),
    ...(['nextWorkspace','previousWorkspace'] as const).map(id=>({id,label:id==='nextWorkspace'?'下一个工作区':'上一个工作区',kind:'command' as const,run:()=>{const ids=['',...items.map(item=>item.id)];selectWorkspace(ids[(ids.indexOf(active)+(id==='nextWorkspace'?1:-1)+ids.length)%ids.length]);}})),
    ...(['uiZoomIn','uiZoomOut','uiZoomReset'] as const).filter(id=>id==='uiZoomIn'?appearance.uiZoom<2:id==='uiZoomOut'?appearance.uiZoom>1:appearance.uiZoom!==1).map(id=>({id,label:id==='uiZoomIn'?'放大界面':id==='uiZoomOut'?'缩小界面':'界面实际大小',kind:'command' as const,run:()=>update({...appearance,uiZoom:id==='uiZoomReset'?1:uiZoomLevels[uiZoomLevels.indexOf(appearance.uiZoom)+(id==='uiZoomIn'?1:-1)]})})),
  ];
  const dispatch = useRef<(id:string)=>boolean>(()=>false);
  dispatch.current = id => { if(root.current?.querySelector('[role=dialog]'))return false;const command=commands.find(command=>command.id===id);if(!command)return false;command.run();return true; };
  useEffect(()=>Events.On('app:menu-command',event=>dispatch.current(event.data as string)),[]);
  const menuState=JSON.stringify(palette?{}:Object.fromEntries(commands.map(command=>[command.id,command.shortcut==='未分配'?'':command.shortcut||''])));
  useEffect(()=>{if(System.IsMac())void Events.Emit('app:menu-state',JSON.parse(menuState) as Record<string,string>).catch(error=>setError(errorMessage(error)));},[menuState]);
  useEffect(()=>{
    const key=(event:KeyboardEvent)=>{
      if(event.isComposing||event.repeat||event.composedPath().some(target=>target instanceof HTMLElement&&target.matches('[role=dialog]')))return;
      const key=eventShortcut(event);if(!key)return;
      const definition=shortcutDefinitions.find(item=>shortcuts[item.id]===key);if(!definition)return;
      const inTerminal=(event.target as HTMLElement).closest('.xterm');
      if(definition.scope==='terminal'&&inTerminal){event.preventDefault();event.stopImmediatePropagation();terminal.current?.action(definition.id);}
      else if(dispatch.current(definition.id)){event.preventDefault();event.stopImmediatePropagation();}
    };
    window.addEventListener('keydown',key,true);return()=>window.removeEventListener('keydown',key,true);
  },[shortcuts]);
  const tabs=[...(terminalOpen?[{id:'terminal',label:'终端 1',terminal:true}]:[]),...files.map(path=>({id:path,label:path.slice(path.lastIndexOf('/')+1),terminal:false,dirty:dirty(path)}))];
  return <div ref={root} className="demo-workbench" onDragOverCapture={event=>{if(event.dataTransfer.types.includes('Files'))event.preventDefault();}} onDropCapture={event=>{if(event.dataTransfer.types.includes('Files')){event.preventDefault();event.stopPropagation();}}}>
    <Workbench settings={settings} tabs={<WorkspaceTabs items={items} active={active} onSelect={selectWorkspace} onClose={closeWorkspace} onNew={()=>setPalette(true)} disableNew onSearch={()=>setPalette(true)} onMove={moveWorkspace} onRename={(id,name)=>setItems(previous=>previous.map(item=>item.id===id?{...item,name}:item))} />} tools={<><Tooltip content="命令搜索"><button className="icon-button" aria-label="命令搜索" onClick={()=>setPalette(true)}><Icon name="search" /></button></Tooltip><Tooltip content="设置"><button className="icon-button" aria-label="设置" aria-pressed={settings} onClick={()=>setSettings(value=>!value)}><Icon name="settings" /></button></Tooltip></>} status={<><span>演示模式</span><button onClick={onExit}>退出</button><span>{items.length} 个工作区</span><div className="status-spacer" />{error&&<span className="error" role="alert">{error}</span>}</>}>
      {settings&&<section className="settings-view" aria-label="演示设置"><div className="settings-layout"><aside className="settings-sidebar"><div className="settings-header"><button className="icon-button" aria-label="返回工作区" onClick={()=>setSettings(false)}><Icon name="back" width="16" /></button><h1>设置</h1></div><nav className="settings-navigation" aria-label="设置分类">{(['appearance','terminal'] as const).map(id=><button key={id} className={settingsSection===id?'selected':''} onClick={()=>setSettingsSection(id)}>{id==='appearance'?'外观':'终端与编辑器'}</button>)}</nav></aside><div className="settings-content"><AppearanceSettings section={settingsSection} fontSize={fontSize} onFontSize={setFontSize} demo onDemo={onExit} /></div></div></section>}
      <div className="connection-center-page" hidden={settings||!!current}><ConnectionCenter active={!settings&&!current} connections={demoConnections} groups={demoGroups} preferences={demoPreferences} sessions={Object.fromEntries(items.map(item=>[item.id,['已连接']]))} demoLatency={demoLatency} onOpen={open} onEdit={()=>{}} onNew={()=>{}} onReload={()=>{}} onLocal={()=>{}} shells={[]} systemRDP={false} busy={false} loading={false} loadError="" /></div>
      <div className="ssh-workspace" hidden={!visible}>
        <div className="workspace-toolbar"><span className="session-target">{current&&`${current.username}@${current.host}:${current.port}`}</span>{current&&<span className={`connection-environment ${demoPreferences[current.id]?.environment}`}>{({production:'生产',staging:'预发布',development:'开发'} as Record<string,string>)[demoPreferences[current.id]?.environment]}</span>}<button className="session-tool" aria-pressed={filesShown} onClick={toggleFiles}><Icon name="files" width="15" />文件</button><button className="session-tool" aria-pressed={monitorShown} onClick={toggleMonitor}><Icon name="monitor" width="15" />监控</button><Dropdown><DropdownTrigger><button className="icon-button" aria-label="窗格布局"><Icon name="sidebar" width="16" /></button></DropdownTrigger><DropdownMenu aria-label="窗格操作" onAction={key=>{if(key==='split'){setFiles(previous=>previous.includes(initialFiles[0])?previous:[...previous,initialFiles[0]]);setSplit(true);setSelected(['terminal',initialFiles[0]]);}else{setSplit(false);setSelected([selected[activePane],'']);setActivePane(0);}}}><DropdownItem key="split">左右分屏</DropdownItem><DropdownItem key="merge">合并窗格</DropdownItem></DropdownMenu></Dropdown><button className="icon-button" aria-label="专注模式" aria-pressed={focus} onClick={()=>setFocus(value=>!value)}><Icon name="focus" width="16" /></button></div>
        <div className="ssh-panels">
          {narrow&&narrowPanel&&<button className="panel-scrim" aria-label="关闭辅助面板" onClick={()=>setNarrowPanel(null)} />}
          <div className="file-dock" hidden={!filesShown} style={{width:filesWidth}}><FileBrowser id="demo-files" connectionID="" visible={visible&&filesShown} initialDirectory="/srv/termquay/config" demoDirectories={demoDirectories} onOpen={openFile} onClose={()=>{if(narrow)setNarrowPanel(null);else setFilesOpen(false);}} /></div>
          {filesShown&&!narrow&&<ResizeHandle label="文件面板宽度" value={filesWidth} min={200} max={420} onChange={setFilesWidth} />}
          <div className="ssh-center">{!tabs.length&&<div className="workspace-empty"><Button size="sm" variant="light" onPress={()=>onScene(scene)}>恢复演示场景</Button></div>}<WorkspacePanes split={split} maximized={false} ratio={ratio} onRatio={setRatio}>
            {[0,1].map(pane=><PaneTabs key={pane} pane={pane} items={tabs.filter(tab=>paneFor(tab.id)===pane)} selected={selected[pane]} focused={activePane===pane} hidden={pane===1&&!split} column={pane===0?1:3} creating newShortcut={shortcutLabel(shortcuts.newTerminal)} closeShortcut={shortcutLabel(shortcuts.closeTab)} onSelect={activate} onClose={closeTab} onNew={()=>{}} />)}
            {terminalOpen&&<div className="terminal-tab" hidden={!shown('terminal')} style={{gridColumn:1,gridRow:2}} onFocusCapture={()=>setActivePane(0)}><TerminalView ref={terminal} id={`demo-terminal-${active}`} workspace="demo" demoOutput={current?demoTerminal.split('deploy@app-01').join(`${current.username}@${current.host.split('.')[0]}`):demoTerminal} visible={visible&&shown('terminal')} fontSize={fontSize} onSnippets={()=>{}} /></div>}
            {files.map(path=><div className="editor-tab" key={path} hidden={!shown(path)} style={{gridColumn:paneFor(path)===0?1:3,gridRow:2}} onFocusCapture={()=>setActivePane(paneFor(path))}><Suspense fallback={<div className="view-loading" role="status">正在载入编辑器…</div>}><CodeEditor demo path={path} content={documents[path].content} format={documents[path].format} visible={visible&&shown(path)} dirty={dirty(path)} saving={false} reloadEpoch={documents[path].epoch} onChange={(content,format)=>setDocuments(previous=>({...previous,[path]:{...previous[path],content,format}}))} onSave={()=>setDocuments(previous=>({...previous,[path]:{...previous[path],saved:previous[path].content,savedFormat:JSON.stringify(previous[path].format)}}))} onReload={()=>setDocuments(previous=>({...previous,[path]:{...previous[path],content:previous[path].saved,format:JSON.parse(previous[path].savedFormat) as EditorFormat,epoch:previous[path].epoch+1}}))} onDownload={()=>{}} /></Suspense></div>)}
          </WorkspacePanes></div>
          <MonitorPanel id="demo-monitor" visible={visible&&monitorShown} demoSamples={demoSamples} onClose={()=>{if(narrow)setNarrowPanel(null);else setMonitorOpen(false);}} />
        </div>
      </div>
    </Workbench>
    {palette&&<CommandPalette commands={commands} onClose={()=>setPalette(false)} />}
  </div>;
}
