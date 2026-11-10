import { useTranslation } from 'react-i18next';
import { connectionStateLabel } from '../../i18n/connectionState';
import { t as translate } from '../../i18n/index.ts';
import { message as uiMessage } from '../../i18n/messages.ts';
import { useMessageState } from '../../i18n/useMessageState.ts';

import Tooltip from '../../components/Tooltip';
import SelectControl from '../../components/SelectControl';
import ErrorNotice from '../../components/ErrorNotice';
import { errorMessage, eventError } from '../../lib/errors';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  Button,
  DropdownTrigger,
  DropdownMenu,
  DropdownItem,
  PopoverTrigger,
  PopoverContent,
  Switch,
} from '@heroui/react';
import { Dropdown, Popover } from '../../components/Popover';
import { Events } from '@wailsio/runtime';
import type { IronError, UserInteraction } from '@devolutions/iron-remote-desktop';
import { CloseRDP } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { Grant } from '../../../bindings/github.com/Sanjeever/termquay/internal/rdp/models';

export type RDPOptions = {
  clipboard: boolean;
  resolution: string;
  client?: string;
  gateway?: string;
};
export type RDPHandle = {
  connect(username: string, password: string, domain: string): Promise<void>;
  cancel(): void;
  focus(): void;
  options(): RDPOptions;
};
let initialization: Promise<typeof import('@devolutions/iron-remote-desktop-rdp')> | undefined;

function initialize() {
  initialization ??= import('@devolutions/iron-remote-desktop-rdp')
    .then(async (module) => {
      await module.init('OFF');
      return module;
    })
    .catch((error) => {
      initialization = undefined;
      throw error;
    });
  return initialization;
}

function detail(error: unknown) {
  const iron = error as Partial<IronError> | null;
  const message = typeof iron?.backtrace === 'function' ? iron.backtrace() : String(error);
  return message.replace(/(wss?:\/\/[^/\s]+)\/rdp\/[^\s)'"`]+/g, translate('rdp:1RdpSession'));
}

const RDPView = forwardRef<
  RDPHandle,
  {
    grant?: Grant;
    target: string;
    environment: string;
    visible: boolean;
    failure?: unknown;
    busy: boolean;
    pending?: boolean;
    onRetry(): void;
    onEdit(): void;
    onState(state: string): void;
    options: RDPOptions;
    onResolution(value: string): Promise<void>;
  }
>(function RDPView(
  {
    grant,
    target,
    environment,
    visible,
    failure,
    busy,
    pending = false,
    onRetry,
    onEdit,
    onState,
    options,
    onResolution,
  },
  ref,
) {
  useTranslation();
  const view = useRef<HTMLDivElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const ui = useRef<UserInteraction>();
  const [error, setError] = useMessageState('');
  const [actionError, setActionError] = useState<{ source: string; message: unknown }>();
  function actionFailed(source: string, error: unknown) {
    setActionError({ source, message: error });
  }
  function actionSucceeded(source: string) {
    setActionError((previous) => (previous?.source === source ? undefined : previous));
  }
  const [status, setStatus] = useState('loading');
  const [clipboard, setClipboard] = useState(options.clipboard);
  const [activeClipboard, setActiveClipboard] = useState(false);
  const [resolution, setResolution] = useState(options.resolution);
  const [scale, setScale] = useState<'fit' | 'real'>('fit');
  const [keyboardTarget, setKeyboardTarget] = useState<'local' | 'remote'>('local');
  const [fullscreen, setFullscreen] = useState(false);
  const [toolbarCollapsed, setToolbarCollapsed] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  useEffect(() => {
    setClipboard(options.clipboard);
    setResolution(options.resolution);
  }, [options]);
  useEffect(() => {
    const changed = () => {
      const full = document.fullscreenElement === view.current;
      setFullscreen(full);
      setToolbarCollapsed(full);
      focusDesktop();
    };
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, []);
  const stateCallback = useRef(onState);
  stateCallback.current = onState;
  useEffect(() => {
    stateCallback.current(
      !grant
        ? pending
          ? 'connecting'
          : failure
            ? 'disconnected'
            : 'not-connected'
        : status === 'connected' && ready.running
          ? 'connected'
          : ready.ended || failure
            ? 'disconnected'
            : 'connecting',
    );
  }, [status, failure, pending, grant?.id]);
  function focusDesktop() {
    container.current
      ?.querySelector('iron-remote-desktop')
      ?.shadowRoot?.querySelector<HTMLCanvasElement>('canvas')
      ?.focus();
  }
  const ready = useMemo(() => {
    let resolve!: (value: UserInteraction) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<UserInteraction>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    let stop!: (reason: unknown) => void;
    const stopped = new Promise<never>((_, no) => {
      stop = no;
    });
    void promise.catch(() => {});
    void stopped.catch(() => {});
    return {
      promise,
      resolve,
      reject,
      stopped,
      stop,
      ended: false,
      disposed: false,
      running: false,
      error: undefined as unknown,
    };
  }, [grant?.id]);

  function shutdown() {
    const api = ui.current;
    ui.current = undefined;
    if (!ready.running) return '';
    ready.running = false;
    try {
      api?.shutdown();
      return '';
    } catch (e) {
      return uiMessage('rdp:couldNotCloseDesktop', { value1: detail(e) });
    }
  }

  function finish(status: string, detailMessage: unknown = '') {
    if (ready.ended || ready.disposed) return;
    ready.ended = true;
    ready.error = detailMessage;
    const reason = detailMessage || new Error(connectionStateLabel(status));
    ready.stop(reason);
    ready.reject(reason);
    const closingError = shutdown();
    setStatus(status);
    setError([detailMessage, closingError].filter(Boolean));
    if (grant)
      void CloseRDP(grant.id).catch((e) => {
        if (!ready.disposed)
          setError((previous) =>
            [previous, uiMessage('rdp:couldNotCloseConnection', { value1: detail(e) })].filter(
              Boolean,
            ),
          );
      });
  }

  useImperativeHandle(
    ref,
    () => ({
      async connect(username, password, domain) {
        if (!grant) throw uiMessage('rdp:rDPAccessNotAuthorizedYet');
        const timer = setTimeout(
          () => finish('timeout', uiMessage('rdp:timedOutWaitingForRDPAuthenticationAndDesktop')),
          30000,
        );
        try {
          const api = await Promise.race([ready.promise, ready.stopped]);
          const backend = await initialize();
          if (ready.ended || ready.disposed) throw uiMessage('rdp:connectionCanceled');
          setStatus('connecting');
          api.setEnableClipboard(options.clipboard);
          setActiveClipboard(options.clipboard);
          const [width, height] =
            options.resolution === 'dynamic'
              ? [1280, 800]
              : options.resolution.split('x').map(Number);
          const config = api
            .configBuilder()
            .withUsername(username)
            .withPassword(password)
            .withServerDomain(domain)
            .withDestination(grant.destination)
            .withProxyAddress(grant.proxy_url)
            .withAuthToken(grant.token)
            .withDesktopSize({ width, height })
            .withExtension(backend.enableCredssp(true))
            .withExtension(backend.displayControl(true))
            .build();
          const session = await Promise.race([
            api.connect(config).then((result) => {
              if (ready.ended || ready.disposed) {
                api.shutdown();
                throw uiMessage('rdp:connectionCanceled');
              }
              return result;
            }),
            ready.stopped,
          ]);
          api.setKeyboardUnicodeMode(true);
          setStatus('connected');
          ready.running = true;
          void session.run().then(
            () => {
              ready.running = false;
              finish('disconnected');
            },
            (e) => {
              ready.running = false;
              finish('interrupted', detail(e));
            },
          );
        } catch (e) {
          const message = ready.error || detail(e);
          finish('failed', message);
          throw typeof message === 'string' ? new Error(message) : message;
        } finally {
          clearTimeout(timer);
          password = '';
        }
      },
      cancel: () => finish('canceled'),
      focus: focusDesktop,
      options: () => ({ clipboard, resolution, client: options.client, gateway: options.gateway }),
    }),
    [grant, ready, options, clipboard, resolution],
  );

  useEffect(() => {
    if (!grant) return;
    let desktop: HTMLElement | undefined;
    const timer = setTimeout(
      () => finish('load-failed', uiMessage('rdp:desktopComponentReadinessTimedOut')),
      15000,
    );
    setStatus('loading');
    setError('');
    void (async () => {
      try {
        const module = await initialize();
        await import('@devolutions/iron-remote-desktop');
        if (ready.disposed || ready.ended) return;
        desktop = document.createElement('iron-remote-desktop');
        Object.assign(desktop, { module: module.Backend });
        desktop.setAttribute('verbose', 'false');
        desktop.setAttribute('scale', 'fit');
        desktop.tabIndex = 0;
        desktop.style.cssText = 'display:flex;width:100%;height:100%;';
        desktop.addEventListener(
          'ready',
          (event) => {
            if (ready.disposed || ready.ended) return;
            ui.current = (
              event as CustomEvent<{ irgUserInteraction: UserInteraction }>
            ).detail.irgUserInteraction;
            ui.current.setEnableClipboard(false);
            ui.current.setEnableAutoClipboard(false);
          },
          { once: true },
        );
        desktop.addEventListener(
          'clipboard-ready',
          () => {
            if (ready.disposed || ready.ended || !ui.current) return;
            clearTimeout(timer);
            setStatus('ready');
            ready.resolve(ui.current);
          },
          { once: true },
        );
        container.current!.appendChild(desktop);
      } catch (e) {
        finish('load-failed', detail(e));
      }
    })();
    const unsubscribe = Events.On('rdp:error', (event) => {
      const data = event.data as { id: string; error: string };
      if (data.id === grant.id) finish('interrupted', eventError(data));
    });
    const unsubscribeClosed = Events.On('rdp:closed', (event) => {
      const data = event.data as { id: string };
      if (data.id === grant.id) finish('disconnected');
    });
    return () => {
      ready.disposed = true;
      clearTimeout(timer);
      unsubscribe();
      unsubscribeClosed();
      ready.stop(uiMessage('rdp:rDPWorkspaceClosed'));
      ready.reject(uiMessage('rdp:rDPWorkspaceClosed'));
      const closingError = shutdown();
      if (closingError) console.error(closingError);
      desktop?.remove();
      void CloseRDP(grant.id).catch(() => {});
    };
  }, [grant, ready]);

  useEffect(() => {
    if (status !== 'connected') return;
    if (resolution !== 'dynamic') {
      const [width, height] = resolution.split('x').map(Number);
      ui.current?.resize(width, height);
      return;
    }
    let timer: ReturnType<typeof setTimeout>;
    const observer = new ResizeObserver(([entry]) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const { width, height } = entry.contentRect;
        if (width >= 320 && height >= 240)
          ui.current?.resize(Math.floor(width), Math.floor(height));
      }, 200);
    });
    observer.observe(container.current!);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [resolution, status]);

  useEffect(() => {
    if (visible && status === 'connected' && !document.activeElement?.closest('[role=tablist]'))
      focusDesktop();
  }, [visible, status]);
  useEffect(() => {
    ui.current?.setVisibility(visible && status === 'connected');
  }, [visible, status]);
  useEffect(() => {
    container.current?.querySelector('iron-remote-desktop')?.setAttribute('scale', scale);
  }, [scale, status]);

  return (
    <div className="rdp-view" ref={view} data-keyboard-target={keyboardTarget}>
      <div className="workspace-toolbar" hidden={fullscreen && toolbarCollapsed}>
        <Tooltip content={target}>
          <span className="session-target">{target}</span>
        </Tooltip>
        {environment && (
          <span className={`connection-environment ${environment}`}>
            {
              (
                {
                  production: translate('rdp:production'),
                  staging: translate('rdp:staging'),
                  development: translate('rdp:development'),
                } as Record<string, string>
              )[environment]
            }
          </span>
        )}
        <span className="session-state">
          {connectionStateLabel(pending ? 'connecting' : status)}
        </span>
      </div>
      {fullscreen && toolbarCollapsed && (
        <button
          className="rdp-toolbar-reveal"
          aria-label={translate('rdp:showRemoteDesktopToolbar')}
          onClick={() => {
            setToolbarCollapsed(false);
            requestAnimationFrame(() =>
              view.current?.querySelector<HTMLElement>('.rdp-toolbar button')?.focus(),
            );
          }}
        >
          {translate('rdp:showToolbar')}
        </button>
      )}
      <div
        className="rdp-toolbar"
        hidden={status !== 'connected' || !grant || (fullscreen && toolbarCollapsed)}
      >
        <Dropdown>
          <DropdownTrigger>
            <Button size="sm" variant="light" isDisabled={status !== 'connected'}>
              {translate('rdp:keyCombinations')}
            </Button>
          </DropdownTrigger>
          <DropdownMenu
            aria-label={translate('rdp:remoteKeyCombinations')}
            onAction={(key) => {
              if (key === 'secure') ui.current?.ctrlAltDel();
              else ui.current?.metaKey();
              focusDesktop();
            }}
          >
            <DropdownItem key="secure">Ctrl + Alt + Del</DropdownItem>
            <DropdownItem key="windows">{translate('rdp:windowsKey')}</DropdownItem>
          </DropdownMenu>
        </Dropdown>
        <label>
          {translate('rdp:localZoom')}
          <SelectControl
            aria-label={translate('rdp:localZoom')}
            value={scale}
            onChange={(e) => setScale(e.target.value as 'fit' | 'real')}
          >
            <option value="fit">{translate('rdp:fitWindow')}</option>
            <option value="real">{translate('rdp:actualPixels')}</option>
          </SelectControl>
        </label>
        <Popover
          isOpen={optionsOpen}
          onOpenChange={setOptionsOpen}
          portalContainer={view.current || undefined}
          placement="bottom-start"
        >
          <PopoverTrigger>
            <Button size="sm" variant="light">
              {translate('rdp:desktopOptions')}
            </Button>
          </PopoverTrigger>
          <PopoverContent
            role="dialog"
            aria-label={translate('rdp:desktopOptions')}
            className="rdp-options-panel"
          >
            <label>
              {translate('rdp:applicationShortcuts')}
              <SelectControl
                aria-label={translate('rdp:rDPApplicationShortcutRouting')}
                title={translate('rdp:keyCombinationsInterceptedByTheOperatingSystemAre')}
                value={keyboardTarget}
                onChange={(e) => {
                  setKeyboardTarget(e.target.value as 'local' | 'remote');
                  setOptionsOpen(false);
                  focusDesktop();
                }}
              >
                <option value="local">{translate('rdp:preferLocal')}</option>
                <option value="remote">{translate('rdp:sendToRemote')}</option>
              </SelectControl>
            </label>
            <label>
              {translate('rdp:remoteResolution')}
              <SelectControl
                aria-label={translate('rdp:remoteResolution')}
                disabled={status !== 'connected'}
                value={resolution}
                onChange={async (e) => {
                  const value = e.target.value;
                  try {
                    await onResolution(value);
                    setResolution(value);
                    actionSucceeded('resolution');
                  } catch (e) {
                    actionFailed('resolution', e);
                  }
                }}
              >
                <option value="dynamic">{translate('rdp:fitWindow')}</option>
                <option value="1280x800">1280 × 800</option>
                <option value="1920x1080">1920 × 1080</option>
              </SelectControl>
            </label>
            <div className="rdp-clipboard-option">
              <span>{translate('rdp:textClipboard')}</span>
              <Switch
                size="sm"
                aria-label={translate('rdp:textClipboard')}
                isSelected={clipboard}
                onValueChange={setClipboard}
              />
            </div>
            {clipboard !== activeClipboard && (
              <Button size="sm" variant="bordered" isDisabled={busy} onPress={onRetry}>
                {translate('rdp:applyAndReconnect')}
              </Button>
            )}
          </PopoverContent>
        </Popover>
        {activeClipboard && (
          <>
            <Button
              size="sm"
              variant="light"
              isDisabled={status !== 'connected'}
              onPress={() => {
                ui.current
                  ?.sendClipboardData()
                  .then(() => {
                    actionSucceeded('clipboard');
                    focusDesktop();
                  })
                  .catch((e) => actionFailed('clipboard', e));
              }}
            >
              {translate('rdp:pasteToRemote')}
            </Button>
            <Button
              size="sm"
              variant="light"
              isDisabled={status !== 'connected'}
              onPress={() => {
                ui.current
                  ?.saveRemoteClipboardData()
                  .then(() => {
                    actionSucceeded('clipboard');
                    focusDesktop();
                  })
                  .catch((e) => actionFailed('clipboard', e));
              }}
            >
              {translate('rdp:copyToLocal')}
            </Button>
          </>
        )}
        <Button
          size="sm"
          variant="light"
          onPress={() => {
            const operation = document.fullscreenElement
              ? document.exitFullscreen()
              : view.current?.requestFullscreen();
            operation
              ?.then(() => {
                actionSucceeded('fullscreen');
                focusDesktop();
              })
              .catch((e) => actionFailed('fullscreen', e));
          }}
        >
          {translate('rdp:toggleFullscreen')}
        </Button>
        <Button size="sm" variant="light" onPress={() => finish('disconnected')}>
          {translate('rdp:disconnect')}
        </Button>
        {fullscreen && (
          <Button
            size="sm"
            variant="light"
            onPress={() => {
              setToolbarCollapsed(true);
              focusDesktop();
            }}
          >
            {translate('rdp:collapseToolbar')}
          </Button>
        )}
      </div>
      <div className="rdp-canvas" ref={container} hidden={status !== 'connected' || !grant} />
      {status === 'connected' && (
        <ErrorNotice
          message={errorMessage(actionError?.message || '')}
          onDismiss={() => setActionError(undefined)}
        />
      )}
      {failure || !grant || ready.ended ? (
        <div className="rdp-failure" role="status">
          <h2>
            {failure
              ? translate('rdp:connectionIncomplete')
              : ready.ended
                ? connectionStateLabel(status)
                : pending
                  ? translate('rdp:connecting')
                  : translate('rdp:notYetConnected')}
          </h2>
          <p className="muted">{target}</p>
          <div className="button-row">
            <Button size="sm" color="primary" isDisabled={busy} onPress={onRetry}>
              {!grant && !failure ? translate('rdp:connect') : translate('rdp:retry')}
            </Button>
            <Button size="sm" variant="bordered" isDisabled={busy} onPress={onEdit}>
              {translate('rdp:editConnection')}
            </Button>
          </div>
          <label className="checkbox-label">
            <input
              type="checkbox"
              disabled={busy}
              checked={clipboard}
              onChange={(e) => setClipboard(e.target.checked)}
            />
            {translate('rdp:textClipboard')}
          </label>
          {((failure ? errorMessage(failure) : '') || error) && (
            <details>
              <summary>{translate('rdp:technicalDetails')}</summary>
              <p className="error" role="alert">
                {failure ? errorMessage(failure) : error}
              </p>
            </details>
          )}
        </div>
      ) : (
        <div className="session-status">
          <span>{connectionStateLabel(status)}</span>
          {error && (
            <details>
              <summary>{translate('rdp:technicalDetails')}</summary>
              <span role="alert" className="error">
                {error}
              </span>
            </details>
          )}
        </div>
      )}
    </div>
  );
});

export default RDPView;
