import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react';
import type useWorkbenchClose from './useWorkbenchClose';

export default function WorkbenchCloseDialog({ close, keepDrafts }: { close: ReturnType<typeof useWorkbenchClose>; keepDrafts: boolean }) {
  const discardLabel = close.quitConfirm && !close.hasDirty && !close.persistenceError ? close.activeTasks ? '取消任务并退出' : '退出' : close.quitConfirm
    ? close.persistenceError ? '忽略本地保存错误并退出' : keepDrafts ? '保留本地草稿并退出' : '放弃修改并退出'
    : '放弃修改并关闭';
  return <>
    <Modal isOpen={close.restarting} isDismissable={false} isKeyboardDismissDisabled className="app-dialog">
      <ModalContent><ModalHeader>正在重启更新</ModalHeader><ModalBody><p role="status">正在等待更新进程就绪…</p></ModalBody></ModalContent>
    </Modal>
    <Modal isOpen={!!close.closing || close.quitConfirm} onClose={close.cancel} isDismissable={!close.saving} isKeyboardDismissDisabled={close.saving} className="app-dialog">
      <ModalContent>
        <ModalHeader>{close.persistenceError ? '本地状态保存失败' : close.error ? '退出失败' : close.hasDirty ? '未保存文件' : close.activeTasks ? '任务仍在运行' : '确认退出'}</ModalHeader>
        <ModalBody>
          {(close.persistenceError || close.hasDirty) && <p>{close.persistenceError ? '最新本地状态尚未保存。' : close.quitConfirm ? '退出前请处理未保存修改。' : '此工作区有未保存修改。'}</p>}
          {!!close.activeTasks && <p>{close.activeTasks} 个任务尚未结束。退出会取消本机请求，远端已启动的进程可能继续运行，未保存的执行结果将丢弃。</p>}
          {close.quitConfirm && !close.hasDirty && !close.activeTasks && !close.persistenceError && <p>退出将丢弃未保存的执行结果。</p>}
          {close.error && <p className="error" role="alert">{close.error}</p>}
        </ModalBody>
        <ModalFooter>
          <Button variant="light" isDisabled={close.saving} onPress={close.cancel}>{close.hasDirty ? '返回编辑' : '返回工作台'}</Button>
          <Button color="danger" variant="light" isDisabled={close.saving} onPress={close.discard}>{discardLabel}</Button>
          {close.hasDirty && <Button color="primary" isLoading={close.saving} onPress={close.save}>保存并{close.quitConfirm ? '退出' : '关闭'}</Button>}
        </ModalFooter>
      </ModalContent>
    </Modal>
  </>;
}
