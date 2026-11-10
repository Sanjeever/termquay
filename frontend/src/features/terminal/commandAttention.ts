import { t as translate } from '../../i18n/index.ts';
export type CommandAttention = 'running' | 'failed' | 'completed';
export const commandAttentionLabels = {
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
