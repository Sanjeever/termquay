import { useMessageState } from '../../i18n/useMessageState.ts';

import { useEffect, useRef, useState } from 'react';
import { Events } from '@wailsio/runtime';
import {
  CancelUpdate,
  CheckUpdate,
  DownloadUpdate,
  GetUpdateStatus,
  SetUpdateCheck,
  StartUpdates,
} from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { UpdateStatus } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';

export default function useUpdates(ready: boolean) {
  const [status, setStatus] = useState<UpdateStatus>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useMessageState('');
  const mounted = useRef(false);
  const running = useRef(false);
  useEffect(() => {
    if (!ready) return;
    let ended = false;
    mounted.current = true;
    const off = Events.On('update:changed', (event) => setStatus(event.data as UpdateStatus));
    async function initialise() {
      try {
        await StartUpdates();
        const status = await GetUpdateStatus();
        if (!ended) {
          setStatus(status);
          setError('');
        }
      } catch (error) {
        if (!ended) setError(error);
      }
    }
    void initialise();
    return () => {
      ended = true;
      mounted.current = false;
      off();
    };
  }, [ready, setError]);
  async function run(action: () => Promise<unknown>) {
    if (running.current) return;
    running.current = true;
    setPending(true);
    setError('');
    try {
      await action();
    } catch (error) {
      if (mounted.current) setError(error);
    } finally {
      try {
        const status = await GetUpdateStatus();
        if (mounted.current) setStatus(status);
      } catch (error) {
        if (mounted.current) setError(error);
      }
      running.current = false;
      if (mounted.current) setPending(false);
    }
  }
  return {
    status,
    error,
    pending,
    check: () => run(CheckUpdate),
    download: () => run(DownloadUpdate),
    cancel: () => CancelUpdate().catch((error) => setError(error)),
    setEnabled: (enabled: boolean) => run(() => SetUpdateCheck(enabled)),
  };
}
