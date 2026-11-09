import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditorView } from '@codemirror/view';
import { undoDepth } from '@codemirror/commands';
import { useEffect, useRef, useState } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Document } from '../../../bindings/github.com/Sanjeever/termquay/internal/files/models';
import { appearanceKey } from './appearance';
import { AppearanceProvider, useAppearance } from './AppearanceProvider';
import { deferred } from '../../test/deferred';
import useFileDrafts from '../files/useFileDrafts';
import { isDirty } from '../files/fileDrafts';
import { documentFormat } from '../files/editorFormat';
import CodeEditor from '../files/CodeEditor';
import PaneTabs from '../files/PaneTabs';
import AppearanceSettings from './AppearanceSettings';

const api = vi.hoisted(() => ({ language: vi.fn(), zoom: vi.fn(), save: vi.fn() }));
vi.mock('@wailsio/runtime', () => ({ Window: { SetZoom: api.zoom } }));
vi.mock('../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice', () => ({
  SetLanguage: api.language, SaveRemoteFile: api.save,
  SaveSudoFile: vi.fn(), ReadRemoteFileEncoded: vi.fn(), ReadSudoFile: vi.fn(),
}));

const document: Document = { path: '/tmp/notes.txt', content: 'original', revision: 'revision-1', encoding: 'UTF-8', line_ending: 'LF', bom: false };

function Workbench() {
  const { appearance, update, error } = useAppearance();
  const disposed = useRef(false);
  const instance = useRef('session-a');
  const drafts = useFileDrafts({ sessionID: instance.current, disposed, instance, authorizeSudo: async () => undefined, setError: () => {} });
  const [selected, setSelected] = useState('terminal-a');
  useEffect(() => {
    drafts.updateDrafts(() => [{ ...document, saved: document.content, error: '', saving: false }]);
  }, []);
  const draft = drafts.drafts[0];
  return <>
    <button onClick={() => update({ ...appearance, language: 'zh-CN' })}>简体中文</button>
    <button onClick={() => update({ ...appearance, language: 'en' })}>English</button>
    {error && <p role="alert">{error}</p>}
    <PaneTabs pane={0} column={1} hidden={false} focused creating={false} selected={selected}
      items={[{ id: 'terminal-a', label: 'Terminal', terminal: true }, { id: document.path, label: 'notes.txt', terminal: false, dirty: draft && isDirty(draft) }]}
      onSelect={setSelected} onClose={() => {}} onNew={() => {}} newShortcut="Ctrl+T" closeShortcut="Ctrl+W" />
    <div hidden={selected !== document.path}>{draft && <CodeEditor path={document.path} content={draft.content} format={documentFormat(draft)}
      visible={selected === document.path} focusOnShow={false} dirty={isDirty(draft)} saving={draft.saving}
      onChange={(content, format) => drafts.updateDrafts(previous => previous.map(item => ({ ...item, content, ...format })))}
      onSave={() => { void drafts.save(document.path); }} onReload={() => {}} onDownload={() => {}} />}</div>
  </>;
}

beforeEach(() => {
  vi.resetAllMocks();
  api.language.mockResolvedValue(undefined);
  api.zoom.mockResolvedValue(undefined);
  vi.stubGlobal('matchMedia', vi.fn((media: string) => ({ matches: false, media, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  // jsdom does not compute layout; these tests verify editor state, not geometry.
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  const createRange = window.document.createRange.bind(window.document);
  vi.spyOn(window.document, 'createRange').mockImplementation(() => Object.assign(createRange(), {
    getClientRects: () => Object.assign([], { item: () => null }),
    getBoundingClientRect: () => new DOMRect(),
  }));
});

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

test('language changes retain the selected tab, CodeMirror instance, draft, selection and undo history', async () => {
  const user = userEvent.setup();
  render(<AppearanceProvider><Workbench /></AppearanceProvider>);
  const tab = screen.getByRole('tab', { name: document.path });
  await user.click(tab);
  const editor = screen.getByRole('textbox', { name: `Edit ${document.path}` });
  const view = EditorView.findFromDOM(editor)!;
  act(() => view.dispatch({ changes: { from: 8, insert: ' changed' }, selection: { anchor: 2, head: 6 } }));
  const history = undoDepth(view.state);
  expect(history).toBeGreaterThan(0);

  await user.click(screen.getByRole('button', { name: '简体中文' }));
  await waitFor(() => expect(window.document.documentElement.lang).toBe('zh-CN'));
  expect(screen.getByRole('textbox', { name: `编辑 ${document.path}` })).toBe(editor);
  expect(EditorView.findFromDOM(editor)).toBe(view);
  expect(view.state.doc.toString()).toBe('original changed');
  expect(view.state.selection.main).toMatchObject({ anchor: 2, head: 6 });
  expect(undoDepth(view.state)).toBe(history);
  expect(screen.getByRole('tab', { name: document.path, selected: true })).toBe(tab);
  expect(screen.getByRole('tablist', { name: '主窗格标签' })).toBeTruthy();
  expect(JSON.parse(localStorage.getItem(appearanceKey)!).language).toBe('zh-CN');
  expect(api.save).not.toHaveBeenCalled();

  await user.click(screen.getByRole('button', { name: /^撤销/ }));
  expect(view.state.doc.toString()).toBe('original');
  await user.click(screen.getByRole('button', { name: /^重做/ }));
  expect(view.state.doc.toString()).toBe('original changed');
  await user.click(screen.getByRole('button', { name: 'English' }));
  expect(screen.getByRole('textbox', { name: `Edit ${document.path}` })).toBe(editor);
  expect(screen.getByRole('tab', { name: document.path, selected: true })).toBe(tab);
  expect(view.state.doc.toString()).toBe('original changed');
  await waitFor(() => expect(api.language.mock.calls.map(([language]) => language)).toEqual(['en', 'zh-CN', 'en']));
});

test('switching language during a save retains the pending operation and later edits', async () => {
  const user = userEvent.setup();
  const pending = deferred<Document>();
  api.save.mockReturnValueOnce(pending.promise);
  render(<AppearanceProvider><Workbench /></AppearanceProvider>);
  await user.click(screen.getByRole('tab', { name: document.path }));
  const editor = screen.getByRole('textbox', { name: `Edit ${document.path}` });
  const view = EditorView.findFromDOM(editor)!;
  act(() => view.dispatch({ changes: { from: 8, insert: ' submitted' } }));
  await user.click(screen.getByRole('button', { name: /^Save ·/ }));
  act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: ' newer' } }));
  await user.click(screen.getByRole('button', { name: '简体中文' }));
  expect(api.save).toHaveBeenCalledTimes(1);
  expect(screen.getByRole<HTMLButtonElement>('button', { name: /^保存 ·/ }).disabled).toBe(true);
  await act(async () => { pending.resolve({ ...document, content: 'original submitted', revision: 'revision-2' }); });
  expect(screen.getByRole('textbox', { name: `编辑 ${document.path}` })).toBe(editor);
  expect(view.state.doc.toString()).toBe('original submitted newer');
  expect(screen.getByRole<HTMLButtonElement>('button', { name: /^保存 ·/ }).disabled).toBe(false);
  expect(api.save).toHaveBeenCalledWith('session-a', expect.objectContaining({ content: 'original submitted' }));
});

test('native language synchronization failures are localized and can be retried by switching language', async () => {
  const user = userEvent.setup();
  api.language.mockRejectedValueOnce(new Error('Native language unavailable'));
  api.language.mockRejectedValueOnce(new Error('Native language unavailable'));
  render(<AppearanceProvider><Workbench /></AppearanceProvider>);
  expect((await screen.findByRole('alert')).textContent).toBe('Could not update the native language: Native language unavailable');
  await user.click(screen.getByRole('button', { name: '简体中文' }));
  expect((await screen.findByRole('alert')).textContent).toBe('更新原生界面语言失败：Native language unavailable');
  await waitFor(() => expect(api.language).toHaveBeenLastCalledWith('zh-CN'));
  await user.click(screen.getByRole('button', { name: 'English' }));
  await waitFor(() => expect(api.language).toHaveBeenLastCalledWith('en'));
  expect(screen.queryByRole('alert')).toBeNull();
});

test('custom font editing updates the preview and editors, persists across remounts and resets', async () => {
  const user = userEvent.setup();
  const fontSize = vi.fn();
  const settings = <AppearanceProvider><AppearanceSettings section="terminal" fontSize={14} onFontSize={fontSize} /><Workbench /></AppearanceProvider>;
  const mounted = render(settings);
  await user.click(screen.getByRole('tab', { name: document.path }));
  const editor = screen.getByRole('textbox', { name: `Edit ${document.path}` });
  const view = EditorView.findFromDOM(editor)!;
  act(() => view.dispatch({ changes: { from: 8, insert: ' changed' }, selection: { anchor: 2, head: 6 } }));
  const history = undoDepth(view.state);
  fireEvent.change(window.document.querySelector('select')!, { target: { value: 'custom' } });
  await user.type(screen.getByRole('textbox', { name: 'Font family' }), 'FiraCode Nerd Font Mono');
  expect(window.document.documentElement.style.getPropertyValue('--font-mono')).toContain('"FiraCode Nerd Font Mono"');
  expect(screen.getByLabelText('Terminal color preview').style.fontFamily).toContain('FiraCode Nerd Font Mono');
  expect(EditorView.findFromDOM(editor)).toBe(view);
  expect(view.state.doc.toString()).toBe('original changed');
  expect(view.state.selection.main).toMatchObject({ anchor: 2, head: 6 });
  expect(undoDepth(view.state)).toBe(history);
  expect(JSON.parse(localStorage.getItem(appearanceKey)!)).toMatchObject({ monoFont: 'custom', customMonoFont: 'FiraCode Nerd Font Mono' });
  mounted.unmount();
  render(settings);
  expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Font family' }).value).toBe('FiraCode Nerd Font Mono');
  await user.click(screen.getByRole('button', { name: 'Restore defaults' }));
  expect(screen.queryByRole('textbox', { name: 'Font family' })).toBeNull();
  expect(JSON.parse(localStorage.getItem(appearanceKey)!)).toMatchObject({ monoFont: 'system', customMonoFont: '' });
  expect(fontSize).toHaveBeenCalledWith(14);
});
