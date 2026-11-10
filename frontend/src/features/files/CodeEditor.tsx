import { t as translate, currentLocale } from '../../i18n/index.ts';
import { useMessageState } from '../../i18n/useMessageState.ts';
import { useTranslation } from 'react-i18next';

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { DropdownTrigger, DropdownMenu, DropdownSection, DropdownItem } from '@heroui/react';
import { Dropdown } from '../../components/Popover';
import Tooltip from '../../components/Tooltip';
import { Compartment, EditorState, StateEffect, StateField, Transaction } from '@codemirror/state';
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
} from '@codemirror/view';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  undo,
  redo,
  undoDepth,
  redoDepth,
  invertedEffects,
} from '@codemirror/commands';
import {
  searchKeymap,
  highlightSelectionMatches,
  openSearchPanel,
  closeSearchPanel,
  searchPanelOpen,
  getSearchQuery,
  setSearchQuery,
} from '@codemirror/search';
import { bracketMatching, foldGutter, indentOnInput } from '@codemirror/language';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { diagnosticCount, openLintPanel, setDiagnostics } from '@codemirror/lint';
import { showMinimap } from '@replit/codemirror-minimap';
import Icon from '../../components/Icon';
import {
  detectEditorLanguage,
  editorLanguages,
  loadEditorLanguage,
  type EditorLanguageID,
} from './editorLanguage';
import { editorIntelligence, startCompletion } from './editorIntelligence';
import SelectControl from '../../components/SelectControl';
import ErrorNotice from '../../components/ErrorNotice';
import { eventShortcut, shortcutLabel } from '../../lib/shortcuts';
import { useAppearance } from '../settings/AppearanceProvider';
import { editorTheme } from './editorTheme';
import { editorEncodings, type EditorFormat } from './editorFormat';

const changeFormat = StateEffect.define<EditorFormat>();
const formatState = StateField.define<EditorFormat>({
  create: () => ({ encoding: 'UTF-8', line_ending: 'LF', bom: false }),
  update: (value, transaction) =>
    transaction.effects.reduce(
      (current, effect) => (effect.is(changeFormat) ? effect.value : current),
      value,
    ),
  provide: (field) => [
    EditorState.readOnly.from(field, (value) => value.line_ending === 'mixed'),
    EditorView.editable.from(field, (value) => value.line_ending !== 'mixed'),
  ],
});

export default function CodeEditor({
  path,
  content,
  format,
  visible,
  saving,
  dirty,
  reloadEpoch = 0,
  onChange,
  onSave,
  onReload,
  onDownload,
  onHistory,
  focusOnShow = true,
  jumpTo,
  demo = false,
  completionShortcut = 'Alt+Slash',
}: {
  path: string;
  content: string;
  format: EditorFormat;
  visible: boolean;
  saving: boolean;
  dirty: boolean;
  reloadEpoch?: number;
  onChange(value: string, format: EditorFormat): void;
  onSave(): void;
  onReload(encoding: string): void;
  onDownload(): void;
  focusOnShow?: boolean;
  jumpTo?: { line: number; sequence: number };
  demo?: boolean;
  completionShortcut?: string;
  onHistory?(): void;
}) {
  useTranslation();
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>();
  const { appearance, dark } = useAppearance();
  const locale = currentLocale();
  const localization = useRef(new Compartment());
  const theme = useRef(new Compartment());
  const map = useRef(new Compartment());
  const wrapping = useRef(new Compartment());
  const language = useRef(new Compartment());
  const intelligence = useRef(new Compartment());
  const syncing = useRef(false);
  const mixedContent = useRef(content);
  function editorContent(state: EditorState) {
    const format = state.field(formatState);
    return format.line_ending === 'mixed'
      ? mixedContent.current
      : format.line_ending === 'CRLF'
        ? state.doc.toString().replace(/\n/g, '\r\n')
        : state.doc.toString();
  }
  const [position, setPosition] = useState({ line: 1, column: 1 });
  const [historyState, setHistoryState] = useState({ undo: 0, redo: 0 });
  const [fontSize, setFontSize] = useState(() =>
    Math.max(10, Math.min(24, Number(localStorage.getItem('termquay.editor.font-size')) || 14)),
  );
  const [minimap, setMinimap] = useState(
    () => localStorage.getItem('termquay.editor.minimap') !== 'false',
  );
  const [wrap, setWrap] = useState(false);
  const [wide, setWide] = useState(false);
  const [error, setError] = useMessageState('');
  const [languageOverride, setLanguageOverride] = useState<EditorLanguageID | 'auto'>('auto');
  const [languageError, setLanguageError] = useMessageState('');
  const [diagnosticError, setDiagnosticError] = useMessageState('');
  const [problems, setProblems] = useState(0);
  const [languageEpoch, setLanguageEpoch] = useState(0);
  const [diagnosticEpoch, setDiagnosticEpoch] = useState(0);
  const mode = languageOverride === 'auto' ? detectEditorLanguage(path, content) : languageOverride;
  const callbacks = useRef({ onChange, onSave, completionShortcut });
  callbacks.current = { onChange, onSave, completionShortcut };
  const localizedEditor = useCallback(() => {
    return [
      EditorState.phrases.of({
        Find: translate('files:find'),
        Replace: translate('files:replace'),
        next: translate('files:next'),
        previous: translate('files:previous'),
        all: translate('files:all'),
        'match case': translate('files:matchCase'),
        regexp: translate('files:regexp'),
        'by word': translate('files:byWord'),
        replace: translate('files:replace'),
        'replace all': translate('files:replaceAll'),
        close: translate('files:close'),
        'current match': translate('files:currentMatch'),
        'on line': translate('files:onLine'),
        'Go to line': translate('files:cmGoToLine'),
        go: translate('files:cmGo'),
        'replaced $ matches': translate('files:cmReplacedMatches'),
        'replaced match on line $': translate('files:cmReplacedMatchLine'),
        Completions: translate('files:cmCompletions'),
        'folded code': translate('files:cmFoldedCode'),
        to: translate('files:cmTo'),
        unfold: translate('files:cmUnfold'),
        'Folded lines': translate('files:cmFoldedLines'),
        'Unfolded lines': translate('files:cmUnfoldedLines'),
        'Fold line': translate('files:cmFoldLine'),
        'Unfold line': translate('files:cmUnfoldLine'),
        Diagnostics: translate('files:cmDiagnostics'),
        'No diagnostics': translate('files:cmNoDiagnostics'),
        'Control character': translate('files:cmControlCharacter'),
      }),
      EditorView.contentAttributes.of({
        'aria-label': translate('files:edit', { value1: path }),
        spellcheck: 'false',
      }),
    ];
  }, [path]);
  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    const searchOpen = searchPanelOpen(editor.state);
    const query = searchOpen ? getSearchQuery(editor.state) : undefined;
    const focused = document.activeElement as HTMLElement | null;
    const restoreFocus = focused && !editor.dom.contains(focused);
    if (searchOpen) closeSearchPanel(editor);
    editor.dispatch({ effects: localization.current.reconfigure(localizedEditor()) });
    if (searchOpen) {
      openSearchPanel(editor);
      if (query) editor.dispatch({ effects: setSearchQuery.of(query) });
      if (restoreFocus) focused.focus({ preventScroll: true });
    }
  }, [locale, path, reloadEpoch, localizedEditor]);
  /* oxlint-disable react/exhaustive-deps -- Document identity or explicit reload owns the editor; content, format, locale and theme are synchronized without destroying history. */
  useEffect(() => {
    const editor = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: content,
        extensions: [
          formatState.init(() => format),
          lineNumbers(),
          history(),
          drawSelection(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          bracketMatching(),
          closeBrackets(),
          foldGutter(),
          indentOnInput(),
          highlightSelectionMatches(),
          language.current.of([]),
          intelligence.current.of([]),
          EditorView.domEventHandlers({
            keydown(event, editor) {
              if (
                !editor.composing &&
                !event.isComposing &&
                callbacks.current.completionShortcut &&
                eventShortcut(event) === callbacks.current.completionShortcut &&
                !editor.state.facet(EditorState.readOnly)
              ) {
                event.preventDefault();
                startCompletion(editor);
                return true;
              }
              return false;
            },
          }),
          invertedEffects.of((transaction) =>
            transaction.effects.some((effect) => effect.is(changeFormat))
              ? [changeFormat.of(transaction.startState.field(formatState))]
              : [],
          ),
          keymap.of([
            {
              key: 'Mod-s',
              run: () => {
                callbacks.current.onSave();
                return true;
              },
            },
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
            indentWithTab,
          ]),
          localization.current.of(localizedEditor()),

          EditorView.updateListener.of((update) => {
            const changedFormat = update.transactions.some((transaction) =>
              transaction.effects.some((effect) => effect.is(changeFormat)),
            );
            if ((update.docChanged || changedFormat) && !syncing.current)
              callbacks.current.onChange(
                editorContent(update.state),
                update.state.field(formatState),
              );
            if (update.docChanged || update.selectionSet) {
              const head = update.state.selection.main.head;
              const line = update.state.doc.lineAt(head);
              setPosition({ line: line.number, column: head - line.from + 1 });
            }
            setHistoryState((previous) => {
              const next = { undo: undoDepth(update.state), redo: redoDepth(update.state) };
              return next.undo === previous.undo && next.redo === previous.redo ? previous : next;
            });
            setProblems(diagnosticCount(update.state));
          }),
          theme.current.of(editorTheme(dark)),
          map.current.of([]),
          wrapping.current.of([]),
        ],
      }),
    });
    view.current = editor;
    setHistoryState({ undo: 0, redo: 0 });
    return () => {
      editor.destroy();
      view.current = undefined;
    };
  }, [path, reloadEpoch]);
  /* oxlint-enable react/exhaustive-deps */
  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    let ended = false;
    setLanguageError('');
    void loadEditorLanguage(mode)
      .then((extension) => {
        if (!ended && view.current === editor)
          editor.dispatch({ effects: language.current.reconfigure(extension) });
      })
      .catch((error) => {
        if (!ended) setLanguageError(error);
      });
    return () => {
      ended = true;
    };
  }, [mode, path, reloadEpoch, languageEpoch, setLanguageError]);
  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    setDiagnosticError('');
    if (diagnosticCount(editor.state)) editor.dispatch(setDiagnostics(editor.state, []));
    editor.dispatch({
      effects: intelligence.current.reconfigure(
        editorIntelligence(mode, setDiagnosticError, visible),
      ),
    });
  }, [mode, visible, path, reloadEpoch, diagnosticEpoch, locale, setDiagnosticError]);
  useEffect(() => {
    view.current?.dispatch({ effects: theme.current.reconfigure(editorTheme(dark)) });
    view.current?.requestMeasure();
  }, [dark, appearance.monoFont, appearance.customMonoFont, path, reloadEpoch]);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWide(entry.contentRect.width >= 600));
    observer.observe(host.current!);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    view.current?.dispatch({
      effects: map.current.reconfigure(
        visible && wide && minimap
          ? showMinimap.of({
              create: () => ({ dom: document.createElement('div') }),
              displayText: 'blocks',
              showOverlay: 'always',
            })
          : [],
      ),
    });
  }, [visible, wide, minimap, reloadEpoch]);
  useEffect(() => {
    view.current?.dispatch({
      effects: wrapping.current.reconfigure(wrap ? EditorView.lineWrapping : []),
    });
  }, [wrap, reloadEpoch]);
  /* oxlint-disable react/exhaustive-deps -- The three serialized format fields define equality; a new format object alone must not resynchronize the editor. */
  useEffect(() => {
    const editor = view.current;
    if (
      !editor ||
      (editorContent(editor.state) === content &&
        JSON.stringify(editor.state.field(formatState)) === JSON.stringify(format))
    )
      return;
    if (format.line_ending === 'mixed') mixedContent.current = content;
    syncing.current = true;
    try {
      editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: content },
        effects: changeFormat.of(format),
        annotations: Transaction.addToHistory.of(false),
      });
    } finally {
      syncing.current = false;
    }
  }, [content, format.encoding, format.line_ending, format.bom]);
  /* oxlint-enable react/exhaustive-deps */
  useEffect(() => {
    if (visible) {
      view.current?.requestMeasure();
      if (focusOnShow && !document.activeElement?.closest('[role=tablist]')) view.current?.focus();
    }
  }, [visible, focusOnShow]);
  const jumpLine = jumpTo?.line;
  const jumpSequence = jumpTo?.sequence;
  useEffect(() => {
    const editor = view.current;
    if (!editor || !visible || jumpLine === undefined) return;
    const line = editor.state.doc.line(Math.max(1, Math.min(editor.state.doc.lines, jumpLine)));
    editor.dispatch({
      selection: { anchor: line.from },
      effects: EditorView.scrollIntoView(line.from, { y: 'center' }),
    });
    editor.focus();
  }, [jumpLine, jumpSequence, visible, reloadEpoch]);
  function updateFormat(value: Partial<EditorFormat>) {
    const editor = view.current;
    if (editor) {
      const next = { ...editor.state.field(formatState), ...value };
      if (JSON.stringify(next) === JSON.stringify(editor.state.field(formatState))) return;
      editor.dispatch({
        effects: changeFormat.of(next),
        annotations: Transaction.userEvent.of('input.format'),
      });
      editor.focus();
    }
  }
  function preference(key: string, value: string, apply: () => void) {
    try {
      if (!demo) localStorage.setItem(key, value);
      apply();
      setError('');
    } catch (e) {
      setError(e);
    }
  }
  function action(
    label: string,
    name: Parameters<typeof Icon>[0]['name'],
    run: () => void,
    disabled = false,
  ) {
    return (
      <Tooltip content={label}>
        <button
          type="button"
          className="icon-button"
          aria-label={label}
          disabled={disabled}
          onClick={run}
        >
          <Icon name={name} width="16" />
        </button>
      </Tooltip>
    );
  }
  const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';
  return (
    <>
      <div className="editor-toolbar" aria-label={translate('files:fileEditorToolbar')}>
        {action(
          translate('files:undoZ', { value1: mod }),
          'undo',
          () => {
            if (view.current) undo(view.current);
          },
          !historyState.undo,
        )}
        {action(
          translate('files:redoShiftZ', { value1: mod }),
          'redo',
          () => {
            if (view.current) redo(view.current);
          },
          !historyState.redo,
        )}
        <span className="editor-toolbar-divider" />
        <button
          className="editor-save"
          aria-label={translate('files:saveS', { value1: mod })}
          disabled={saving || !dirty}
          onClick={onSave}
        >
          <Icon name="save" width="15" />
          {translate('files:save')}
        </button>
        <span className="editor-save-state" role="status" aria-live="polite">
          {saving
            ? translate('files:saving')
            : dirty
              ? translate('files:unsaved')
              : translate('files:noUnsavedChanges')}
        </span>
        {onHistory && (
          <button className="session-tool" disabled={saving || demo} onClick={onHistory}>
            {translate('files:historyAndValidation')}
          </button>
        )}
        {action(translate('files:searchF', { value1: mod }), 'search', () => {
          if (view.current) openSearchPanel(view.current);
        })}
        <Dropdown>
          <DropdownTrigger>
            <Tooltip content={translate('files:editorViewOptions')}>
              <button className="icon-button" aria-label={translate('files:editorViewOptions')}>
                <Icon name="more" width="16" />
              </button>
            </Tooltip>
          </DropdownTrigger>
          <DropdownMenu
            aria-label={translate('files:editorViewOptions')}
            closeOnSelect={false}
            disabledKeys={[
              ...(saving ? ['reload'] : []),
              ...(demo ? ['download'] : []),
              ...(format.line_ending === 'mixed' ? ['completion'] : []),
              ...(fontSize >= 24 ? ['zoomIn'] : []),
              ...(fontSize <= 10 ? ['zoomOut'] : []),
            ]}
            onAction={(key) => {
              if (key === 'reload') onReload(format.encoding);
              else if (key === 'download') onDownload();
              else if (key === 'completion') {
                if (view.current) {
                  view.current.focus();
                  startCompletion(view.current);
                }
              } else if (key === 'minimap')
                preference('termquay.editor.minimap', String(!minimap), () => setMinimap(!minimap));
              else if (key === 'wrap') setWrap(!wrap);
              else {
                const size = key === 'zoomIn' ? fontSize + 1 : fontSize - 1;
                preference('termquay.editor.font-size', String(size), () => setFontSize(size));
              }
            }}
          >
            <DropdownItem key="reload" closeOnSelect>
              {translate('files:reload')}
            </DropdownItem>
            <DropdownItem key="download" closeOnSelect>
              {translate('files:downloadCurrentContent')}
            </DropdownItem>
            <DropdownItem key="completion" closeOnSelect showDivider>
              {translate('files:triggerCodeCompletion', {
                value1: shortcutLabel(completionShortcut),
              })}
            </DropdownItem>
            <DropdownItem key="minimap" endContent={minimap ? '✓' : null}>
              {translate('files:minimap')}
            </DropdownItem>
            <DropdownItem key="wrap" endContent={wrap ? '✓' : null} showDivider>
              {translate('files:wordWrap')}
            </DropdownItem>
            <DropdownItem key="zoomIn">{translate('files:increaseFontSize')}</DropdownItem>
            <DropdownItem key="zoomOut">{translate('files:decreaseFontSize')}</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      </div>
      {format.line_ending === 'mixed' && (
        <p className="editor-format-warning">
          {translate('files:mixedLineEndingsSelectLFOrCRLFBefore')}
        </p>
      )}
      <ErrorNotice message={error} onDismiss={() => setError('')} />
      <ErrorNotice message={languageError}>
        <button className="session-tool" onClick={() => setLanguageEpoch((value) => value + 1)}>
          {translate('files:reloadLanguage')}
        </button>
      </ErrorNotice>
      <ErrorNotice message={diagnosticError}>
        <button className="session-tool" onClick={() => setDiagnosticEpoch((value) => value + 1)}>
          {translate('files:retrySyntaxCheck')}
        </button>
      </ErrorNotice>
      <div
        className="code-editor"
        ref={host}
        style={{ '--editor-font-size': `${fontSize}px` } as CSSProperties}
      />
      <div className="editor-status">
        <Tooltip content={path}>
          <span className="editor-path">{path}</span>
        </Tooltip>
        <SelectControl
          aria-label={translate('files:editingLanguage')}
          value={languageOverride}
          onChange={(event) => setLanguageOverride(event.target.value as EditorLanguageID | 'auto')}
        >
          <option value="auto">
            {translate('files:auto', {
              value1: editorLanguages().find(([id]) => id === mode)?.[1],
            })}
          </option>
          {editorLanguages().map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </SelectControl>
        <Dropdown>
          <DropdownTrigger>
            <button
              className="editor-format-button"
              aria-label={translate('files:lineEndings')}
              disabled={saving}
            >
              {format.line_ending}
            </button>
          </DropdownTrigger>
          <DropdownMenu
            aria-label={translate('files:lineEndings')}
            selectedKeys={new Set([format.line_ending])}
            selectionMode="single"
            onAction={(value) => updateFormat({ line_ending: String(value) })}
          >
            {['LF', 'CRLF'].map((value) => (
              <DropdownItem key={value}>{value}</DropdownItem>
            ))}
          </DropdownMenu>
        </Dropdown>
        <Dropdown>
          <DropdownTrigger>
            <button
              className="editor-encoding"
              aria-label={translate('files:fileEncoding')}
              disabled={saving}
            >
              {format.encoding}
              {format.bom && format.encoding === 'UTF-8' ? ' BOM' : ''}
              <Icon name="chevron" width="11" style={{ transform: 'rotate(90deg)' }} />
            </button>
          </DropdownTrigger>
          <DropdownMenu
            aria-label={translate('files:fileEncodingActions')}
            onAction={(key) => {
              const [mode, encoding] = String(key).split(':');
              if (mode === 'open') onReload(encoding);
              else updateFormat({ encoding, bom: encoding === 'UTF-8' && format.bom });
            }}
          >
            <DropdownSection title={translate('files:reopenWithEncoding')} showDivider>
              {editorEncodings.map(([value, label]) => (
                <DropdownItem key={`open:${value}`}>{label}</DropdownItem>
              ))}
            </DropdownSection>
            <DropdownSection title={translate('files:saveWithEncoding')}>
              {editorEncodings.map(([value, label]) => (
                <DropdownItem key={`save:${value}`}>{label}</DropdownItem>
              ))}
            </DropdownSection>
          </DropdownMenu>
        </Dropdown>
        {problems > 0 && (
          <button
            className="error"
            onClick={() => {
              if (view.current) openLintPanel(view.current);
            }}
          >
            {translate('files:problemCount', { count: problems })}
          </button>
        )}
        <output aria-label={translate('files:cursorPosition')}>
          {translate('files:cursorCoordinates', { line: position.line, column: position.column })}
        </output>
        <span className="editor-font-size">{fontSize}px</span>
      </div>
    </>
  );
}
