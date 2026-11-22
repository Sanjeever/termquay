import { t as translate } from '../../i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import ResizeHandle from '../../components/layout/ResizeHandle';

export default function WorkspacePanes({
  split,
  direction = 'columns',
  maximized,
  ratio,
  onRatio,
  tabHeight = 36,
  children,
}: {
  split: boolean;
  direction?: 'rows' | 'columns';
  maximized: boolean;
  ratio: number;
  onRatio(value: number): void;
  tabHeight?: number;
  children: ReactNode;
}) {
  useTranslation();
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 100, height: 100 });
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setSize({
        width: Math.max(100, entry.contentRect.width),
        height: Math.max(100, entry.contentRect.height - 2 * tabHeight),
      }),
    );
    observer.observe(host.current!);
    return () => observer.disconnect();
  }, [tabHeight]);
  return (
    <div
      ref={host}
      className={`workspace-panes ${direction === 'rows' ? 'workspace-panes-rows' : ''}`}
      style={{
        gridTemplateColumns:
          split && !maximized && direction === 'columns'
            ? `minmax(0,${ratio}fr) 5px minmax(0,${100 - ratio}fr)`
            : 'minmax(0,1fr)',
        gridTemplateRows:
          split && !maximized && direction === 'rows'
            ? `${tabHeight}px minmax(0,${ratio}fr) 5px ${tabHeight}px minmax(0,${100 - ratio}fr)`
            : `${tabHeight}px minmax(0,1fr)`,
      }}
    >
      {children}
      {split && !maximized && (
        <div className="workspace-pane-separator">
          <ResizeHandle
            label={translate('files:splitPaneRatio')}
            horizontal={direction === 'rows'}
            value={ratio}
            min={20}
            max={80}
            pixelsPerUnit={(direction === 'rows' ? size.height : size.width) / 100}
            onChange={onRatio}
          />
        </div>
      )}
    </div>
  );
}
