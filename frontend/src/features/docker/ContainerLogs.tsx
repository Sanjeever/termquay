import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@heroui/react';
import { t as translate } from '../../i18n/index.ts';
import { defaultLogViewOptions } from '../files/logView';
import LogSourcePane, { type LogSource } from '../logs/LogSourcePane';
import '../../styles/log-workspace.css';

export default function ContainerLogs({
  source,
  active,
  live,
  hidden,
  onAdd,
}: {
  source: LogSource;
  active: boolean;
  live: boolean;
  hidden: boolean;
  onAdd(): void;
}) {
  useTranslation();
  const [follow, setFollow] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [options, setOptions] = useState({ ...defaultLogViewOptions });
  const stableSource = useMemo(() => source, [source.id]);
  return (
    <div className="docker-log-page" hidden={hidden}>
      <div className="docker-log-toolbar">
        <Button
          size="sm"
          variant="light"
          isDisabled={!live}
          onPress={() => setRefresh((value) => value + 1)}
        >
          {translate('docker:refresh')}
        </Button>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={follow}
            disabled={!live}
            onChange={(event) => setFollow(event.target.checked)}
          />
          {translate('docker:follow')}
        </label>
        <Button size="sm" variant="light" onPress={onAdd}>
          {translate('docker:addToLogs')}
        </Button>
      </div>
      <div className="remote-log-filters">
        <input
          aria-label={translate('logs:filterReadContent')}
          placeholder={translate('logs:filterReadContent')}
          value={options.filter}
          maxLength={128}
          onChange={(event) =>
            setOptions((previous) => ({ ...previous, filter: event.target.value }))
          }
        />
      </div>
      <details className="docker-log-options">
        <summary>{translate('docker:logOptions')}</summary>
        <div className="remote-log-filters">
          {(['exclude', 'highlight'] as const).map((field) => (
            <input
              key={field}
              aria-label={translate(`logs:${field}`)}
              placeholder={translate(`logs:${field}`)}
              value={options[field]}
              maxLength={128}
              onChange={(event) =>
                setOptions((previous) => ({ ...previous, [field]: event.target.value }))
              }
            />
          ))}
        </div>
        <div className="docker-log-toolbar">
          {(['regex', 'case_sensitive', 'format_json'] as const).map((field) => (
            <label key={field} className="checkbox-label">
              <input
                type="checkbox"
                checked={options[field]}
                onChange={(event) =>
                  setOptions((previous) => ({ ...previous, [field]: event.target.checked }))
                }
              />
              {translate(
                field === 'regex'
                  ? 'logs:regex'
                  : field === 'case_sensitive'
                    ? 'logs:matchCase'
                    : 'logs:formatJSON',
              )}
            </label>
          ))}
        </div>
      </details>
      <LogSourcePane
        source={stableSource}
        active={active}
        live={live}
        follow={follow}
        refresh={refresh}
        options={options}
        compact
      />
    </div>
  );
}
