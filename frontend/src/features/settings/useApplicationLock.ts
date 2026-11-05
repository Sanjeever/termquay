import { useEffect, useRef, useState } from 'react';
import { Events } from '@wailsio/runtime';
import { GetApplicationLock, LockApplication, TouchApplication } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { ApplicationLockStatus } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import { errorMessage } from '../../lib/errors';

export default function useApplicationLock(ready: boolean) {
  const [status, setStatus] = useState<ApplicationLockStatus>();
  const [error, setError] = useState('');
  const locked = useRef(false);
  locked.current = !!status?.locked;
  useEffect(() => Events.On('app:lock-changed', event => { const value = event.data as ApplicationLockStatus; locked.current = value.locked; setStatus(value); setError(''); }), []);
  useEffect(() => {
    let ended = false;
    const refresh = () => { GetApplicationLock().then(value => { if (!ended) { locked.current = value.locked; setStatus(value); setError(''); if (value.available && !value.locked) void TouchApplication().catch(e => setError(errorMessage(e))); } }).catch(e => { if (!ended) setError(errorMessage(e)); }); };
    refresh(); window.addEventListener('termquay:storage-protection-changed', refresh);
    return () => { ended = true; window.removeEventListener('termquay:storage-protection-changed', refresh); };
  }, [ready]);
  useEffect(() => {
    if (!status?.available || status.locked || !status.idle_minutes) return;
    let last = 0;
    const touch = () => { const now = Date.now(); if (now - last < 1000) return; last = now; void TouchApplication().catch(e => setError(errorMessage(e))); };
    const events = ['pointerdown', 'pointermove', 'keydown', 'wheel'] as const;
    events.forEach(name => window.addEventListener(name, touch, { passive: true }));
    return () => events.forEach(name => window.removeEventListener(name, touch));
  }, [status?.available, status?.locked, status?.idle_minutes]);
  async function lock() { try { await LockApplication(); } catch (e) { setError(errorMessage(e)); } }
  return { status, locked, error, lock, update: setStatus };
}
