import { t as translate } from '../../i18n/index.ts';
import type { ProgramStatus } from './programStatus';
export type CommandAttention =
  | 'running'
  | 'failed'
  | 'completed'
  | 'attention'
  | 'idle'
  | 'permission'
  | 'question'
  | 'auth';
export function programAttention(status?: ProgramStatus): CommandAttention | undefined {
  if (!status || status.state === 'clear') return;
  if (status.state === 'blocked') return status.kind ?? 'attention';
  return ({ idle: 'idle', working: 'running', done: 'completed', error: 'failed' } as const)[
    status.state
  ];
}
export function aggregateAttention(states: (CommandAttention | undefined)[]) {
  return (
    [
      'permission',
      'question',
      'auth',
      'attention',
      'failed',
      'running',
      'completed',
      'idle',
    ] as const
  ).find((state) => states.includes(state));
}
export const commandAttentionLabels = {
  get idle() {
    return translate('terminal:programIdle');
  },
  get permission() {
    return translate('terminal:programPermission');
  },
  get question() {
    return translate('terminal:programQuestion');
  },
  get auth() {
    return translate('terminal:programAuth');
  },
  get attention() {
    return translate('terminal:needsAttention');
  },
  get running() {
    return translate('terminal:running');
  },
  get failed() {
    return translate('terminal:failed2');
  },
  get completed() {
    return translate('terminal:completed2');
  },
};
