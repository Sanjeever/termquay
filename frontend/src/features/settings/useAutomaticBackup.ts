import { errorMessage } from "../../lib/errors";
import { useEffect, useRef, useState } from 'react';
import { GetAutomaticBackupStatus } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { AutomaticBackupStatus } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';

export default function useAutomaticBackup(ready: boolean) {
  const [status, setStatus] = useState<AutomaticBackupStatus>();
  const [error, setError] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const mounted = useRef(false);
  async function refresh() {
    clearTimeout(timer.current);
    try { const value = await GetAutomaticBackupStatus(); if (!mounted.current) return; setStatus(value); setError(''); if (value.enabled || value.running) timer.current = setTimeout(() => void refresh(), 5000); }
    catch (e) { if (mounted.current) setError(errorMessage(e)); }
  }
  useEffect(() => { mounted.current = true; if (ready) void refresh(); return () => { mounted.current = false; clearTimeout(timer.current); }; }, [ready]);
  return { status, error, refresh };
}
