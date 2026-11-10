import { t as translate, currentLocale } from '../../i18n/index.ts';
import { eventError, errorMessage } from '../../lib/errors.ts';
import { useTranslation } from 'react-i18next';
import Tooltip from '../../components/Tooltip';
import type useConnectionLatency from './useConnectionLatency';
import Icon from '../../components/Icon';

export default function ConnectionLatency({
  name,
  measurement,
  onRefresh,
  demo = false,
}: {
  name: string;
  measurement: ReturnType<typeof useConnectionLatency>['measurements'][string];
  onRefresh(): void;
  demo?: boolean;
}) {
  useTranslation();
  const result = measurement?.result;
  const milliseconds =
    result &&
    (result.milliseconds < 1
      ? Math.max(0.1, Math.round(result.milliseconds * 10) / 10)
      : Math.round(result.milliseconds));
  const label =
    result?.status === 'ok'
      ? `${milliseconds} ms`
      : result?.status === 'timeout'
        ? translate('connections:probeTimedOut')
        : result?.status === 'jump_required'
          ? translate('connections:jumpHostConnectionRequired')
          : result
            ? translate('connections:probeFailed')
            : '—';
  const tone =
    result?.status === 'ok'
      ? milliseconds! < 100
        ? 'fast'
        : milliseconds! < 300
          ? 'moderate'
          : 'slow'
      : result?.status === 'jump_required'
        ? 'unknown'
        : result
          ? 'slow'
          : 'unknown';
  const title = [
    translate('connections:tCPConnectionTimeIncludingDNSAndProxyOr'),
    errorMessage(eventError(result)),
    measurement?.checkedAt &&
      translate('connections:lastMeasured', {
        value1: new Date(measurement.checkedAt).toLocaleTimeString(currentLocale()),
      }),
    measurement?.refreshing
      ? translate('connections:refreshing')
      : translate('connections:clickToRefreshThisConnection'),
  ]
    .filter(Boolean)
    .join('\n');
  return (
    <Tooltip content={demo ? translate('connections:demoSample') : title}>
      <button
        className={`connection-latency latency-${tone}`}
        aria-label={translate('connections:latency', {
          value1: name,
          value2: label,
          value3: demo
            ? translate('connections:demoSample2')
            : translate('connections:clickToRefresh'),
        })}
        aria-busy={measurement?.refreshing || undefined}
        aria-disabled={demo}
        draggable={false}
        onDragStart={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onClick={(event) => {
          event.stopPropagation();
          if (!demo) onRefresh();
        }}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        <Icon
          name="refresh"
          width="11"
          height="11"
          className={measurement?.refreshing ? 'latency-refreshing' : 'latency-idle'}
        />
        <span>{label}</span>
      </button>
    </Tooltip>
  );
}
