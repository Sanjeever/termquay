import { useSyncExternalStore } from 'react';
import { Events } from '@wailsio/runtime';
import { GetAISettings } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { AISettings } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import { errorMessage } from '../../lib/errors';

let snapshot: { settings?: AISettings; locked: boolean; revision: number; error: string } = {
  locked: false,
  revision: 0,
  error: '',
};
const listeners = new Set<() => void>();
let off: (() => void)[] = [];
let request: ReturnType<typeof GetAISettings> | undefined;

function publish(next: typeof snapshot) {
  snapshot = next;
  for (const listener of listeners) listener();
}
function refresh() {
  if (request) return;
  const pending = GetAISettings();
  request = pending;
  const revision = snapshot.revision;
  pending
    .then((settings) => {
      if (snapshot.revision === revision)
        publish({ settings, locked: false, revision: snapshot.revision + 1, error: '' });
    })
    .catch((error) => publish({ ...snapshot, error: errorMessage(error) }))
    .finally(() => {
      if (request === pending) request = undefined;
    });
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    off = [
      Events.On('ai:settings-changed', (event) =>
        publish({ ...snapshot, settings: event.data, revision: snapshot.revision + 1, error: '' }),
      ),
      Events.On('app:lock-changed', (event) => {
        publish({ ...snapshot, locked: event.data.locked });
        if (!event.data.locked) refresh();
      }),
    ];
    refresh();
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      for (const dispose of off) dispose();
      off = [];
    }
  };
}
export default function useAISettings() {
  return useSyncExternalStore(subscribe, () => snapshot);
}
