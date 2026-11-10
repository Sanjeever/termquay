import { t as translate, currentLocale } from '../../i18n/index.ts';
import { message as uiMessage } from '../../i18n/messages.ts';
import { useMessageState } from '../../i18n/useMessageState.ts';
import { useTranslation } from 'react-i18next';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ReadContainerLogs,
  ReadLinuxServiceLog,
  ReadRemoteLog,
} from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { RemoteLogSlice } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import ErrorNotice from '../../components/ErrorNotice';
import Icon from '../../components/Icon';
import { eventError } from '../../lib/errors.ts';
import { retainLogTail, type LogViewOptions, type LogViewResult } from '../files/logView';

export type LogSource = {
  id: string;
  workspace: string;
  host: string;
  kind: 'file' | 'service' | 'container';
  target: string;
  name: string;
  socket: string;
};

export default function LogSourcePane({
  source,
  active,
  live,
  follow,
  refresh,
  options,
  onRemove,
  compact = false,
}: {
  source: LogSource;
  active: boolean;
  live: boolean;
  follow: boolean;
  refresh: number;
  options: LogViewOptions;
  onRemove?(): void;
  compact?: boolean;
}) {
  useTranslation();
  const [content, setContent] = useState('');
  const [error, setError] = useMessageState('');
  const [warning, setWarning] = useState('');
  const [busy, setBusy] = useState(false);
  const [time, setTime] = useState(0);
  const [trimmed, setTrimmed] = useState(false);
  const [view, setView] = useState<LogViewResult>();
  const [filterError, setFilterError] = useMessageState('');
  const [filtering, setFiltering] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const slice = useRef<RemoteLogSlice>();
  const loaded = useRef(false);
  const failed = useRef(false);
  const lastRefresh = useRef(-1);
  const worker = useRef<Worker>();
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active || !live || (failed.current && refresh === lastRefresh.current)) {
      setBusy(false);
      return;
    }
    const reset = refresh !== lastRefresh.current;
    lastRefresh.current = refresh;
    if (!follow && loaded.current && !reset) {
      setBusy(false);
      return;
    }
    let ended = false;
    let timer: ReturnType<typeof setTimeout>;
    let pending: { cancel(): void } | undefined;
    async function read(first: boolean) {
      setBusy(true);
      try {
        let text: string,
          note = '',
          truncated = false;
        if (source.kind === 'file') {
          const before = first && reset ? undefined : slice.current;
          const request = ReadRemoteLog(source.workspace, source.target, before?.end ?? -1, false);
          pending = request;
          const value = await request;
          if (ended) return;
          const tail = retainLogTail(
            before && !value.reset && value.start === before.end
              ? before.content + value.content
              : value.content,
          );
          text = tail.content;
          slice.current = {
            ...value,
            start:
              before && !value.reset
                ? before.start + tail.removedBytes
                : value.start + tail.removedBytes,
            content: text,
          };
          setTrimmed((previous) =>
            before && !value.reset ? previous || tail.removedBytes > 0 : tail.removedBytes > 0,
          );
          if (value.reset) note = translate('logs:fileShortenedReadingRestartedFromTheBeginning');
        } else if (source.kind === 'service') {
          const request = ReadLinuxServiceLog(source.workspace, source.target);
          pending = request;
          const value = await request;
          if (ended) return;
          text = value.stdout;
          note = value.stderr.trim();
          truncated = value.truncated;
        } else {
          const request = ReadContainerLogs(source.workspace, source.socket, source.target);
          pending = request;
          const value = await request;
          if (ended) return;
          text = value.text;
          truncated = value.truncated;
        }
        const tail = retainLogTail(text);
        if (source.kind !== 'file') setTrimmed(tail.removedBytes > 0);
        setContent(tail.content);
        setWarning(
          [note, truncated ? translate('logs:sourceOutputTruncated') : '']
            .filter(Boolean)
            .join(' · '),
        );
        setError('');
        failed.current = false;
        setTime(Date.now());
        loaded.current = true;
        if (follow && !ended) timer = setTimeout(() => void read(false), 2000);
      } catch (e) {
        if (!ended) {
          setError(e);
          failed.current = true;
        }
      } finally {
        if (!ended) setBusy(false);
      }
    }
    void read(true);
    return () => {
      ended = true;
      clearTimeout(timer);
      pending?.cancel();
    };
  }, [source, active, live, follow, refresh, setError]);

  useEffect(() => {
    if (!active) {
      worker.current?.terminate();
      worker.current = undefined;
      setFiltering(false);
      return;
    }
    let ended = false,
      processing = false;
    let deadline: ReturnType<typeof setTimeout>;
    setFiltering(true);
    setFilterError('');
    const timer = setTimeout(() => {
      const fail = (message: unknown) => {
        if (ended) return;
        processing = false;
        clearTimeout(deadline);
        worker.current?.terminate();
        worker.current = undefined;
        setView(undefined);
        setFilterError(message);
        setFiltering(false);
      };
      try {
        worker.current ??= new Worker(new URL('../files/logView.worker.ts', import.meta.url), {
          type: 'module',
        });
        worker.current.onmessage = (event: MessageEvent<LogViewResult>) => {
          if (ended) return;
          processing = false;
          clearTimeout(deadline);
          setView(event.data.error ? undefined : event.data);
          setFilterError(eventError(event.data) || '');
          setFiltering(false);
        };
        worker.current.onerror = (event) => {
          event.preventDefault();
          fail(uiMessage('logs:couldNotProcessLogs', { value1: event.message }));
        };
        processing = true;
        worker.current.postMessage({ content, options });
        deadline = setTimeout(
          () => fail(uiMessage('logs:logProcessingTimedOutSimplifyTheFilterExpression')),
          1000,
        );
      } catch (e) {
        fail(e);
      }
    }, 150);
    return () => {
      ended = true;
      clearTimeout(timer);
      clearTimeout(deadline);
      if (processing) {
        worker.current?.terminate();
        worker.current = undefined;
      }
    };
  }, [content, options, active, setFilterError]);
  useEffect(() => () => worker.current?.terminate(), []);
  useLayoutEffect(() => {
    if (active && autoScroll && host.current) host.current.scrollTop = host.current.scrollHeight;
  }, [view, active, autoScroll]);
  const rows = useMemo(
    () =>
      view?.rows.map((row, index) => {
        let position = 0;
        const parts = row.highlights.flatMap((mark, match) => {
          const previous = row.text.slice(position, mark.start);
          position = mark.end;
          return [previous, <mark key={match}>{row.text.slice(mark.start, mark.end)}</mark>];
        });
        return (
          <div key={index}>
            {row.gap && <div className="remote-log-gap">···</div>}
            {parts}
            {row.text.slice(position) || (row.text ? '' : '\n')}
          </div>
        );
      }),
    [view],
  );
  return (
    <section className="log-source-pane" aria-label={`${source.host} · ${source.name}`}>
      {!compact && (
        <header>
          <div>
            <strong>{source.name}</strong>
            <span className="file-path">{source.host}</span>
          </div>
          {onRemove && (
            <button
              className="icon-button"
              aria-label={translate('logs:removeLogSource', { value1: source.name })}
              onClick={onRemove}
            >
              <Icon name="close" width="14" />
            </button>
          )}
        </header>
      )}
      {!compact && (
        <div className="log-source-path file-path">
          {source.kind === 'container' ? `${source.socket} · ${source.target}` : source.target}
        </div>
      )}
      {!live && !compact && (
        <p className="error" role="status">
          {translate('logs:theOriginalSSHWorkspaceDisconnectedPreviouslyReadContent')}
        </p>
      )}
      <ErrorNotice message={error} />
      <ErrorNotice message={filterError} />
      {warning && (
        <p className="error" role="status">
          {warning}
        </p>
      )}
      <div
        className="log-source-content remote-log-content"
        ref={host}
        tabIndex={0}
        role="region"
        aria-label={translate('logs:logsReadFrom', { value1: source.name })}
        aria-busy={filtering}
        onScroll={(event) => {
          const node = event.currentTarget;
          if (node.scrollHeight - node.scrollTop - node.clientHeight > 12) setAutoScroll(false);
        }}
      >
        {rows}
      </div>
      <footer className="session-status">
        <span>
          {busy
            ? translate('logs:reading')
            : time
              ? translate('logs:readAt', {
                  value1: new Date(time).toLocaleTimeString(currentLocale()),
                })
              : translate('logs:notReadYet')}
          {filtering
            ? translate('logs:filtering')
            : view &&
              translate('logs:matchedLines', { value1: view.matched, value2: view.scanned })}
          {trimmed && translate('logs:earlierContentEvictedFromCache')}
          {view?.truncated && translate('logs:displayTruncated')}
          {view?.highlightLimited && translate('logs:highlightLimitReached')}
          {!!view?.unformatted &&
            translate('logs:linesRetainOriginalJSON', { value1: view.unformatted })}
        </span>
        {compact && (
          <button
            className="session-tool"
            disabled={!content}
            onClick={() => {
              navigator.clipboard.writeText(content).catch((error) => setError(error));
            }}
          >
            {translate('docker:copyLogs')}
          </button>
        )}
        {!autoScroll && (
          <button className="session-tool" onClick={() => setAutoScroll(true)}>
            {translate('logs:scrollToLatest')}
          </button>
        )}
      </footer>
    </section>
  );
}
