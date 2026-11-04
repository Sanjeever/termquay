import { errorMessage } from "../../lib/errors";
import { useEffect, useRef, useState } from 'react';

export default function useSSHReconnect(session: string, state: string, busy: boolean, reconnect: () => Promise<{ ok: boolean; retryable: boolean }>) {
  const [enabled, setEnabled] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [status, setStatus] = useState('');
  const latest = useRef({ enabled, state, busy, reconnect }); latest.current = { enabled, state, busy, reconnect };
  const running = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setAttempts(0); setStatus(''); }, [session]);
  useEffect(() => {
    if (state === '已连接') { setAttempts(0); setStatus(''); return; }
    if (!enabled || state !== '已断开' || busy || attempts >= 3 || running.current) return;
    const delay = [2, 5, 15][attempts];
    setStatus(`${delay} 秒后重连 · ${attempts + 1}/3`);
    const timer = setTimeout(async () => {
      if (!latest.current.enabled || latest.current.busy || latest.current.state !== '已断开') return;
      running.current = true; setStatus(`正在重连 · ${attempts + 1}/3`);
      try {
        const result = await latest.current.reconnect();
        if (!mounted.current || !latest.current.enabled) return;
        if (!result.ok) { setAttempts(result.retryable ? attempts + 1 : 3); setStatus(result.retryable && attempts < 2 ? '等待重试' : '自动重连已停止，请手动连接'); }
      } catch (e) { if (mounted.current) { setAttempts(3); setStatus(errorMessage(e)); } }
      finally { running.current = false; }
    }, delay * 1000);
    return () => clearTimeout(timer);
  }, [enabled, state, busy, attempts, session]);
  return { enabled, status, toggle() { setEnabled(value => !value); setAttempts(0); setStatus(''); } };
}
