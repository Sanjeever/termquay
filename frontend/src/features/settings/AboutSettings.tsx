import { t } from '../../i18n/index.ts';
import { message } from '../../i18n/messages.ts';
import { useMessageState } from '../../i18n/useMessageState.ts';
import { useTranslation } from 'react-i18next';
import Tooltip from '../../components/Tooltip';

import { useEffect, useState } from 'react';
import { Browser } from '@wailsio/runtime';
import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Progress, Switch } from '@heroui/react';
import Markdown from 'react-markdown';
import { GetLicenseFiles, GetLicenseText } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import SelectControl from '../../components/SelectControl';
import ErrorNotice from '../../components/ErrorNotice';
import type useUpdates from './useUpdates';
import appIcon from '../../../../build/appicon.svg';

const releasesURL = 'https://github.com/Sanjeever/termquay/releases';

export default function AboutSettings({ updates, onRestart, activeWorkspaces, activeTransfers }: { updates: ReturnType<typeof useUpdates>; onRestart(): void; activeWorkspaces: number; activeTransfers: number }) {
  useTranslation();
  const [confirm, setConfirm] = useState(false);
  const [licenses, setLicenses] = useState<string[]>();
  const [license, setLicense] = useState('LICENSE');
  const [licenseText, setLicenseText] = useState('');
  const [error, setError] = useMessageState('');
  const status = updates.status;
  const busy = updates.pending || status?.busy;
  useEffect(() => {
    if (!licenses) return;
    let ended = false;
    setLicenseText('');
    GetLicenseText(license).then(text => { if (!ended) setLicenseText(text); }).catch(error => { if (!ended) setError(error); });
    return () => { ended = true; };
  }, [license, licenses]);
  function openURL(value: string) {
    try { const url = new URL(value); if (!['http:', 'https:'].includes(url.protocol)) throw message('settings:onlyHTTPSLinksAreSupported'); void Browser.OpenURL(url).catch(error => setError(error)); }
    catch (error) { setError(error); }
  }
  const phase: Record<string, string> = { checking: t('settings:checkingForUpdates'), downloading: t('settings:downloadingUpdate'), verifying: t('settings:verifyingUpdate'), installing: t('settings:preparingUpdate'), ready: t('settings:updateReady'), 'up-to-date': t('settings:upToDate') };
  return <div className="settings-section about-section">
    <img src={appIcon} alt={t('settings:termQuayApplicationIcon')} width="64" height="64" /><h2>TermQuay</h2>
    <div className="settings-row"><span>{t('settings:version')}</span><span>{status?.build.version ?? '…'}{status?.build.development && t('settings:developmentBuild')}</span></div>
    {status?.build.commit && <div className="settings-row"><span>{t('settings:buildCommit')}</span><Tooltip content={status.build.commit}><code>{status.build.commit.slice(0, 12)}</code></Tooltip></div>}
    <div className="settings-row"><span>{t('settings:license')}</span><span className="muted">Apache License 2.0</span></div>
    <div className="settings-row"><Switch size="sm" isSelected={status?.enabled ?? false} isDisabled={!status || status.build.development || !!busy} onValueChange={enabled => void updates.setEnabled(enabled)}>{t('settings:automaticallyCheckForUpdates')}</Switch></div>
    <div className="update-actions">
      <Button size="sm" variant="bordered" isDisabled={!status || status.build.development || !!busy || status.state === 'ready'} onPress={() => void updates.check()}>{t('settings:checkForUpdates')}</Button>
      {status?.version && <Button size="sm" color="primary" isDisabled={!!busy} onPress={() => setConfirm(true)}>{status.state === 'ready' ? t('settings:restartAndUpdate') : t('settings:newVersionV', { value1: status.version })}</Button>}
      {busy && status?.state === 'downloading' && <Button size="sm" variant="light" onPress={() => void updates.cancel()}>{t('settings:cancelDownload')}</Button>}
      <Button size="sm" variant="light" onPress={() => openURL(status?.url || releasesURL)}>{t('settings:releasePage')}</Button>
      <Button size="sm" variant="light" onPress={() => { if (licenses) setLicenses(undefined); else GetLicenseFiles().then(values => setLicenses(values ?? [])).catch(error => setError(error)); }}>{t('settings:openSourceLicenses')}</Button>
    </div>
    {status && phase[status.state] && <p role="status" className="muted">{phase[status.state]}</p>}
    {status?.state === 'downloading' && <Progress aria-label={t('settings:updateDownloadProgress')} value={status.total ? status.downloaded / status.total * 100 : 0} isIndeterminate={!status.total} size="sm" className="update-progress" />}
    <ErrorNotice message={error} onDismiss={()=>setError('')}/>
    <ErrorNotice message={updates.error || status?.error || ''}/>
    {status?.checked_at && <p className="muted update-checked">{t('settings:lastChecked')}{new Date(status.checked_at).toLocaleString()}</p>}
    {licenses && <div className="license-view"><SelectControl aria-label={t('settings:licenseFiles')} value={license} onChange={event => setLicense(event.target.value)}>{licenses.map(name => <option key={name} value={name}>{name}</option>)}</SelectControl><pre tabIndex={0} aria-label={t('settings:originalLicenseText')}>{licenseText}</pre></div>}
    <Modal isOpen={confirm} onClose={() => setConfirm(false)} scrollBehavior="inside" className="app-dialog">
      <ModalContent><ModalHeader>{t('settings:updateToV')}{status?.version}</ModalHeader><ModalBody>
        <div className="release-notes">{status?.notes ? <Markdown skipHtml components={{ img: () => null, a: ({ href, children }) => <a href={href} onClick={event => { event.preventDefault(); if (href) openURL(href); }}>{children}</a> }}>{status.notes}</Markdown> : <p className="muted">{t('settings:noReleaseNotesProvidedForThisVersion')}</p>}</div>
        {status?.state === 'ready' && (activeWorkspaces > 0 || activeTransfers > 0) && <p>{t('settings:restartingWillClose')}{activeWorkspaces} {t('settings:workspacesAndStop')}{activeTransfers} {t('settings:transfers')}</p>}
      </ModalBody><ModalFooter><Button size="sm" variant="light" onPress={() => setConfirm(false)}>{t('settings:cancel')}</Button><Button size="sm" color="primary" isDisabled={!!busy} onPress={() => { setConfirm(false); if (status?.state === 'ready') onRestart(); else void updates.download(); }}>{status?.state === 'ready' ? t('settings:restartAndUpdate') : t('settings:downloadUpdate')}</Button></ModalFooter></ModalContent>
    </Modal>
  </div>;
}
