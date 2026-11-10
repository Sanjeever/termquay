import { useMessageState } from '../../i18n/useMessageState.ts';
import { useEffect, useState } from 'react';
import { Events } from '@wailsio/runtime';
import { ListCommandRuns } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { CommandRunSummary } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';

export default function useCommandRuns(enabled: boolean) {
  const [items, setItems] = useState<CommandRunSummary[]>([]);
  const [error, setError] = useMessageState('');
  const [revision, setRevision] = useState(0);
  function update(value: CommandRunSummary) {
    setItems((previous) => {
      const current = previous.find((item) => item.id === value.id);
      if (current && current.revision > value.revision) return previous;
      return [...previous.filter((item) => item.id !== value.id), value].sort(
        (a, b) => b.started_at - a.started_at,
      );
    });
  }
  useEffect(() => {
    if (!enabled) return;
    let ended = false;
    const removed = new Set<string>();
    const off = [
      Events.On('command-run:changed', (event) => update(event.data as CommandRunSummary)),
      Events.On('command-run:removed', (event) => {
        const id = event.data as string;
        removed.add(id);
        setItems((previous) => previous.filter((item) => item.id !== id));
      }),
    ];
    const request = ListCommandRuns();
    request
      .then((values) => {
        if (ended) return;
        setItems((previous) => {
          const merged = new Map(
            (values || []).filter((item) => !removed.has(item.id)).map((item) => [item.id, item]),
          );
          previous.forEach((item) => {
            if (
              !removed.has(item.id) &&
              (!merged.has(item.id) || merged.get(item.id)!.revision < item.revision)
            )
              merged.set(item.id, item);
          });
          return [...merged.values()].sort((a, b) => b.started_at - a.started_at);
        });
        setError('');
      })
      .catch((e) => {
        if (!ended) setError(e);
      });
    return () => {
      ended = true;
      request.cancel();
      off.forEach((dispose) => dispose());
    };
  }, [enabled, revision]);
  return {
    items,
    error,
    update,
    refresh: () => setRevision((value) => value + 1),
    active: items.filter((item) => !item.finished_at).length,
    waiting: items.filter((item) => item.state_code === 'awaiting_confirmation').length,
  };
}
