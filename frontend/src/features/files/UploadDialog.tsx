import Modal from '../../components/Modal';
import { eventError, errorMessage } from '../../lib/errors.ts';
import { t as translate, currentLocale } from '../../i18n/index.ts';
import { useMessageState } from '../../i18n/useMessageState.ts';
import { useTranslation } from 'react-i18next';

import { useEffect, useRef, useState } from 'react';
import { Button, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react';
import { Events } from '@wailsio/runtime';
import { ChooseUploadFiles, ConfirmUpload, DiscardUpload, ReadDirectory } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { Transfer, UploadPreparation, UploadPreview } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import type { Directory } from '../../../bindings/github.com/Sanjeever/termquay/internal/files/models';
import SelectControl from '../../components/SelectControl';
import Icon from '../../components/Icon';
import { bytes } from './transferFormat';

export default function UploadDialog({ workspaces, onSubmitted }: { workspaces: string[]; onSubmitted(items: Transfer[]): void }) {
  useTranslation();
  const [preview, setPreview] = useState<UploadPreview>();
  const [directory, setDirectory] = useState('');
  const [listing, setListing] = useState<Directory>();
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [error, setError] = useMessageState('');
  const [submitted, setSubmitted] = useState(0);
  const choosing = useRef(false);
  const pending = useRef<ReturnType<typeof ReadDirectory>>();
  const latest = useRef(preview); latest.current = preview;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    function accept(value: UploadPreview) {
      if (!value.id) return;
      setPreview(value); setDirectory(value.directory); setOverwrite(false); setListing(undefined); setError(''); setSubmitted(0);
    }
    const off = Events.On('files:upload-prepared', event => {
      const value = event.data as UploadPreparation;
      if (value.error) setError(eventError(value)); else accept(value.preview);
    });
    async function choose(event: Event) {
      if (choosing.current) return;
      choosing.current = true;
      const { id, directory } = (event as CustomEvent<{ id: string; directory: string }>).detail;
      try {
        const value = await ChooseUploadFiles(id, directory);
        if (mounted.current) accept(value); else if (value.id) await DiscardUpload(value.id);
      } catch (e) { if (mounted.current) setError(e); }
      finally { choosing.current = false; }
    }
    window.addEventListener('termquay:choose-upload', choose);
    return () => {
      mounted.current = false; off(); window.removeEventListener('termquay:choose-upload', choose); pending.current?.cancel();
      if (latest.current) void DiscardUpload(latest.current.id);
    };
  }, []);
  async function close() {
    if (busy) return;
    try {
      if (preview) await DiscardUpload(preview.id);
      pending.current?.cancel(); pending.current = undefined;
      setPreview(undefined); setListing(undefined); setError(''); setBrowsing(false);
    } catch (e) { setError(e); }
  }
  async function browse(path: string) {
    if (!preview || busy) return;
    pending.current?.cancel();
    const request = ReadDirectory(preview.workspace, path); pending.current = request;
    setBrowsing(true); setError('');
    try {
      const value = await request;
      if (pending.current === request) { setListing(value); setDirectory(value.path); }
    } catch (e) { if (pending.current === request) setError(e); }
    finally { if (pending.current === request) { pending.current = undefined; setBrowsing(false); } }
  }
  const files = preview?.files || [];
  const supported = files.filter(file => file.supported);
  const connected = !preview || workspaces.includes(preview.workspace);
  return <Modal isOpen={!!preview || !!error} onClose={() => void close()} isDismissable={!busy} isKeyboardDismissDisabled={busy} hideCloseButton={busy} closeButton={<button type="button" aria-labelledby="upload-confirm-close"><span id="upload-confirm-close" className="sr-only">{translate('files:closeUploadConfirmation')}</span><Icon name="close" width="14" /></button>} scrollBehavior="inside" className="app-dialog upload-dialog">
    <ModalContent><form onSubmit={async event => {
      event.preventDefault(); if (!preview || busy || !connected || !supported.length) return;
      setBusy(true); setError('');
      try {
        const result = await ConfirmUpload(preview.id, directory, overwrite);
        const items = result.batch.items || [];
        if (items.length) { onSubmitted(items); setSubmitted(count => count + items.length); }
        if (result.pending.id) { setPreview(result.pending); setDirectory(result.pending.directory); }
        else { setPreview(undefined); setListing(undefined); }
      } catch (e) { setError(e); }
      finally { setBusy(false); }
    }}><ModalHeader>{preview ? translate('files:files2', { value1: preview.source ? translate('files:paste') : translate('files:upload'), value2: files.length }) : translate('files:cannotPrepareUpload')}</ModalHeader><ModalBody>
      {preview && <>
        {preview.source && <dl className="upload-target"><dt>{translate('files:source')}</dt><dd>{preview.source}</dd></dl>}
        <dl className="upload-target"><dt>{translate('files:destinationConnection')}</dt><dd>{preview.target}</dd></dl>
        <label className="form-field">{translate('files:destinationDirectory')}<div className="upload-directory"><input aria-label={translate('files:uploadDestinationDirectory')} required pattern="/.*" value={directory} disabled={busy} onChange={event => { pending.current?.cancel(); pending.current = undefined; setBrowsing(false); setDirectory(event.target.value); setListing(undefined); }} /><Button size="sm" variant="bordered" isDisabled={busy || !connected} isLoading={browsing} onPress={() => void browse(directory)}>{translate('files:browse')}</Button></div></label>
        {listing && <div className="upload-directories" aria-label={translate('files:selectRemoteUploadDirectory')} aria-busy={browsing}>
          {listing.path !== '/' && <button type="button" disabled={busy || browsing} onClick={() => void browse(listing.path.slice(0, listing.path.lastIndexOf('/')) || '/')}><Icon name="up" width="14" />{translate('files:parentDirectory')}</button>}
          {(listing.entries || []).filter(entry => entry.directory).sort((a, b) => a.name.localeCompare(b.name, currentLocale())).map(entry => <button type="button" key={entry.path} disabled={busy || browsing} onClick={() => void browse(entry.path)}><Icon name="files" width="14" />{entry.name}</button>)}
          {!listing.entries?.some(entry => entry.directory) && <p className="muted">{translate('files:noSubdirectories')}</p>}
        </div>}
        <ul className="upload-files" aria-label={translate('files:filesToTransfer')}>{files.map((file, index) => <li key={index}><div><span title={file.path || file.name}>{file.path || file.name}</span><span className="muted">{file.supported ? bytes(file.size) : translate('files:unsupported')}</span></div>{errorMessage(eventError(file)) && <p className="error">{errorMessage(eventError(file))}</p>}</li>)}</ul>
        <div className="upload-summary">{supported.length} {translate('files:transferableFiles')}{bytes(supported.reduce((sum, file) => sum + file.size, 0))}</div>
        <label className="form-field">{translate('files:nameConflicts')}<SelectControl aria-label={translate('files:uploadNameConflictHandling')} value={overwrite ? 'overwrite' : 'skip'} disabled={busy} onChange={event => setOverwrite(event.target.value === 'overwrite')}><option value="skip">{translate('files:skip')}</option><option value="overwrite">{translate('files:overwriteRegularFilesWithMatchingNames')}</option></SelectControl></label>
        {overwrite && <p className="error">{translate('files:regularFilesWithTheSameNameInThe')}</p>}
        {!!submitted && <p role="status">{submitted} {translate('files:filesQueuedTheFilesBelowWereNotQueued')}</p>}
        {!connected && <p role="alert" className="error">{translate('files:sSHWorkspaceClosedReconnectBeforeStartingATransfer')}</p>}
      </>}
      {error && <p role="alert" className="error">{error}</p>}
    </ModalBody><ModalFooter><Button variant="light" isDisabled={busy} onPress={() => void close()}>{submitted || !preview ? translate('files:close') : translate('files:cancel')}</Button>{preview && <Button type="submit" color="primary" isLoading={busy} isDisabled={!connected || !supported.length || browsing}>{busy ? translate('files:addingToQueue') : submitted ? translate('files:retryFilesNotQueued') : preview.source ? translate('files:startCopying') : translate('files:startUpload')}</Button>}</ModalFooter></form></ModalContent>
  </Modal>;
}
