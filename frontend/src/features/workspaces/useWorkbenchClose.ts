import { message as uiMessage } from '../../i18n/messages.ts';
import { useMessageState } from '../../i18n/useMessageState.ts';
import { useEffect, useRef, useState } from 'react';
import { Events } from '@wailsio/runtime';
import {
  DiscardAndQuit,
  RestartForUpdate,
  SetFrontendReady,
} from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';

import type { Workspace } from './workspace';

export default function useWorkbenchClose(options: {
  locked?: boolean;
  workspaces: Workspace[];
  activeTasks: number;
  flushLocalState(): Promise<void>;
  beforeQuit(): void;
  remove(id: string, keyboard: boolean): void;
  select(id: string): void;
  onError(message: unknown): void;
}) {
  const [closing, setClosing] = useState('');
  const [quitConfirm, setQuitConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useMessageState('');
  const [persistenceError, setPersistenceError] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const keyboard = useRef(false);
  const restartUpdate = useRef(false);
  const autoQuitting = useRef(false);
  const latest = useRef(options);
  latest.current = options;
  const nativeClose = useRef<() => void>(() => {});

  async function persist() {
    try {
      await latest.current.flushLocalState();
    } catch (error) {
      setPersistenceError(true);
      throw error;
    }
  }

  async function finishExit() {
    if (restartUpdate.current) {
      setRestarting(true);
      try {
        await RestartForUpdate();
      } catch (error) {
        setRestarting(false);
        throw error;
      }
    } else await DiscardAndQuit();
  }

  nativeClose.current = () => {
    if (latest.current.locked) return;
    if (autoQuitting.current) return;
    latest.current.beforeQuit();
    if (
      latest.current.activeTasks ||
      latest.current.workspaces.some(
        (workspace) => workspace.local && !workspace.local.terminal.current?.ended(),
      ) ||
      latest.current.workspaces.some((workspace) => workspace.ssh?.current?.hasDirty())
    ) {
      setQuitConfirm(true);
      return;
    }
    autoQuitting.current = true;
    void (async () => {
      try {
        await persist();
        await finishExit();
      } catch (error) {
        setError(error);
        setQuitConfirm(true);
      } finally {
        autoQuitting.current = false;
      }
    })();
  };

  useEffect(() => {
    const off = Events.On('app:close-requested', () => nativeClose.current());
    SetFrontendReady().catch((error) =>
      latest.current.onError(
        uiMessage('workspaces:couldNotInitializeQuitCoordination', { value1: error }),
      ),
    );
    return off;
  }, []);

  function requestClose(id: string, byKeyboard: boolean) {
    keyboard.current = byKeyboard;
    const workspace = latest.current.workspaces.find((workspace) => workspace.id === id);
    if (
      workspace?.ssh?.current?.hasDirty() ||
      (workspace?.local && !workspace.local.terminal.current?.ended())
    )
      setClosing(id);
    else latest.current.remove(id, byKeyboard);
  }

  function cancel() {
    if (saving) return;
    restartUpdate.current = false;
    setClosing('');
    setQuitConfirm(false);
    setError('');
    setPersistenceError(false);
  }

  async function discard() {
    if (!quitConfirm) {
      latest.current.remove(closing, keyboard.current);
      setClosing('');
      return;
    }
    setSaving(true);
    try {
      if (!persistenceError) await persist();
      await finishExit();
    } catch (error) {
      setError(error);
    } finally {
      setSaving(false);
    }
  }

  async function save() {
    setSaving(true);
    setError('');
    try {
      const targets = latest.current.workspaces.filter((workspace) =>
        quitConfirm ? workspace.ssh?.current?.hasDirty() : workspace.id === closing,
      );
      for (const workspace of targets) {
        if (!(await workspace.ssh?.current?.saveAll())) {
          latest.current.select(workspace.id);
          setError(uiMessage('workspaces:savingIsIncompleteReturnToEditingAndResolve'));
          return;
        }
      }
      if (quitConfirm) {
        await persist();
        await finishExit();
      } else {
        latest.current.remove(closing, keyboard.current);
        setClosing('');
      }
    } catch (error) {
      setError(error);
    } finally {
      setSaving(false);
    }
  }

  function restart() {
    restartUpdate.current = true;
    nativeClose.current();
  }

  return {
    closing,
    quitConfirm,
    saving,
    error,
    persistenceError,
    restarting,
    requestClose,
    cancel,
    discard,
    save,
    restart,
    activeTasks: quitConfirm ? options.activeTasks : 0,
    localTerminals: options.workspaces.flatMap((workspace) =>
      (quitConfirm || workspace.id === closing) &&
      workspace.local &&
      !workspace.local.terminal.current?.ended()
        ? [{ id: workspace.id, name: workspace.name, directory: workspace.local.directory }]
        : [],
    ),
    hasDirty: options.workspaces.some(
      (workspace) =>
        (quitConfirm || workspace.id === closing) && workspace.ssh?.current?.hasDirty(),
    ),
  };
}
