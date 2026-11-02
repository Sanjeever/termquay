import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react';

export type HostTrust = { host: string; port: number; protocol: string; fingerprint: string; reason?: string };

export default function HostTrustDialog({ target, onConfirm }: { target?: HostTrust; onConfirm(accept: boolean): void }) {
  return <Modal isOpen={!!target} onClose={() => onConfirm(false)} className="app-dialog" size="lg"><ModalContent><ModalHeader>{target?.protocol === 'ssh' ? '核对主机身份' : '核对远程桌面证书'}</ModalHeader><ModalBody>
    <p>{target?.host}:{target?.port}</p><label className="muted">SHA256 指纹</label><code className="fingerprint">{target?.fingerprint}</code>{target?.reason && <p className="muted">{target.reason}</p>}<p>请与可信来源核对指纹，再信任此目标。</p>
  </ModalBody><ModalFooter><Button variant="light" onPress={() => onConfirm(false)}>取消</Button><Button color="primary" onPress={() => onConfirm(true)}>信任并连接</Button></ModalFooter></ModalContent></Modal>;
}
