import Modal from '../../components/Modal';
import { eventError, errorMessage } from '../../lib/errors.ts';
import { t as translate } from '../../i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { Button, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react';
import type useWorkbenchClose from './useWorkbenchClose';

export default function WorkbenchCloseDialog({
  close,
  keepDrafts,
}: {
  close: ReturnType<typeof useWorkbenchClose>;
  keepDrafts: boolean;
}) {
  useTranslation();
  const discardLabel =
    close.quitConfirm && !close.hasDirty && !close.persistenceError
      ? close.activeTasks
        ? translate('workspaces:cancelTasksAndQuit')
        : translate('workspaces:quit')
      : close.quitConfirm
        ? close.persistenceError
          ? translate('workspaces:ignoreLocalSaveErrorsAndQuit')
          : keepDrafts
            ? translate('workspaces:keepLocalDraftsAndQuit')
            : translate('workspaces:discardChangesAndQuit')
        : translate('workspaces:discardChangesAndClose');
  return (
    <>
      <Modal
        isOpen={close.restarting}
        isDismissable={false}
        isKeyboardDismissDisabled
        className="app-dialog"
      >
        <ModalContent>
          <ModalHeader>{translate('workspaces:restartingToUpdate')}</ModalHeader>
          <ModalBody>
            <p role="status">{translate('workspaces:waitingForUpdaterReadiness')}</p>
          </ModalBody>
        </ModalContent>
      </Modal>
      <Modal
        isOpen={!!close.closing || close.quitConfirm}
        onClose={close.cancel}
        isDismissable={!close.saving}
        isKeyboardDismissDisabled={close.saving}
        className="app-dialog"
      >
        <ModalContent>
          <ModalHeader>
            {close.persistenceError
              ? translate('workspaces:couldNotSaveLocalState')
              : errorMessage(eventError(close))
                ? translate('workspaces:couldNotQuit')
                : close.hasDirty
                  ? translate('workspaces:unsavedFiles')
                  : close.activeTasks
                    ? translate('workspaces:tasksStillRunning')
                    : translate('workspaces:confirmQuit')}
          </ModalHeader>
          <ModalBody>
            {(close.persistenceError || close.hasDirty) && (
              <p>
                {close.persistenceError
                  ? translate('workspaces:theLatestLocalStateHasNotBeenSaved')
                  : close.quitConfirm
                    ? translate('workspaces:handleUnsavedChangesBeforeQuitting')
                    : translate('workspaces:thisWorkspaceHasUnsavedChanges')}
              </p>
            )}
            {!!close.activeTasks && (
              <p>
                {close.activeTasks}{' '}
                {translate('workspaces:tasksAreStillRunningQuittingCancelsLocalRequests')}
              </p>
            )}
            {close.quitConfirm &&
              !close.hasDirty &&
              !close.activeTasks &&
              !close.persistenceError && (
                <p>{translate('workspaces:quittingDiscardsUnsavedExecutionResults')}</p>
              )}
            {errorMessage(eventError(close)) && (
              <p className="error" role="alert">
                {errorMessage(eventError(close))}
              </p>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="light" isDisabled={close.saving} onPress={close.cancel}>
              {close.hasDirty
                ? translate('workspaces:backToEditing')
                : translate('workspaces:backToWorkbench')}
            </Button>
            <Button
              color="danger"
              variant="light"
              isDisabled={close.saving}
              onPress={close.discard}
            >
              {discardLabel}
            </Button>
            {close.hasDirty && (
              <Button color="primary" isLoading={close.saving} onPress={close.save}>
                {translate('workspaces:saveAnd')}
                {close.quitConfirm ? translate('workspaces:quit') : translate('workspaces:close')}
              </Button>
            )}
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}
