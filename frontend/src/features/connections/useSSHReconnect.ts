import { useMessageState } from '../../i18n/useMessageState.ts';
import { message as uiMessage } from '../../i18n/messages.ts';

import { useEffect, useRef, useState } from 'react';

export default function useSSHReconnect(
  session: string,
  state: string,
  busy: boolean,
  reconnect: () => Promise<{ ok: boolean; retryable: boolean }>,
  eligible: boolean,
) {
  const [selected, setSelected] = useState<boolean>();
  const enabled = eligible && (selected ?? true);
  const [attempts, setAttempts] = useState(0);
  const [status, setStatus] = useMessageState('');
  const latest = useRef({ enabled, state, busy, reconnect });
  latest.current = { enabled, state, busy, reconnect };
  const running = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    setAttempts(0);
    setStatus('');
  }, [session]);
  useEffect(() => {
    if (!enabled || state === 'connected') {
      setAttempts(0);
      setStatus('');
      return;
    }
    if (!enabled || state !== 'disconnected' || busy || attempts >= 3 || running.current) return;
    const delay = [2, 5, 15][attempts];
    setStatus(
      uiMessage('connections:reconnectingInSeconds3', { value1: delay, value2: attempts + 1 }),
    );
    const timer = setTimeout(async () => {
      if (!latest.current.enabled || latest.current.busy || latest.current.state !== 'disconnected')
        return;
      running.current = true;
      setStatus(uiMessage('connections:reconnecting3', { value1: attempts + 1 }));
      try {
        const result = await latest.current.reconnect();
        if (!mounted.current || !latest.current.enabled) return;
        if (!result.ok) {
          setAttempts(result.retryable ? attempts + 1 : 3);
          setStatus(
            result.retryable && attempts < 2
              ? uiMessage('connections:waitingToRetry')
              : uiMessage('connections:automaticReconnectStoppedConnectManually'),
          );
        }
      } catch (e) {
        if (mounted.current) {
          setAttempts(3);
          setStatus(e);
        }
      } finally {
        running.current = false;
      }
    }, delay * 1000);
    return () => clearTimeout(timer);
  }, [enabled, state, busy, attempts, session]);
  return {
    enabled,
    status,
    toggle() {
      setSelected((value) => !(value ?? true));
      setAttempts(0);
      setStatus('');
    },
  };
}
