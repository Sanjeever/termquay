import { useEffect, useRef } from 'react';
import { MergeView } from '@codemirror/merge';
import { EditorState } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';
import { useAppearance } from '../settings/AppearanceProvider';
import { editorTheme } from './editorTheme';
import '../../styles/file-compare.css';

export default function ReadonlyDiffView({ left, right, leftLabel, rightLabel }: {
  left?: string;
  right?: string;
  leftLabel: string;
  rightLabel: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const { dark } = useAppearance();

  useEffect(() => {
    if (!host.current || left === undefined || right === undefined) return;
    const extensions = [EditorState.readOnly.of(true), EditorView.editable.of(false), lineNumbers(), editorTheme(dark)];
    const view = new MergeView({
      parent: host.current,
      a: { doc: left, extensions: [...extensions, EditorView.contentAttributes.of({ 'aria-label': leftLabel })] },
      b: { doc: right, extensions: [...extensions, EditorView.contentAttributes.of({ 'aria-label': rightLabel })] },
      highlightChanges: true,
      gutter: true,
    });
    return () => view.destroy();
  }, [left, right, leftLabel, rightLabel, dark]);

  return <div className="conflict-editors" ref={host} />;
}
