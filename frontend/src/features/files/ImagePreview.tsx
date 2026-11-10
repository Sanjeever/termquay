import { eventError, errorMessage } from '../../lib/errors.ts';
import { t as translate } from '../../i18n/index.ts';
import { useTranslation } from 'react-i18next';
import Tooltip from '../../components/Tooltip';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@heroui/react';
import useImageResource from './useImageResource';
import ErrorNotice from '../../components/ErrorNotice';
import { bytes } from './transferFormat';

export default function ImagePreview({
  workspace,
  path,
  visible,
  onDownload,
  onText,
}: {
  workspace: string;
  path: string;
  visible: boolean;
  onDownload(): void;
  onText(): void;
}) {
  useTranslation();
  const image = useImageResource(workspace, path, visible);
  const [zoom, setZoom] = useState<number | 'fit'>('fit');
  const stage = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState<{ width: number; height: number }>();
  const metadata = image.resource?.metadata;
  const width = natural?.width || metadata?.width || 0;
  const height = natural?.height || metadata?.height || 0;
  useEffect(() => {
    if (visible) stage.current?.focus();
  }, [visible]);
  const scale = (delta: number) =>
    setZoom((value) => Math.max(10, Math.min(400, (value === 'fit' ? 100 : value) + delta)));
  return (
    <div className="image-preview">
      <div className="image-toolbar">
        <Button
          size="sm"
          variant="light"
          onPress={() => setZoom('fit')}
          aria-pressed={zoom === 'fit'}
        >
          {translate('files:fitWindow')}
        </Button>
        <Button size="sm" variant="light" onPress={() => setZoom(100)} aria-pressed={zoom === 100}>
          100%
        </Button>
        <button
          className="icon-button"
          aria-label={translate('files:zoomOutImage')}
          onClick={() => scale(-25)}
        >
          −
        </button>
        <span>{zoom === 'fit' ? translate('files:fit') : `${zoom}%`}</span>
        <button
          className="icon-button"
          aria-label={translate('files:zoomInImage')}
          onClick={() => scale(25)}
        >
          +
        </button>
        <div className="status-spacer" />
        <Button size="sm" variant="light" onPress={image.retry}>
          {translate('files:reload')}
        </Button>
        <Button size="sm" variant="light" onPress={onDownload}>
          {translate('files:downloadOriginalImage')}
        </Button>
        <Button size="sm" variant="light" onPress={onText}>
          {translate('files:openAsText')}
        </Button>
      </div>
      <ErrorNotice message={errorMessage(eventError(image))}>
        <button className="session-tool" onClick={image.retry}>
          {translate('files:retryReading2')}
        </button>
      </ErrorNotice>
      <div
        className={`image-stage${zoom === 'fit' ? ' image-fit' : ''}`}
        ref={stage}
        tabIndex={0}
        data-image-preview
        aria-label={translate('files:imagePreview')}
        onKeyDown={(event) => {
          if (event.isDefaultPrevented() || event.nativeEvent.isComposing) return;
          if (event.key === '+' || event.key === '=') {
            event.preventDefault();
            scale(25);
          }
          if (event.key === '-') {
            event.preventDefault();
            scale(-25);
          }
          if (event.key === '0') {
            event.preventDefault();
            setZoom('fit');
          }
        }}
      >
        {image.resource && !errorMessage(eventError(image)) ? (
          <img
            src={image.resource.url}
            alt={path.split('/').pop() || translate('files:remoteImage')}
            draggable={false}
            style={
              zoom === 'fit'
                ? undefined
                : { width: Math.round((width * zoom) / 100), maxWidth: 'none', maxHeight: 'none' }
            }
            onLoad={(event) =>
              setNatural({
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              })
            }
            onError={image.decodeFailed}
          />
        ) : (
          !errorMessage(eventError(image)) && (
            <span className="muted" role="status">
              {translate('files:readingImage')}
            </span>
          )
        )}
      </div>
      <div className="editor-status">
        <Tooltip content={path}>
          <span className="editor-path">{path}</span>
        </Tooltip>
        {metadata && (
          <>
            <span>
              {width} × {height}
            </span>
            <span>{bytes(metadata.size)}</span>
            <span>
              {metadata.format === 'gif'
                ? translate('files:gIFFirstFrame')
                : metadata.format.toUpperCase()}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
