import { t as translate } from '../../i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { useEffect, useRef, useState } from 'react';
import type { SearchAddon } from '@xterm/addon-search';
import { useAppearance } from '../settings/AppearanceProvider';
import { terminalTheme } from '../settings/appearance';

export const searchHighlightLimit = 1000;

export default function TerminalSearch({ addon, onClose }: { addon: SearchAddon; onClose(): void }) {
  useTranslation();
  const [query, setQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [found, setFound] = useState(true);
  const [regex,setRegex]=useState(false);
  const [invalid,setInvalid]=useState('');
  const [results,setResults]=useState({resultIndex:-1,resultCount:0});
  const {appearance,dark}=useAppearance();
  const colors=terminalTheme(appearance.terminalPalette,dark);
  const input = useRef<HTMLInputElement>(null);
  function find(previous = false, incremental = false) {
    if(!query){addon.clearDecorations();setResults({resultIndex:-1,resultCount:0});setInvalid('');setFound(true);return;}
    try { if(regex)new RegExp(query);setInvalid(''); }
    catch { addon.clearDecorations();setInvalid(translate('terminal:invalidRegularExpression'));return; }
    const options={caseSensitive,regex,incremental,decorations:{matchBackground:colors.selectionBackground,matchOverviewRuler:colors.blue,activeMatchBorder:colors.yellow,activeMatchColorOverviewRuler:colors.yellow}};
    setFound(previous ? addon.findPrevious(query, options) : addon.findNext(query, options));
  }
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(()=>{const subscription=addon.onDidChangeResults(setResults);return()=>subscription.dispose();},[addon]);
  useEffect(() => { find(false,true); }, [query, caseSensitive, regex, addon, appearance.terminalPalette, dark]);
  return <div className="terminal-search" role="search" aria-label={translate('terminal:findInTerminal')} onKeyDown={e => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); find(e.shiftKey); }
  }}>
    <input ref={input} aria-label={translate('terminal:searchTerminalBuffer')} value={query} onChange={e => setQuery(e.target.value)} />
    <label><input type="checkbox" checked={caseSensitive} onChange={e => setCaseSensitive(e.target.checked)} />{translate('terminal:matchCase')}</label>
    <label><input type="checkbox" checked={regex} onChange={e=>setRegex(e.target.checked)} />{translate('terminal:regex')}</label>
    <button aria-label={translate('terminal:previousMatch')} disabled={!query||!!invalid} onClick={() => find(true)}>↑</button><button aria-label={translate('terminal:nextMatch')} disabled={!query||!!invalid} onClick={() => find()}>↓</button>
    <span role="status" className={invalid?'error':''}>{invalid||(!query?'':!found?translate('terminal:noMatches'):`${results.resultIndex<0?'—':results.resultIndex+1} / ${results.resultCount>=searchHighlightLimit?'≥':''}${results.resultCount}`)}</span><button aria-label={translate('terminal:closeTerminalSearch')} onClick={onClose}>×</button>
  </div>;
}
