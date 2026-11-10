import { t as translate } from '../../i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { lazy, Suspense, useEffect, useState, type ComponentProps } from 'react';
import { Button } from '@heroui/react';
import type CodeEditorComponent from './CodeEditor';
import { isMarkdownPath } from './fileTypes';
import { eventShortcut } from '../../lib/shortcuts';

const MarkdownPreview = lazy(() => import('./MarkdownPreview'));
const CodeEditor = lazy(() => import('./CodeEditor'));

export default function TextDocument({
  workspace,
  anchor,
  onNavigate,
  ...editor
}: ComponentProps<typeof CodeEditorComponent> & {
  workspace: string;
  anchor?: { hash: string; sequence: number };
  onNavigate(path: string, hash: string): void;
}) {
  useTranslation();
  const markdown = isMarkdownPath(editor.path);
  const [mode, setMode] = useState<'source' | 'preview' | 'split'>(
    editor.jumpTo ? 'source' : 'preview',
  );
  const [sourceOpened, setSourceOpened] = useState(!!editor.jumpTo);
  const [previewOpened, setPreviewOpened] = useState(!editor.jumpTo);
  useEffect(() => {
    if (editor.jumpTo) {
      setSourceOpened(true);
      setMode('source');
    }
  }, [editor.jumpTo?.sequence]);
  if (!markdown)
    return (
      <Suspense
        fallback={
          <div className="view-loading" role="status">
            {translate('files:loadingEditor')}
          </div>
        }
      >
        <CodeEditor {...editor} />
      </Suspense>
    );
  return (
    <div
      className="text-document"
      onKeyDown={(event) => {
        if (!event.defaultPrevented && eventShortcut(event.nativeEvent) === 'Mod+KeyS') {
          event.preventDefault();
          editor.onSave();
        }
      }}
    >
      <div className="markdown-toolbar">
        <div role="group" aria-label={translate('files:markdownView')}>
          {(
            [
              ['source', translate('files:source')],
              ['preview', translate('files:preview')],
              ['split', translate('files:split')],
            ] as const
          ).map(([id, name]) => (
            <button
              key={id}
              type="button"
              aria-pressed={mode === id}
              onClick={() => {
                if (id !== 'preview') setSourceOpened(true);
                if (id !== 'source') setPreviewOpened(true);
                setMode(id);
              }}
            >
              {name}
            </button>
          ))}
        </div>
        <div className="status-spacer" />
        {mode === 'preview' && (
          <>
            <Button
              size="sm"
              variant="light"
              isDisabled={editor.saving || !editor.dirty}
              isLoading={editor.saving}
              onPress={editor.onSave}
            >
              {translate('files:save')}
            </Button>
            <Button size="sm" variant="light" isDisabled={editor.demo} onPress={editor.onDownload}>
              {translate('files:downloadCurrentContent')}
            </Button>
          </>
        )}
      </div>
      <div className={`markdown-panes markdown-${mode}`}>
        <div className="markdown-source" hidden={mode === 'preview'}>
          {sourceOpened && (
            <Suspense
              fallback={
                <div className="view-loading" role="status">
                  {translate('files:loadingEditor')}
                </div>
              }
            >
              <CodeEditor {...editor} visible={editor.visible && mode !== 'preview'} />
            </Suspense>
          )}
        </div>
        <div className="markdown-rendered" hidden={mode === 'source'}>
          {previewOpened && (
            <Suspense
              fallback={
                <div className="view-loading" role="status">
                  {translate('files:loadingMarkdownPreview')}
                </div>
              }
            >
              <MarkdownPreview
                workspace={workspace}
                path={editor.path}
                content={editor.content}
                visible={editor.visible && mode !== 'source'}
                focusOnShow={editor.focusOnShow && mode === 'preview'}
                anchor={anchor}
                onNavigate={onNavigate}
              />
            </Suspense>
          )}
        </div>
      </div>
    </div>
  );
}
