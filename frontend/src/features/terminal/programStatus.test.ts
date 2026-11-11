import { expect, test, vi } from 'vitest';
import type { Terminal } from '@xterm/xterm';
import { addProgramStatus, parseProgramStatus, programStatusReply } from './programStatus';
import { aggregateAttention, programAttention } from './commandAttention';

test('workspace status prioritizes user intervention and keeps ready distinct from completed', () => {
  expect(programAttention({ state: 'idle', id: '' })).toBe('idle');
  expect(aggregateAttention(['completed', 'running'])).toBe('running');
  expect(aggregateAttention(['running', 'permission'])).toBe('permission');
  expect(aggregateAttention(['failed', 'question'])).toBe('question');
});

test('program status validates reports atomically and preserves explicit state semantics', () => {
  expect(parseProgramStatus('state=idle:app=codex')).toEqual({
    state: 'idle',
    id: '',
    app: 'codex',
  });
  expect(parseProgramStatus('state=working:state=blocked:kind=permission:progress=42')).toEqual({
    state: 'blocked',
    id: '',
    kind: 'permission',
    progress: 42,
  });
  expect(parseProgramStatus('state=working:unknown=value:bad pair:progress=101')).toEqual({
    state: 'working',
    id: '',
  });
  expect(parseProgramStatus(`state=blocked:msg=${btoa('hello\nworld')}`)).toBeUndefined();
  expect(parseProgramStatus('state=blocked:msg=abcde')).toBeUndefined();
  expect(parseProgramStatus(`state=done:title=${btoa('x'.repeat(193))}`)).toBeUndefined();
  expect(parseProgramStatus('state=working:id=bad//id')).toBeUndefined();
  expect(parseProgramStatus('state=working:id=')).toBeUndefined();
  expect(parseProgramStatus('state=surprise')).toBeUndefined();
  expect(parseProgramStatus('state=working:' + 'x'.repeat(4096))).toBeUndefined();
});

function fixture() {
  const osc = new Map<number, (data: string) => boolean>();
  let reset = () => false;
  const dispose = vi.fn();
  const input = vi.fn();
  const changed = vi.fn();
  const terminal = {
    input,
    parser: {
      registerOscHandler(id: number, handler: (data: string) => boolean) {
        osc.set(id, handler);
        return { dispose };
      },
      registerEscHandler(_: unknown, handler: () => boolean) {
        reset = handler;
        return { dispose };
      },
    },
  } as unknown as Terminal;
  const status = addProgramStatus(terminal, changed);
  return {
    status,
    input,
    changed,
    dispose,
    send: (data: string) => osc.get(7501)!(data),
    prompt: () => osc.get(133)!('A'),
    reset: () => reset(),
  };
}

test('program status answers probes and clears descendants without clearing siblings', () => {
  const f = fixture();
  f.send('?');
  expect(f.input).toHaveBeenCalledWith(programStatusReply);
  f.send('state=idle:app=claude-code');
  f.send('state=blocked:id=task/child:kind=question');
  expect(f.changed).toHaveBeenLastCalledWith({
    state: 'blocked',
    id: 'task/child',
    kind: 'question',
    app: 'claude-code',
  });
  f.send('state=working:id=other');
  f.send('state=clear:id=task');
  expect(f.changed).toHaveBeenLastCalledWith({ state: 'working', id: 'other', app: 'claude-code' });
  f.send('state=clear');
  expect(f.changed).toHaveBeenLastCalledWith(undefined);
});

test('attention acknowledgement preserves blocked work and terminal lifecycle clears live records', () => {
  const f = fixture();
  f.send('state=blocked:kind=auth');
  f.status.acknowledge();
  expect(f.changed).toHaveBeenCalledTimes(1);
  f.send('state=done:id=finished');
  f.prompt();
  expect(f.changed).toHaveBeenLastCalledWith({ state: 'done', id: 'finished' });
  f.status.exited();
  expect(f.changed).toHaveBeenLastCalledWith({ state: 'done', id: 'finished' });
  f.reset();
  expect(f.changed).toHaveBeenLastCalledWith(undefined);
  f.status.dispose();
  expect(f.dispose).toHaveBeenCalledTimes(3);
});

test('status replacement removes absent fields and evicts the least recently updated record', () => {
  const f = fixture();
  f.send('state=blocked:id=old:app=codex:msg=aGVsbG8=');
  for (let index = 0; index < 64; index++) f.send(`state=idle:id=task${index}`);
  expect(f.changed).toHaveBeenLastCalledWith({ state: 'idle', id: 'task63' });
  f.send('state=working:id=task63:app=codex');
  f.send('state=idle:id=task63');
  expect(f.changed).toHaveBeenLastCalledWith({ state: 'idle', id: 'task63' });
});
