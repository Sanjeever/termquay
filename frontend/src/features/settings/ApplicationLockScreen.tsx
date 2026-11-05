import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@heroui/react';
import { UnlockApplication } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { ApplicationLockStatus } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import { errorMessage } from '../../lib/errors';

export default function ApplicationLockScreen({ onUnlock }: { onUnlock(status: ApplicationLockStatus): void }) {
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useLayoutEffect(() => {
    const previous = new Map<HTMLElement, boolean>();
    const hide = () => { for (const child of document.body.children) { if (child instanceof HTMLElement && child !== root.current && !previous.has(child)) { previous.set(child, child.inert); child.inert = true; } } };
    hide(); input.current?.focus();
    const observer = new MutationObserver(hide); observer.observe(document.body, { childList: true });
    const key = (event: KeyboardEvent) => { if (!root.current?.contains(event.target as Node)) { event.preventDefault(); event.stopImmediatePropagation(); input.current?.focus(); } };
    window.addEventListener('keydown', key, true);
    return () => { observer.disconnect(); window.removeEventListener('keydown', key, true); previous.forEach((inert, element) => { element.inert = inert; }); };
  }, []);
  async function unlock() {
    if (busy) return; setBusy(true); setError(''); const value = password; setPassword('');
    try { onUnlock(await UnlockApplication(value)); }
    catch (e) { setError(errorMessage(e)); requestAnimationFrame(() => input.current?.focus()); }
    finally { setBusy(false); }
  }
  return createPortal(<div className="application-lock" ref={root} role="dialog" aria-modal="true" aria-labelledby="application-lock-title"><form onSubmit={event => { event.preventDefault(); void unlock(); }}><h1 id="application-lock-title">TermQuay 已锁定</h1><label className="form-field">主密码<input ref={input} type="password" autoComplete="current-password" value={password} maxLength={1024} disabled={busy} onChange={event => setPassword(event.target.value)} /></label>{error && <p className="error" role="alert">{error}</p>}<Button type="submit" color="primary" isDisabled={!password} isLoading={busy}>解锁</Button></form></div>, document.body);
}
