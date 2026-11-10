import { t as translate } from '../../i18n/index.ts';
import { useMessageState } from '../../i18n/useMessageState.ts';
import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import { Button } from '@heroui/react';
import {
  GetApplicationLock,
  ConfigureApplicationLock,
} from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import SelectControl from '../../components/SelectControl';

export default function ApplicationLockSettings() {
  useTranslation();
  const [minutes, setMinutes] = useState(0);
  const [system, setSystem] = useState(true);
  const [baseline, setBaseline] = useState('');
  const [error, setError] = useMessageState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let ended = false;
    const request = GetApplicationLock();
    request
      .then((value) => {
        if (!ended) {
          setMinutes(value.idle_minutes);
          setSystem(value.lock_on_system);
          setBaseline(JSON.stringify([value.idle_minutes, value.lock_on_system]));
        }
      })
      .catch((e) => {
        if (!ended) setError(e);
      });
    return () => {
      ended = true;
      request.cancel();
    };
  }, []);
  async function save() {
    setBusy(true);
    setError('');
    try {
      const value = await ConfigureApplicationLock(minutes, system);
      setBaseline(JSON.stringify([value.idle_minutes, value.lock_on_system]));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="settings-field">
      <label className="form-field">
        {translate('settings:lockWhenIdle')}
        <SelectControl
          value={minutes}
          disabled={busy || !baseline}
          onChange={(event) => setMinutes(Number(event.target.value))}
        >
          {[0, 1, 5, 10, 15, 30, 60, 120].map((value) => (
            <option key={value} value={value}>
              {value ? translate('settings:minutes', { value1: value }) : translate('settings:off')}
            </option>
          ))}
        </SelectControl>
      </label>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={system}
          disabled={busy || !baseline}
          onChange={(event) => setSystem(event.target.checked)}
        />
        {translate('settings:lockOnSystemLockOrSleep')}
      </label>
      <Button
        size="sm"
        variant="light"
        isLoading={busy}
        isDisabled={!baseline || baseline === JSON.stringify([minutes, system])}
        onPress={() => void save()}
      >
        {translate('settings:saveApplicationLockSettings')}
      </Button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
