import { useEffect, useMemo, useRef, useState } from 'react';
import { Events, Window } from '@wailsio/runtime';
import { MeasureConnectionLatency } from '../../../bindings/github.com/Sanjeever/termquay/appservice';
import type { ConnectionLatency } from '../../../bindings/github.com/Sanjeever/termquay/models';
import type { Connection } from '../../../bindings/github.com/Sanjeever/termquay/internal/store/models';

type Measurement = { key: string; result?: ConnectionLatency; checkedAt?: number; refreshing: boolean };
type Probe = { operation: ReturnType<typeof MeasureConnectionLatency>; cancelled: boolean };

export default function useConnectionLatency(connections: Connection[], active: boolean) {
  const [measurements, setMeasurements] = useState<Record<string, Measurement | undefined>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const targets = useMemo(() => {
    const byID = new Map(connections.map(connection => [connection.id, connection]));
    return new Map(connections.map(connection => {
      const route = [];
      let hop: Connection | undefined = connection;
      for (let index = 0; hop && index < 5; index++) {
        route.push([hop.id, hop.host, hop.port, hop.username, hop.jump_id, hop.proxy_address]);
        hop = byID.get(hop.jump_id || '');
      }
      return [connection.id, JSON.stringify(route)];
    }));
  }, [connections]);
  const version = useMemo(() => JSON.stringify([...targets]), [targets]);
  const latestTargets = useRef(targets); latestTargets.current = targets;
  const running = useRef(new Map<string, Probe>());
  const dispatch = useRef<(id?: string) => void>(() => {});
  const resume = useRef(() => {});

  useEffect(() => {
    const targets = latestTargets.current;
    let pending = new Map<string, string>();
    let disposed = false;
    let minimised = false;
    let ready = false;
    let enabled = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    setMeasurements(previous => Object.fromEntries(Object.entries(previous).filter(([id, value]) => value?.key === targets.get(id)).map(([id, value]) => [id, { ...value!, refreshing: false }])));

    function pump() {
      if (!enabled || disposed) return;
      while (running.current.size < 8 && pending.size) {
        let next: [string, string] | undefined;
        for (const entry of pending) { if (!running.current.has(entry[0])) { next = entry; break; } }
        if (!next) break;
        const [id, key] = next;
        pending.delete(id);
        setMeasurements(previous => ({ ...previous, [id]: { ...(previous[id]?.key === key ? previous[id] : undefined), key, refreshing: true } }));
        const probe: Probe = { operation: MeasureConnectionLatency(id), cancelled: false };
        running.current.set(id, probe);
        probe.operation.then(result => {
          if (!disposed && !probe.cancelled) setMeasurements(previous => ({ ...previous, [id]: { key, result, checkedAt: Date.now(), refreshing: false } }));
        }).catch(error => {
          if (!disposed && !probe.cancelled) setMeasurements(previous => ({ ...previous, [id]: { key, result: { status: 'error', milliseconds: 0, error: String(error) }, checkedAt: Date.now(), refreshing: false } }));
        }).finally(() => {
          running.current.delete(id);
          resume.current();
        });
      }
      setRefreshing(pending.size > 0 || [...running.current.values()].some(probe => !probe.cancelled));
    }
    function refresh(id?: string) {
      if (!enabled || disposed) return;
      if (id) {
        const key = targets.get(id);
        if (running.current.has(id) && !running.current.get(id)!.cancelled) return;
        if (key) { pending.delete(id); pending = new Map([[id, key], ...pending]); }
      } else {
        for (const [id, key] of targets) {
          if (!running.current.has(id) || running.current.get(id)!.cancelled) pending.set(id, key);
        }
      }
      pump();
    }
    function pause() {
      enabled = false;
      clearInterval(timer);
      pending.clear();
      for (const probe of running.current.values()) { probe.cancelled = true; probe.operation.cancel(); }
      if (!disposed) {
        setRefreshing(false);
        setMeasurements(previous => Object.fromEntries(Object.entries(previous).map(([id, value]) => [id, value && { ...value, refreshing: false }])));
      }
    }
    function sync() {
      const next = active && ready && !minimised && document.visibilityState === 'visible';
      if (!next) { pause(); return; }
      if (!enabled) { enabled = true; refresh(); timer = setInterval(() => refresh(), 5000); }
    }
    dispatch.current = refresh;
    resume.current = pump;
    const off = [
      Events.On(Events.Types.Common.WindowMinimise, () => { minimised = true; ready = true; sync(); }),
      Events.On(Events.Types.Common.WindowUnMinimise, () => { minimised = false; ready = true; sync(); }),
      Events.On(Events.Types.Common.WindowRestore, () => { minimised = false; ready = true; sync(); }),
    ];
    document.addEventListener('visibilitychange', sync);
    Window.IsMinimised().then(value => {
      if (!disposed) { if (!ready) minimised = value; ready = true; setError(''); sync(); }
    }).catch(error => { if (!disposed) setError(`读取窗口状态失败：${String(error)}`); });
    return () => {
      disposed = true;
      pause();
      off.forEach(unsubscribe => unsubscribe());
      document.removeEventListener('visibilitychange', sync);
      dispatch.current = () => {};
      resume.current = () => {};
    };
  }, [active, version]);

  return { measurements, refreshing, error, refresh: (id?: string) => dispatch.current(id) };
}
