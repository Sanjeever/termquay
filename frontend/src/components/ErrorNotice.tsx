import { t as translate } from '../i18n/index.ts';
import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import { errorMessage } from '../lib/errors';
import Icon from './Icon';

export default function ErrorNotice({ message, onDismiss, children, className = '', role = 'alert' }: {
  message: string; onDismiss?(): void; children?: ReactNode; className?: string; role?: 'alert' | 'status';
}) {
  useTranslation();
  if (!message) return null;
  return <div className={`operation-error error ${className}`} role={role}>
    <div className="operation-error-content"><span>{errorMessage(message)}</span>{children && <div className="button-row">{children}</div>}</div>
    {onDismiss && <button className="icon-button" aria-label={translate('common:dismissError')} onClick={onDismiss}><Icon name="close" width="13" /></button>}
  </div>;
}
