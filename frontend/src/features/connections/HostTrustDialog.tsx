import Modal from '../../components/Modal';
import { t as translate } from '../../i18n/index.ts';
import { errorMessage } from '../../lib/errors.ts';
import { useTranslation } from 'react-i18next';
import { Button, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react';

export type HostTrust = { host: string; port: number; protocol: string; fingerprint: string; reason?: unknown };

export default function HostTrustDialog({ target, onConfirm }: { target?: HostTrust; onConfirm(accept: boolean): void }) {
  useTranslation();
  return <Modal isOpen={!!target} onClose={() => onConfirm(false)} className="app-dialog" size="lg"><ModalContent><ModalHeader>{target?.protocol === 'ssh' ? translate('connections:verifyHostIdentity') : translate('connections:verifyRemoteDesktopCertificate')}</ModalHeader><ModalBody>
    <p>{target?.host}:{target?.port}</p><label className="muted">{translate('connections:sHA256Fingerprint')}</label><code className="fingerprint">{target?.fingerprint}</code>{!!target?.reason && <p className="muted">{errorMessage(target.reason)}</p>}<p>{translate('connections:verifyTheFingerprintAgainstATrustedSourceBefore')}</p>
  </ModalBody><ModalFooter><Button variant="light" onPress={() => onConfirm(false)}>{translate('connections:cancel')}</Button><Button color="primary" onPress={() => onConfirm(true)}>{translate('connections:trustAndConnect')}</Button></ModalFooter></ModalContent></Modal>;
}
