import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Modal as HeroModal, type ModalProps } from '@heroui/react';
import { useTranslation } from 'react-i18next';
import { t } from '../i18n/index.ts';
import Icon from './Icon';

const CloseButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(function CloseButton(props, ref) {
  useTranslation();
  return <button {...props} ref={ref} aria-label={t('common:close')}><Icon name="close" width="16" /></button>;
});

export default function Modal(props: ModalProps) {
  return <HeroModal {...props} closeButton={props.closeButton ?? <CloseButton />} />;
}
