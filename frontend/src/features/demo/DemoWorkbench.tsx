import { t as translate } from '../../i18n/index.ts';
import { message as uiMessage } from '../../i18n/messages.ts';
import { useMessageState } from '../../i18n/useMessageState.ts';
import { useTranslation } from 'react-i18next';

import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Button, DropdownItem, DropdownMenu, DropdownTrigger } from '@heroui/react';
import { Dropdown } from '../../components/Popover';
import Tooltip from '../../components/Tooltip';
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
  useTranslation();
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
  const [error, setError] = useMessageState('');
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
  async function openFile(entry: Entry) { if(!documents[entry.path])throw uiMessage('demo:noDemoContentForThisFile');setFiles(previous=>previous.includes(entry.path)?previous:[...previous,entry.path]);activate(entry.path); }
  function toggleFiles() { setFocus(false);setFilesOpen(true);if(narrow)setNarrowPanel(previous=>previous==='files'?null:'files');else setFilesOpen(!filesOpen); }
  function toggleMonitor() { setFocus(false);setMonitorOpen(true);if(narrow)setNarrowPanel(previous=>previous==='monitor'?null:'monitor');else setMonitorOpen(!monitorOpen); }
  function moveWorkspace(id: string, target: string) { setItems(previous=>{const next=[...previous];const source=next.findIndex(item=>item.id===id);const destination=next.findIndex(item=>item.id===target);next.splice(destination,0,...next.splice(source,1));return next;}); }
  const commands: WorkbenchCommand[] = [
    ...demoScenes.map(item=>({id:`demo-${item.id}`,label:item.label,search:translate('demo:demoMode'),kind:'command' as const,run:()=>onScene(item.id)})),
    {id:'exit-demo',label:translate('demo:exitDemoMode'),kind:'command',run:onExit},
    {id:'palette',label:translate('demo:commandSearch'),kind:'command',shortcut:shortcutLabel(shortcuts.palette),run:()=>setPalette(true)},
    {id:'connections',label:translate('demo:openConnectionCenter'),kind:'command',run:()=>selectWorkspace('')},
    {id:'settings',label:translate('demo:openSettings'),kind:'command',shortcut:shortcutLabel(shortcuts.settings),run:()=>setSettings(true)},
    ...(current ? [
      {id:'files',label:translate('demo:showRemoteFiles'),kind:'command' as const,run:toggleFiles},
      {id:'monitor',label:translate('demo:toggleMonitoringPanel'),kind:'command' as const,run:toggleMonitor},
      {id:'focus',label:translate('demo:toggleFocusMode'),kind:'command' as const,run:()=>setFocus(value=>!value)},
      {id:'closeTab',label:translate('demo:closeCurrentTab'),kind:'command' as const,shortcut:shortcutLabel(shortcuts.closeTab),run:closeCurrent},
      {id:'closeWorkspace',label:translate('demo:closeWorkspace'),kind:'command' as const,shortcut:shortcutLabel(shortcuts.closeWorkspace),run:()=>closeWorkspace()},
    ] : []),
    ...items.map(item=>({id:`workspace-${item.id}`,label:item.name,detail:`SSH · ${item.username}@${item.host}:${item.port}`,kind:'workspace' as const,run:()=>selectWorkspace(item.id)})),
    ...(['nextWorkspace','previousWorkspace'] as const).map(id=>({id,label:id==='nextWorkspace'?translate('demo:nextWorkspace'):translate('demo:previousWorkspace'),kind:'command' as const,run:()=>{const ids=['',...items.map(item=>item.id)];selectWorkspace(ids[(ids.indexOf(active)+(id==='nextWorkspace'?1:-1)+ids.length)%ids.length]);}})),
    ...(['uiZoomIn','uiZoomOut','uiZoomReset'] as const).filter(id=>id==='uiZoomIn'?appearance.uiZoom<2:id==='uiZoomOut'?appearance.uiZoom>1:appearance.uiZoom!==1).map(id=>({id,label:id==='uiZoomIn'?translate('demo:zoomInInterface'):id==='uiZoomOut'?translate('demo:zoomOutInterface'):translate('demo:actualInterfaceSize'),kind:'command' as const,run:()=>update({...appearance,uiZoom:id==='uiZoomReset'?1:uiZoomLevels[uiZoomLevels.indexOf(appearance.uiZoom)+(id==='uiZoomIn'?1:-1)]})})),
  ];
  const dispatch = useRef<(id:string)=>boolean>(()=>false);
  dispatch.current = id => { if(root.current?.querySelector('[role=dialog]'))return false;const command=commands.find(command=>command.id===id);if(!command)return false;command.run();return true; };
  useEffect(()=>Events.On('app:menu-command',event=>dispatch.current(event.data as string)),[]);
  const menuState=JSON.stringify(palette?{}:Object.fromEntries(commands.map(command=>[command.id,command.shortcut===translate('demo:unassigned')?'':command.shortcut||''])));
  useEffect(()=>{if(System.IsMac())void Events.Emit('app:menu-state',JSON.parse(menuState) as Record<string,string>).catch(error=>setError(error));},[menuState]);
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
  const tabs=[...(terminalOpen?[{id:'terminal',label:translate('demo:terminal1'),terminal:true}]:[]),...files.map(path=>({id:path,label:path.slice(path.lastIndexOf('/')+1),terminal:false,dirty:dirty(path)}))];
  return <div ref={root} className="demo-workbench" onDragOverCapture={event=>{if(event.dataTransfer.types.includes('Files'))event.preventDefault();}} onDropCapture={event=>{if(event.dataTransfer.types.includes('Files')){event.preventDefault();event.stopPropagation();}}}>
    <Workbench settings={settings} tabs={<WorkspaceTabs items={items} active={active} onSelect={selectWorkspace} onClose={closeWorkspace} onNew={()=>setPalette(true)} disableNew onSearch={()=>setPalette(true)} onMove={moveWorkspace} onRename={(id,name)=>setItems(previous=>previous.map(item=>item.id===id?{...item,name}:item))} />} tools={<><Tooltip content={translate('demo:commandSearch')}><button className="icon-button" aria-label={translate('demo:commandSearch')} onClick={()=>setPalette(true)}><Icon name="search" /></button></Tooltip><Tooltip content={translate('demo:settings')}><button className="icon-button" aria-label={translate('demo:settings')} aria-pressed={settings} onClick={()=>setSettings(value=>!value)}><Icon name="settings" /></button></Tooltip></>} status={<><span>{translate('demo:demoMode')}</span><button onClick={onExit}>{translate('demo:exit')}</button><span>{items.length} {translate('demo:workspaces')}</span><div className="status-spacer" />{error&&<span className="error" role="alert">{error}</span>}</>}>
      {settings&&<section className="settings-view" aria-label={translate('demo:demoSettings')}><div className="settings-layout"><aside className="settings-sidebar"><div className="settings-header"><button className="icon-button" aria-label={translate('demo:backToWorkspace')} onClick={()=>setSettings(false)}><Icon name="back" width="16" /></button><h1>{translate('demo:settings')}</h1></div><nav className="settings-navigation" aria-label={translate('demo:settingsCategories')}>{(['appearance','terminal'] as const).map(id=><button key={id} className={settingsSection===id?'selected':''} onClick={()=>setSettingsSection(id)}>{id==='appearance'?translate('demo:appearance'):translate('demo:terminalAndEditor')}</button>)}</nav></aside><div className="settings-content"><AppearanceSettings section={settingsSection} fontSize={fontSize} onFontSize={setFontSize} demo onDemo={onExit} /></div></div></section>}
      <div className="connection-center-page" hidden={settings||!!current}><ConnectionCenter active={!settings&&!current} connections={demoConnections} groups={demoGroups} preferences={demoPreferences} sessions={Object.fromEntries(items.map(item=>[item.id,[translate('demo:connected')]]))} demoLatency={demoLatency} onOpen={open} onEdit={()=>{}} onNew={()=>{}} onReload={()=>{}} onLocal={()=>{}} shells={[]} systemRDP={false} busy={false} loading={false} loadError="" /></div>
      <div className="ssh-workspace" hidden={!visible}>
        <div className="workspace-toolbar"><span className="session-target">{current&&`${current.username}@${current.host}:${current.port}`}</span>{current&&<span className={`connection-environment ${demoPreferences[current.id]?.environment}`}>{({production:translate('demo:production'),staging:translate('demo:staging'),development:translate('demo:development')} as Record<string,string>)[demoPreferences[current.id]?.environment]}</span>}<button className="session-tool" aria-pressed={filesShown} onClick={toggleFiles}><Icon name="files" width="15" />{translate('demo:files')}</button><button className="session-tool" aria-pressed={monitorShown} onClick={toggleMonitor}><Icon name="monitor" width="15" />{translate('demo:monitoring')}</button><Dropdown><DropdownTrigger><button className="icon-button" aria-label={translate('demo:paneLayout')}><Icon name="sidebar" width="16" /></button></DropdownTrigger><DropdownMenu aria-label={translate('demo:paneActions')} onAction={key=>{if(key==='split'){setFiles(previous=>previous.includes(initialFiles[0])?previous:[...previous,initialFiles[0]]);setSplit(true);setSelected(['terminal',initialFiles[0]]);}else{setSplit(false);setSelected([selected[activePane],'']);setActivePane(0);}}}><DropdownItem key="split">{translate('demo:splitHorizontally')}</DropdownItem><DropdownItem key="merge">{translate('demo:mergePanes')}</DropdownItem></DropdownMenu></Dropdown><button className="icon-button" aria-label={translate('demo:focusMode')} aria-pressed={focus} onClick={()=>setFocus(value=>!value)}><Icon name="focus" width="16" /></button></div>
        <div className="ssh-panels">
          {narrow&&narrowPanel&&<button className="panel-scrim" aria-label={translate('demo:closeAuxiliaryPanel')} onClick={()=>setNarrowPanel(null)} />}
          <div className="file-dock" hidden={!filesShown} style={{width:filesWidth}}><FileBrowser id="demo-files" connectionID="" visible={visible&&filesShown} initialDirectory="/srv/termquay/config" demoDirectories={demoDirectories} onOpen={openFile} onClose={()=>{if(narrow)setNarrowPanel(null);else setFilesOpen(false);}} /></div>
          {filesShown&&!narrow&&<ResizeHandle label={translate('demo:filePanelWidth')} value={filesWidth} min={200} max={420} onChange={setFilesWidth} />}
          <div className="ssh-center">{!tabs.length&&<div className="workspace-empty"><Button size="sm" variant="light" onPress={()=>onScene(scene)}>{translate('demo:restoreDemoScene')}</Button></div>}<WorkspacePanes split={split} maximized={false} ratio={ratio} onRatio={setRatio}>
            {[0,1].map(pane=><PaneTabs key={pane} pane={pane} items={tabs.filter(tab=>paneFor(tab.id)===pane)} selected={selected[pane]} focused={activePane===pane} hidden={pane===1&&!split} column={pane===0?1:3} creating newShortcut={shortcutLabel(shortcuts.newTerminal)} closeShortcut={shortcutLabel(shortcuts.closeTab)} onSelect={activate} onClose={closeTab} onNew={()=>{}} />)}
            {terminalOpen&&<div className="terminal-tab" hidden={!shown('terminal')} style={{gridColumn:1,gridRow:2}} onFocusCapture={()=>setActivePane(0)}><TerminalView ref={terminal} id={`demo-terminal-${active}`} workspace="demo" demoOutput={current?demoTerminal.split('deploy@app-01').join(`${current.username}@${current.host.split('.')[0]}`):demoTerminal} visible={visible&&shown('terminal')} fontSize={fontSize} onSnippets={()=>{}} /></div>}
            {files.map(path=><div className="editor-tab" key={path} hidden={!shown(path)} style={{gridColumn:paneFor(path)===0?1:3,gridRow:2}} onFocusCapture={()=>setActivePane(paneFor(path))}><Suspense fallback={<div className="view-loading" role="status">{translate('demo:loadingEditor')}</div>}><CodeEditor demo path={path} content={documents[path].content} format={documents[path].format} visible={visible&&shown(path)} dirty={dirty(path)} saving={false} reloadEpoch={documents[path].epoch} onChange={(content,format)=>setDocuments(previous=>({...previous,[path]:{...previous[path],content,format}}))} onSave={()=>setDocuments(previous=>({...previous,[path]:{...previous[path],saved:previous[path].content,savedFormat:JSON.stringify(previous[path].format)}}))} onReload={()=>setDocuments(previous=>({...previous,[path]:{...previous[path],content:previous[path].saved,format:JSON.parse(previous[path].savedFormat) as EditorFormat,epoch:previous[path].epoch+1}}))} onDownload={()=>{}} /></Suspense></div>)}
          </WorkspacePanes></div>
          <MonitorPanel id="demo-monitor" visible={visible&&monitorShown} demoSamples={demoSamples} onClose={()=>{if(narrow)setNarrowPanel(null);else setMonitorOpen(false);}} />
        </div>
      </div>
    </Workbench>
    {palette&&<CommandPalette commands={commands} onClose={()=>setPalette(false)} />}
  </div>;
}
