import { errorMessage } from "../../lib/errors";
import { useEffect, useRef, useState } from 'react';
import { GetAutomaticBackupStatus } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { AutomaticBackupStatus } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';

export default function useAutomaticBackup(ready: boolean) {
  const [status, setStatus] = useState<AutomaticBackupStatus>();
  const [error, setError] = useState('');
  const [loadFailure, setLoadFailure] = useState(0);
  const [dismissed, setDismissed] = useState('');
  const generation = useRef(0);
  const loadErrorActive = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const mounted = useRef(false);
  async function refresh(retry = false) {
    if (retry) loadErrorActive.current = false;
    const request = ++generation.current;
    clearTimeout(timer.current);
    try { const value = await GetAutomaticBackupStatus(); if (!mounted.current || request !== generation.current) return; setStatus(value); setError(''); loadErrorActive.current=false; if (value.enabled || value.running) timer.current = setTimeout(() => void refresh(), 5000); }
    catch (e) { if (mounted.current && request === generation.current) {setError(errorMessage(e));if(!loadErrorActive.current){loadErrorActive.current=true;setLoadFailure(value=>value+1);}} }
  }
  useEffect(() => { mounted.current = true; if (ready) void refresh(); return () => { mounted.current = false; clearTimeout(timer.current); }; }, [ready]);
  const failure = error ? `load:${loadFailure}` : status?.error ? `backup:${status.failure_id}:${status.error}` : '';
  return { status, error, refresh, bannerVisible:!!failure && failure!==dismissed, dismiss:()=>setDismissed(failure) };
}
