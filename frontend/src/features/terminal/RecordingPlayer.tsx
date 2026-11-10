import Modal from '../../components/Modal';
import { t as translate } from '../../i18n/index.ts';
import { useMessageState } from '../../i18n/useMessageState.ts';
import { useTranslation } from 'react-i18next';
import { useEffect, useRef, useState } from 'react';
import { Button, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react';
import { create, type Player } from 'asciinema-player';
import 'asciinema-player/dist/bundle/asciinema-player.css';
import {
  ChooseTerminalRecording,
  ReadTerminalRecording,
} from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { TerminalRecording } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import SelectControl from '../../components/SelectControl';
import { Events } from '@wailsio/runtime';
import { errorMessage } from '../../lib/errors';

export default function RecordingPlayer({
  terminal,
  onClose,
}: {
  terminal?: string;
  onClose(): void;
}) {
  useTranslation();
  const [recording, setRecording] = useState<TerminalRecording>();
  const [error, setError] = useMessageState('');
  const [speed, setSpeed] = useState(1);
  const [skipIdle, setSkipIdle] = useState(true);
  const [busy, setBusy] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<Player>();
  const resume = useRef<{ recording: TerminalRecording; position: number; playing: boolean }>();
  const mounted = useRef(true);
  const pending = useRef<ReturnType<typeof ChooseTerminalRecording>>();
  const closed = useRef(onClose);
  closed.current = onClose;
  useEffect(() => {
    mounted.current = true;
    let ended = false;
    setBusy(true);
    const request = terminal ? ReadTerminalRecording(terminal) : ChooseTerminalRecording();
    pending.current = request;
    request
      .then((value) => {
        if (!ended) {
          if (value.content) setRecording(value);
          else closed.current();
        }
      })
      .catch((e) => {
        if (!ended) setError(e);
      })
      .finally(() => {
        if (!ended) setBusy(false);
      });
    return () => {
      ended = true;
      mounted.current = false;
      pending.current?.cancel();
    };
  }, [terminal]);
  useEffect(() => {
    if (!recording || !host.current) return;
    setError('');
    let ended = false,
      playing = false;
    try {
      const value = create({ data: recording.content }, host.current, {
        autoPlay: false,
        preload: true,
        speed,
        idleTimeLimit: skipIdle ? 2 : undefined,
        fit: 'width',
        controls: true,
        terminalFontSize: '13px',
        logger: {
          log() {},
          debug() {},
          info() {},
          warn() {},
          error(...args: unknown[]) {
            if (mounted.current && !ended) setError(args.map(errorMessage).join(' '));
          },
        },
      });
      player.current = value;
      value.addEventListener('playing', () => {
        playing = true;
      });
      value.addEventListener('pause', () => {
        playing = false;
      });
      value.addEventListener('ended', () => {
        playing = false;
      });
      const previous = resume.current;
      if (previous?.recording === recording && previous.position > 0)
        value
          .seek(previous.position)
          .then(() => {
            if (!ended && previous.playing) return value.play();
          })
          .catch((e) => {
            if (!ended) setError(e);
          });
      return () => {
        ended = true;
        resume.current = { recording, position: value.getCurrentTime(), playing };
        value.dispose();
        player.current = undefined;
      };
    } catch (e) {
      setError(e);
    }
  }, [recording, speed, skipIdle]);
  useEffect(() => {
    const hide = () => {
      if (document.visibilityState !== 'visible')
        player.current?.pause().catch((e) => {
          if (mounted.current) setError(e);
        });
    };
    const off = Events.On(Events.Types.Common.WindowMinimise, () => {
      player.current?.pause().catch((e) => {
        if (mounted.current) setError(e);
      });
    });
    document.addEventListener('visibilitychange', hide);
    return () => {
      document.removeEventListener('visibilitychange', hide);
      off();
    };
  }, []);
  async function choose() {
    setBusy(true);
    setError('');
    const request = ChooseTerminalRecording();
    pending.current = request;
    try {
      const value = await request;
      if (mounted.current && value.content) setRecording(value);
    } catch (e) {
      if (mounted.current) setError(e);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <Modal isOpen onClose={onClose} size="5xl" className="app-dialog" scrollBehavior="inside">
      <ModalContent>
        <ModalHeader>
          {translate('terminal:terminalRecordingPlayback')}
          {recording && ` · ${recording.name}`}
        </ModalHeader>
        <ModalBody>
          <div className="button-row">
            <Button size="sm" variant="light" isLoading={busy} onPress={() => void choose()}>
              {recording
                ? translate('terminal:openAnotherRecording')
                : translate('terminal:selectCastFile')}
            </Button>
            {recording && (
              <>
                <SelectControl
                  aria-label={translate('terminal:playbackSpeed')}
                  value={speed}
                  onChange={(event) => setSpeed(Number(event.target.value))}
                >
                  {[0.5, 1, 1.5, 2, 4].map((value) => (
                    <option key={value} value={value}>
                      {value}×
                    </option>
                  ))}
                </SelectControl>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={skipIdle}
                    onChange={(event) => setSkipIdle(event.target.checked)}
                  />
                  {translate('terminal:skipLongIdlePeriods')}
                </label>
              </>
            )}
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="recording-player" ref={host} />
        </ModalBody>
        <ModalFooter>
          <Button variant="light" onPress={onClose}>
            {translate('terminal:close')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
