import type { Terminal } from '@xterm/xterm';

export type ProgramStatus = {
  state: 'idle' | 'working' | 'blocked' | 'done' | 'error' | 'clear';
  id: string;
  app?: string;
  kind?: 'permission' | 'question' | 'auth';
  message?: string;
  title?: string;
  progress?: number;
};

export const programStatusReply =
  '\x1b]7501;?:states=idle,working,done,blocked,error:kinds=permission,question,auth\x1b\\';

export function parseProgramStatus(data: string): ProgramStatus | undefined {
  if (new TextEncoder().encode(data).length > 4087) return;
  const fields = new Map<string, string>();
  for (const pair of data.split(':')) {
    const separator = pair.indexOf('=');
    if (separator < 1) continue;
    const key = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    if (key.length > 16) return;
    if (/^[a-z]+$/.test(key) && /^[A-Za-z0-9_.,+/=-]*$/.test(value)) fields.set(key, value);
  }
  const state = fields.get('state');
  if (!['idle', 'working', 'blocked', 'done', 'error', 'clear'].includes(state || '')) return;
  const id = fields.get('id') ?? '';
  if (
    id.length > 128 ||
    (id !== '' && !/^[A-Za-z0-9_.+-]{1,32}(\/[A-Za-z0-9_.+-]{1,32}){0,7}$/.test(id)) ||
    (fields.has('id') && id === '')
  )
    return;
  const result: ProgramStatus = { state: state as ProgramStatus['state'], id };
  for (const [key, field, limit] of [
    ['msg', 'message', 2048],
    ['title', 'title', 192],
  ] as const) {
    const encoded = fields.get(key);
    if (encoded === undefined) continue;
    if (encoded.length > Math.ceil(limit / 3) * 4) return;
    try {
      const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
      if (bytes.length > limit) return;
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      // oxlint-disable-next-line no-control-regex -- Protocol messages must not contain control characters.
      if (/[\x00-\x1f\x7f-\x9f]/.test(text)) return;
      result[field] = text.replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '');
    } catch {
      return;
    }
  }
  const app = fields.get('app');
  if (app && /^[A-Za-z0-9_.+-]{1,32}$/.test(app)) result.app = app;
  const kind = fields.get('kind');
  if (state === 'blocked' && ['permission', 'question', 'auth'].includes(kind || ''))
    result.kind = kind as ProgramStatus['kind'];
  const progress = fields.get('progress');
  if (
    (state === 'working' || state === 'blocked') &&
    progress !== undefined &&
    /^\d{1,3}$/.test(progress) &&
    Number(progress) <= 100
  )
    result.progress = Number(progress);
  return result;
}

export function addProgramStatus(term: Terminal, changed: (status?: ProgramStatus) => void) {
  const records = new Map<string, ProgramStatus>();
  let previous = '';
  const publish = () => {
    const priority = { blocked: 5, error: 4, working: 3, done: 2, idle: 1, clear: 0 };
    let current: ProgramStatus | undefined;
    for (const record of records.values()) {
      if (current && priority[current.state] > priority[record.state]) continue;
      current = record;
    }
    if (current && !current.app) {
      let parent = current.id;
      while (parent) {
        parent = parent.includes('/') ? parent.slice(0, parent.lastIndexOf('/')) : '';
        const app = records.get(parent)?.app;
        if (app) {
          current = { ...current, app };
          break;
        }
      }
    }
    const signature = JSON.stringify(current) ?? '';
    if (signature !== previous) {
      previous = signature;
      changed(current);
    }
  };
  const exited = () => {
    for (const [id, record] of records)
      if (record.state === 'working' || record.state === 'blocked' || record.state === 'idle')
        records.delete(id);
    publish();
  };
  const subscriptions = [
    term.parser.registerOscHandler(7501, (data) => {
      if (data === '?') {
        term.input(programStatusReply);
        return true;
      }
      const record = parseProgramStatus(data);
      if (!record) return true;
      if (record.state === 'clear') {
        for (const id of records.keys())
          if (record.id === '' || id === record.id || id.startsWith(`${record.id}/`))
            records.delete(id);
      } else {
        records.delete(record.id);
        if (records.size >= 64) records.delete(records.keys().next().value!);
        records.set(record.id, record);
      }
      publish();
      return true;
    }),
    term.parser.registerOscHandler(133, (data) => {
      if (data.split(';', 1)[0] === 'A') exited();
      return false;
    }),
    term.parser.registerEscHandler({ final: 'c' }, () => {
      records.clear();
      publish();
      return false;
    }),
  ];
  return {
    exited,
    acknowledge() {
      for (const [id, record] of records)
        if (record.state === 'done' || record.state === 'error') records.delete(id);
      publish();
    },
    dispose() {
      subscriptions.forEach((subscription) => subscription.dispose());
      records.clear();
    },
  };
}
