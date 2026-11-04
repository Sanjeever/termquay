import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react';
import type useWorkbenchClose from './useWorkbenchClose';

export default function WorkbenchCloseDialog({ close, keepDrafts }: { close: ReturnType<typeof useWorkbenchClose>; keepDrafts: boolean }) {
  const discardLabel = close.quitConfirm
    ? close.persistenceError ? '忽略本地保存错误并退出' : keepDrafts ? '保留本地草稿并退出' : '放弃修改并退出'
    : '放弃修改并关闭';
  return <>
    <Modal isOpen={close.restarting} isDismissable={false} isKeyboardDismissDisabled className="app-dialog">
      <ModalContent><ModalHeader>正在重启更新</ModalHeader><ModalBody><p role="status">正在等待更新进程就绪…</p></ModalBody></ModalContent>
    </Modal>
    <Modal isOpen={!!close.closing || close.quitConfirm} onClose={close.cancel} isDismissable={!close.saving} isKeyboardDismissDisabled={close.saving} className="app-dialog">
      <ModalContent>
        <ModalHeader>{close.persistenceError ? '本地状态保存失败' : close.error ? '退出失败' : '未保存文件'}</ModalHeader>
        <ModalBody>
          <p>{close.persistenceError ? '最新本地状态尚未保存。' : close.quitConfirm ? '退出前请处理未保存修改。' : '此工作区有未保存修改。'}</p>
          {close.error && <p className="error" role="alert">{close.error}</p>}
        </ModalBody>
        <ModalFooter>
          <Button variant="light" isDisabled={close.saving} onPress={close.cancel}>返回编辑</Button>
          <Button color="danger" variant="light" isDisabled={close.saving} onPress={close.discard}>{discardLabel}</Button>
          <Button color="primary" isLoading={close.saving} onPress={close.save}>保存并{close.quitConfirm ? '退出' : '关闭'}</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  </>;
}
