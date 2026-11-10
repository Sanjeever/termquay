import Modal from '../../components/Modal';
import { t as translate } from '../../i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { Button, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react';
import SelectControl from '../../components/SelectControl';

export type SudoAuthorization = { path: string; encoding: string; password: string };

export default function SudoAuthorizationDialog({
  path,
  encoding,
  operation,
  target,
  onAnswer,
}: {
  path: string;
  encoding: string;
  operation: 'open' | 'read' | 'save';
  target: string;
  onAnswer(value?: SudoAuthorization): void;
}) {
  useTranslation();
  const [filename, setFilename] = useState(path);
  const [charset, setCharset] = useState(encoding);
  const [password, setPassword] = useState('');
  function answer() {
    const value = { path: filename, encoding: charset, password };
    setPassword('');
    onAnswer(value);
  }
  return (
    <Modal isOpen onClose={() => onAnswer()} className="app-dialog">
      <ModalContent>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (filename.startsWith('/')) answer();
          }}
        >
          <ModalHeader>
            {operation === 'save'
              ? translate('files:authorizeSudoSave')
              : translate('files:authorizeSudoRead')}
          </ModalHeader>
          <ModalBody>
            <p className="file-path">{target}</p>
            <label className="form-field">
              {translate('files:resolvedFilePath')}
              <input
                autoFocus={operation === 'open'}
                value={filename}
                readOnly={operation !== 'open'}
                maxLength={4096}
                onChange={(event) => setFilename(event.target.value)}
              />
            </label>
            {operation === 'open' && (
              <label className="form-field">
                {translate('files:encoding')}
                <SelectControl value={charset} onChange={(event) => setCharset(event.target.value)}>
                  {['UTF-8', 'GBK', 'GB18030'].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </SelectControl>
              </label>
            )}
            <label className="form-field">
              {translate('files:sudoPassword')}
              <input
                autoFocus={operation !== 'open'}
                type="password"
                autoComplete="off"
                value={password}
                maxLength={4096}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <p className="muted">
              {operation === 'save'
                ? translate('files:sudoSaveDescription')
                : translate('files:sudoReadDescription')}
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={() => onAnswer()}>
              {translate('files:cancel')}
            </Button>
            <Button color="primary" type="submit" isDisabled={!filename.startsWith('/')}>
              {operation === 'save'
                ? translate('files:authorizeSave')
                : translate('files:authorizeRead')}
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
}
