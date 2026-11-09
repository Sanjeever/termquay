import Modal from '../../components/Modal';
import { t as translate } from '../../i18n/index.ts';
import { useMessageState } from '../../i18n/useMessageState.ts';
import { useTranslation } from 'react-i18next';

import { useState } from 'react';
import { Button, Input, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react';
import type { SSHChallenge } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';

export default function SSHChallengeDialog({ challenge, target, onAnswer, onCancel }: { challenge: SSHChallenge; target: string; onAnswer(answers: string[]): Promise<void>; onCancel(): void }) {
  useTranslation();
  const [answers, setAnswers] = useState<string[]>((challenge.questions || []).map(() => ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useMessageState('');
  return <Modal isOpen onClose={onCancel} isDismissable={false} className="app-dialog"><ModalContent><ModalHeader>{translate('connections:sSHInteractiveAuthentication')}</ModalHeader><ModalBody>
    <p className="file-path">{challenge.name || target}</p>{challenge.instruction && <p className="auth-instruction">{challenge.instruction}</p>}
    <form id="ssh-challenge" className="connection-form" onSubmit={async event => { event.preventDefault(); if (busy) return; setBusy(true); setError(''); try { await onAnswer(answers); setAnswers(answers.map(() => '')); } catch (e) { setError(e); } finally { setBusy(false); } }}>
      {(challenge.questions || []).map((question, index) => <Input key={index} autoFocus={index === 0} label={question || translate('connections:authenticationInput', { value1: index + 1 })} labelPlacement="outside" type={challenge.echo?.[index] ? 'text' : 'password'} value={answers[index]} onValueChange={value => setAnswers(previous => previous.map((answer, i) => i === index ? value : answer))} autoComplete="off" maxLength={4096} isDisabled={busy} />)}
      {error && <p role="alert" className="error">{error}</p>}
    </form>
  </ModalBody><ModalFooter><Button variant="light" onPress={onCancel}>{translate('connections:cancelConnection')}</Button><Button color="primary" type="submit" form="ssh-challenge" isLoading={busy}>{translate('connections:continue')}</Button></ModalFooter></ModalContent></Modal>;
}
