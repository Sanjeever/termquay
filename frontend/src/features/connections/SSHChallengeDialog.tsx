import { errorMessage } from "../../lib/errors";
import { useState } from 'react';
import { Button, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react';
import type { SSHChallenge } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';

export default function SSHChallengeDialog({ challenge, target, onAnswer, onCancel }: { challenge: SSHChallenge; target: string; onAnswer(answers: string[]): Promise<void>; onCancel(): void }) {
  const [answers, setAnswers] = useState<string[]>((challenge.questions || []).map(() => ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return <Modal isOpen onClose={onCancel} isDismissable={false} className="app-dialog"><ModalContent><ModalHeader>SSH 交互认证</ModalHeader><ModalBody>
    <p className="file-path">{challenge.name || target}</p>{challenge.instruction && <p className="auth-instruction">{challenge.instruction}</p>}
    <form id="ssh-challenge" className="connection-form" onSubmit={async event => { event.preventDefault(); if (busy) return; setBusy(true); setError(''); try { await onAnswer(answers); setAnswers(answers.map(() => '')); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); } }}>
      {(challenge.questions || []).map((question, index) => <Input key={index} autoFocus={index === 0} label={question || `认证输入 ${index + 1}`} labelPlacement="outside" type={challenge.echo?.[index] ? 'text' : 'password'} value={answers[index]} onValueChange={value => setAnswers(previous => previous.map((answer, i) => i === index ? value : answer))} autoComplete="off" maxLength={4096} isDisabled={busy} />)}
      {error && <p role="alert" className="error">{error}</p>}
    </form>
  </ModalBody><ModalFooter><Button variant="light" onPress={onCancel}>取消连接</Button><Button color="primary" type="submit" form="ssh-challenge" isLoading={busy}>继续</Button></ModalFooter></ModalContent></Modal>;
}
