import { useEffect, useRef, useState } from 'react';
import type { SearchAddon } from '@xterm/addon-search';

export default function TerminalSearch({ addon, onClose }: { addon: SearchAddon; onClose(): void }) {
  const [query, setQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [found, setFound] = useState(true);
  const input = useRef<HTMLInputElement>(null);
  function find(previous = false) {
    setFound(!query || (previous ? addon.findPrevious(query, { caseSensitive }) : addon.findNext(query, { caseSensitive })));
  }
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => { setFound(!query || addon.findNext(query, { caseSensitive, incremental: true })); }, [query, caseSensitive, addon]);
  return <div className="terminal-search" role="search" aria-label="终端查找" onKeyDown={e => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); find(e.shiftKey); }
  }}>
    <input ref={input} aria-label="查找终端缓冲区" value={query} onChange={e => setQuery(e.target.value)} />
    <label><input type="checkbox" checked={caseSensitive} onChange={e => setCaseSensitive(e.target.checked)} />区分大小写</label>
    <button aria-label="上一个匹配" onClick={() => find(true)}>↑</button><button aria-label="下一个匹配" onClick={() => find()}>↓</button>
    <span role="status">{!found ? '无匹配' : ''}</span><button aria-label="关闭终端查找" onClick={onClose}>×</button>
  </div>;
}
