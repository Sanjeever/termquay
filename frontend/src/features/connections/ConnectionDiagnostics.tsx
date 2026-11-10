import { statusLabel } from '../../i18n/status';
import { t as translate } from '../../i18n/index.ts';
import { useMessageState } from '../../i18n/useMessageState.ts';
import { useTranslation } from 'react-i18next';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@heroui/react';
import { CheckSSHFileAccess } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { ConnectionStep } from '../../../bindings/github.com/Sanjeever/termquay/internal/ssh/models';
import { errorMessage } from '../../lib/errors';
import ErrorNotice from '../../components/ErrorNotice';

const states: Record<string, string> = {
  get running() {
    return translate('connections:inProgress');
  },
  get completed() {
    return translate('connections:completed');
  },
  get failed() {
    return translate('connections:failed');
  },
  get cancelled() {
    return translate('connections:finished');
  },
};
const codes: Record<string, string> = {
  get dns() {
    return translate('connections:dNSResolutionFailed');
  },
  get refused() {
    return translate('connections:connectionRefused');
  },
  get timeout() {
    return translate('connections:timedOut');
  },
  get cancelled() {
    return translate('connections:canceled');
  },
  get identity() {
    return translate('connections:identityRequiresVerificationOrHasChanged');
  },
  get authentication() {
    return translate('connections:authenticationIncomplete');
  },
};

export default function ConnectionDiagnostics({
  steps,
  workspace = '',
  busy = false,
}: {
  steps: ConnectionStep[];
  workspace?: string;
  busy?: boolean;
}) {
  useTranslation();
  const [error, setError] = useMessageState('');
  const [fileCheck, setFileCheck] = useState<{ state: string; duration: number; detail: string }>();
  const pending = useRef<ReturnType<typeof CheckSSHFileAccess>>();
  const generation = useRef(0);
  useEffect(() => {
    generation.current++;
    setFileCheck(undefined);
    return () => {
      // oxlint-disable-next-line react/exhaustive-deps -- Invalidate the latest generation, including requests started after setup.
      generation.current++;
      pending.current?.cancel();
    };
  }, [workspace]);
  async function checkFiles() {
    if (pending.current) return;
    const epoch = generation.current,
      started = performance.now();
    setFileCheck({ state: 'running', duration: 0, detail: '' });
    const operation = CheckSSHFileAccess(workspace);
    pending.current = operation;
    try {
      await operation;
      if (generation.current === epoch)
        setFileCheck({
          state: 'completed',
          duration: Math.round(performance.now() - started),
          detail: '',
        });
    } catch (e) {
      if (generation.current === epoch)
        setFileCheck({
          state: 'failed',
          duration: Math.round(performance.now() - started),
          detail: errorMessage(e),
        });
    } finally {
      if (pending.current === operation) pending.current = undefined;
    }
  }
  async function copy() {
    const lines = steps.map(
      (step) =>
        `${statusLabel(step.role_code, step.role)} ${step.hop} · ${step.host}:${step.port} · ${statusLabel(step.stage_code, step.stage)} · ${states[step.state] || step.state} · ${step.duration_ms} ms${step.detail ? `\n${step.detail}` : ''}`,
    );
    if (fileCheck)
      lines.push(
        translate('connections:sFTPFileChannelMs', {
          value1: states[fileCheck.state],
          value2: fileCheck.duration,
          value3: fileCheck.detail ? `\n${fileCheck.detail}` : '',
        }),
      );
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setError('');
    } catch (e) {
      setError(e);
    }
  }
  if (!steps.length) return null;
  return (
    <div className="connection-diagnostics">
      <ol>
        {steps.map((step, index) => (
          <li key={index} className={step.state === 'failed' ? 'error' : ''}>
            <span>
              {statusLabel(step.role_code, step.role)} {step.hop} · {step.host}:{step.port}
            </span>
            <strong>{statusLabel(step.stage_code, step.stage)}</strong>
            <span>
              {states[step.state] || step.state}
              {step.state !== 'running' && ` · ${step.duration_ms} ms`}
            </span>
            {step.detail && (
              <details>
                <summary>
                  {codes[step.code || ''] || translate('connections:technicalDetails')}
                </summary>
                <pre>{step.detail}</pre>
              </details>
            )}
          </li>
        ))}
      </ol>
      {fileCheck && (
        <p className={fileCheck.state === 'failed' ? 'error' : ''}>
          {translate('connections:sFTPFileChannel')}
          {states[fileCheck.state]}
          {fileCheck.state !== 'running' && ` · ${fileCheck.duration} ms`}
          {fileCheck.detail && <span className="file-path">{fileCheck.detail}</span>}
        </p>
      )}
      <div className="button-row">
        <Button type="button" size="sm" variant="light" onPress={() => void copy()}>
          {translate('connections:copyDiagnosticSummary')}
        </Button>
        {workspace && (
          <Button
            type="button"
            size="sm"
            variant="light"
            isDisabled={busy}
            isLoading={fileCheck?.state === 'running'}
            onPress={() => void checkFiles()}
          >
            {translate('connections:checkFileChannel')}
          </Button>
        )}
      </div>
      <ErrorNotice message={error} onDismiss={() => setError('')} />
    </div>
  );
}
