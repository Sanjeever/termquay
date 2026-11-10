import { t } from './index.ts';

export function connectionStateLabel(state: string): string {
  switch (state) {
    case 'connected':
      return t('common:connected');
    case 'disconnected':
      return t('common:disconnected');
    case 'connecting':
      return t('common:connecting');
    case 'not-connected':
      return t('common:notConnected');
    case 'running':
      return t('common:running');
    case 'exited':
      return t('common:exited');
    case 'loading':
      return t('rdp:loadingDesktopComponent');
    case 'ready':
      return t('rdp:ready');
    case 'timeout':
      return t('rdp:connectionTimedOut');
    case 'interrupted':
      return t('rdp:sessionInterrupted');
    case 'failed':
      return t('rdp:connectionFailed');
    case 'canceled':
      return t('rdp:connectionCanceled');
    case 'load-failed':
      return t('rdp:couldNotLoadRemoteDesktop');
    default:
      return state;
  }
}
