import { useEffect, useState } from 'react';
import { Browser } from '@wailsio/runtime';
import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Progress, Switch } from '@heroui/react';
import Markdown from 'react-markdown';
import { GetLicenseFiles, GetLicenseText } from '../../../bindings/github.com/Sanjeever/termquay/appservice';
import SelectControl from '../../components/SelectControl';
import type useUpdates from './useUpdates';
import appIcon from '../../../../build/appicon.svg';

const releasesURL = 'https://github.com/Sanjeever/termquay/releases';

export default function AboutSettings({ updates, onRestart, activeWorkspaces, activeTransfers }: { updates: ReturnType<typeof useUpdates>; onRestart(): void; activeWorkspaces: number; activeTransfers: number }) {
  const [confirm, setConfirm] = useState(false);
  const [licenses, setLicenses] = useState<string[]>();
  const [license, setLicense] = useState('LICENSE');
  const [licenseText, setLicenseText] = useState('');
  const [error, setError] = useState('');
  const status = updates.status;
  const busy = updates.pending || status?.busy;
  useEffect(() => {
    if (!licenses) return;
    let ended = false;
    setLicenseText('');
    GetLicenseText(license).then(text => { if (!ended) setLicenseText(text); }).catch(error => { if (!ended) setError(String(error)); });
    return () => { ended = true; };
  }, [license, licenses]);
  function openURL(value: string) {
    try { const url = new URL(value); if (!['http:', 'https:'].includes(url.protocol)) throw new Error('仅支持 HTTP(S) 链接'); void Browser.OpenURL(url).catch(error => setError(String(error))); }
    catch (error) { setError(String(error)); }
  }
  const phase: Record<string, string> = { checking: '正在检查更新', downloading: '正在下载更新', verifying: '正在校验更新', installing: '正在准备更新', ready: '更新已就绪', 'up-to-date': '已是最新版本' };
  return <div className="settings-section about-section">
    <img src={appIcon} alt="TermQuay 应用图标" width="64" height="64" /><h2>TermQuay</h2>
    <div className="settings-row"><span>版本</span><span>{status?.build.version ?? '…'}{status?.build.development && ' · 开发版'}</span></div>
    {status?.build.commit && <div className="settings-row"><span>构建提交</span><code title={status.build.commit}>{status.build.commit.slice(0, 12)}</code></div>}
    <div className="settings-row"><span>许可证</span><span className="muted">Apache License 2.0</span></div>
    <div className="settings-row"><Switch size="sm" isSelected={status?.enabled ?? false} isDisabled={!status || status.build.development || !!busy} onValueChange={enabled => void updates.setEnabled(enabled)}>自动检查更新</Switch></div>
    <div className="update-actions">
      <Button size="sm" variant="bordered" isDisabled={!status || status.build.development || !!busy || status.state === 'ready'} onPress={() => void updates.check()}>检查更新</Button>
      {status?.version && <Button size="sm" color="primary" isDisabled={!!busy} onPress={() => setConfirm(true)}>{status.state === 'ready' ? '重启并更新' : `新版本 v${status.version}`}</Button>}
      {busy && status?.state === 'downloading' && <Button size="sm" variant="light" onPress={() => void updates.cancel()}>取消下载</Button>}
      <Button size="sm" variant="light" onPress={() => openURL(status?.url || releasesURL)}>发布页面</Button>
      <Button size="sm" variant="light" onPress={() => { if (licenses) setLicenses(undefined); else GetLicenseFiles().then(values => setLicenses(values ?? [])).catch(error => setError(String(error))); }}>开源许可</Button>
    </div>
    {status && phase[status.state] && <p role="status" className="muted">{phase[status.state]}</p>}
    {status?.state === 'downloading' && <Progress aria-label="更新下载进度" value={status.total ? status.downloaded / status.total * 100 : 0} isIndeterminate={!status.total} size="sm" className="update-progress" />}
    {(error || updates.error || status?.error) && <p role="alert" className="error">{error || updates.error || status?.error}</p>}
    {status?.checked_at && <p className="muted update-checked">上次检查 · {new Date(status.checked_at).toLocaleString()}</p>}
    {licenses && <div className="license-view"><SelectControl aria-label="许可文件" value={license} onChange={event => setLicense(event.target.value)}>{licenses.map(name => <option key={name} value={name}>{name}</option>)}</SelectControl><pre tabIndex={0} aria-label="许可原文">{licenseText}</pre></div>}
    <Modal isOpen={confirm} onClose={() => setConfirm(false)} scrollBehavior="inside" className="app-dialog">
      <ModalContent><ModalHeader>更新至 v{status?.version}</ModalHeader><ModalBody>
        <div className="release-notes">{status?.notes ? <Markdown skipHtml components={{ img: () => null, a: ({ href, children }) => <a href={href} onClick={event => { event.preventDefault(); if (href) openURL(href); }}>{children}</a> }}>{status.notes}</Markdown> : <p className="muted">此版本未提供更新日志</p>}</div>
        {status?.state === 'ready' && (activeWorkspaces > 0 || activeTransfers > 0) && <p>重启将关闭 {activeWorkspaces} 个工作区并停止 {activeTransfers} 项传输。</p>}
      </ModalBody><ModalFooter><Button size="sm" variant="light" onPress={() => setConfirm(false)}>取消</Button><Button size="sm" color="primary" isDisabled={!!busy} onPress={() => { setConfirm(false); if (status?.state === 'ready') onRestart(); else void updates.download(); }}>{status?.state === 'ready' ? '重启并更新' : '下载更新'}</Button></ModalFooter></ModalContent>
    </Modal>
  </div>;
}
