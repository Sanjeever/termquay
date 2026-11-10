import Modal from '../../components/Modal';
import { eventError, errorMessage } from '../../lib/errors.ts';
import { t as translate } from '../../i18n/index.ts';
import { message as uiMessage } from '../../i18n/messages.ts';
import { useMessageState } from '../../i18n/useMessageState.ts';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { Button, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@heroui/react';
import type { Snippet } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import { expandSnippet, snippetParameters } from '../../lib/snippets';
export default function SnippetInsertDialog({
  snippet,
  onInsert,
  onClose,
}: {
  snippet: Snippet;
  onInsert(text: string): boolean;
  onClose(): void;
}) {
  useTranslation();
  const names = snippetParameters(snippet.body);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(names.map((name) => [name, ''])),
  );
  const [error, setError] = useMessageState('');
  const expanded = expandSnippet(snippet.body, values);
  return (
    <Modal
      isOpen
      onClose={onClose}
      className="app-dialog"
      scrollBehavior="inside"
      onKeyDownCapture={(e) => {
        if (e.key === 'Escape' && !e.nativeEvent.isComposing) {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <ModalContent>
        <ModalHeader>{snippet.name}</ModalHeader>
        <ModalBody>
          {names.map((name, index) => (
            <label className="form-field" key={name}>
              {name}
              <input
                autoFocus={index === 0}
                aria-label={translate('terminal:snippetParameter', { value1: name })}
                value={values[name]}
                maxLength={4096}
                onChange={(e) => setValues({ ...values, [name]: e.target.value })}
              />
            </label>
          ))}
          <pre className="paste-preview">{expanded.text}</pre>
          {(error || errorMessage(eventError(expanded))) && (
            <p role="alert" className="error">
              {error || errorMessage(eventError(expanded))}
            </p>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="light" onPress={onClose}>
            {translate('terminal:cancel')}
          </Button>
          <Button
            color="primary"
            isDisabled={!!errorMessage(eventError(expanded))}
            onPress={() => {
              if (onInsert(expanded.text)) onClose();
              else setError(uiMessage('terminal:currentTerminalIsNotInteractiveCloseThisDialog'));
            }}
          >
            {translate('terminal:insertIntoCurrentTerminal')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
