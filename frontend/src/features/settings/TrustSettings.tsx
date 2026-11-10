import Modal from '../../components/Modal';
import { t as translate } from '../../i18n/index.ts';
import { useMessageState } from '../../i18n/useMessageState.ts';
import { useTranslation } from 'react-i18next';

import KnownHostsImportDialog from './KnownHostsImportDialog';
import { useEffect, useState } from 'react';
import { Button, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@heroui/react';
import {
  ListTrusts,
  RevokeTrust,
  ProbeTrustReview,
  ConfirmTrustReview,
} from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type {
  TrustPage,
  TrustReview,
  TrustRecord,
} from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
export default function TrustSettings() {
  useTranslation();
  const [page, setPage] = useState<TrustPage>();
  const [cursors, setCursors] = useState(['']);
  const [review, setReview] = useState<TrustReview>();
  const [revoking, setRevoking] = useState<TrustRecord>();
  const [error, setError] = useMessageState('');
  const [busy, setBusy] = useState(false);
  async function load(cursor = cursors[cursors.length - 1]) {
    try {
      setPage(await ListTrusts(cursor));
      setError('');
    } catch (e) {
      setError(e);
    }
  }
  /* oxlint-disable react/exhaustive-deps -- Load the first trust page on mount; paging and explicit refresh invoke load themselves. */
  useEffect(() => {
    void load();
  }, []);
  /* oxlint-enable react/exhaustive-deps */
  const [importing, setImporting] = useState(false);
  if (importing)
    return (
      <KnownHostsImportDialog onClose={() => setImporting(false)} onImported={() => void load()} />
    );
  return (
    <div className="settings-section">
      <h2>{translate('settings:identityTrust')}</h2>
      <Button size="sm" variant="bordered" isDisabled={busy} onPress={() => setImporting(true)}>
        {translate('settings:importKnownHosts')}
      </Button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {(page?.items || []).map((r) => (
        <div className="settings-row" key={r.key}>
          <span className="file-path">
            {r.protocol.toUpperCase()} · {r.host}:{r.port}
            {r.via && (
              <small>
                {' '}
                {translate('settings:viaJumpHost3')}
                {r.via.slice(0, 6)}
              </small>
            )}
            <small className="fingerprint">{r.fingerprint}</small>
          </span>
          <div className="button-row">
            <Button
              size="sm"
              variant="light"
              isDisabled={busy}
              onPress={async () => {
                setBusy(true);
                try {
                  setReview(await ProbeTrustReview(r.key));
                } catch (e) {
                  setError(e);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {translate('settings:probeAgain')}
            </Button>
            <Button size="sm" variant="light" isDisabled={busy} onPress={() => setRevoking(r)}>
              {translate('settings:revoke')}
            </Button>
          </div>
        </div>
      ))}
      <div className="button-row">
        <Button
          size="sm"
          isDisabled={cursors.length < 2 || busy}
          onPress={() => {
            const next = cursors.slice(0, -1);
            setCursors(next);
            void load(next[next.length - 1]);
          }}
        >
          {translate('settings:previousPage')}
        </Button>
        <Button
          size="sm"
          isDisabled={!page?.next || busy}
          onPress={() => {
            if (page?.next) {
              setCursors((prev) => [...prev, page.next]);
              void load(page.next);
            }
          }}
        >
          {translate('settings:nextPage')}
        </Button>
      </div>
      <Modal isOpen={!!review} onClose={() => !busy && setReview(undefined)} className="app-dialog">
        <ModalContent>
          <ModalHeader>{translate('settings:reviewDestinationIdentity')}</ModalHeader>
          <ModalBody>
            <p>
              {review?.record.host}:{review?.record.port}
            </p>
            <label>{translate('settings:previousFingerprint')}</label>
            <code className="fingerprint">{review?.old || translate('settings:notTrusted')}</code>
            <label>{translate('settings:newFingerprint')}</label>
            <code className="fingerprint">{review?.new}</code>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="light" isDisabled={busy} onPress={() => setReview(undefined)}>
              {translate('settings:cancel')}
            </Button>
            <Button
              color="primary"
              isLoading={busy}
              onPress={async () => {
                if (!review) return;
                setBusy(true);
                try {
                  await ConfirmTrustReview(review.id);
                  setReview(undefined);
                  await load();
                } catch (e) {
                  setError(e);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {translate('settings:verifyAndUpdateTrust')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
      <Modal isOpen={!!revoking} onClose={() => setRevoking(undefined)} className="app-dialog">
        <ModalContent>
          <ModalHeader>{translate('settings:revokeIdentityTrust')}</ModalHeader>
          <ModalBody>
            <p>
              {revoking?.host}:{revoking?.port}
            </p>
            <p>{translate('settings:existingSessionsContinueUnusedRDPApprovalsAreRevoked')}</p>
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={() => setRevoking(undefined)}>
              {translate('settings:cancel')}
            </Button>
            <Button
              color="danger"
              onPress={async () => {
                if (!revoking) return;
                try {
                  await RevokeTrust(revoking.key);
                  setRevoking(undefined);
                  await load();
                } catch (e) {
                  setError(e);
                }
              }}
            >
              {translate('settings:revokeTrust')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}
