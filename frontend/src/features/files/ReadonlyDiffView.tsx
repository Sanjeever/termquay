import { useEffect, useRef } from 'react';
import { MergeView } from '@codemirror/merge';
import { Compartment, EditorState } from '@codemirror/state';
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
  const merge = useRef<MergeView>();
  const presentation = useRef([new Compartment(), new Compartment()]);
  const { dark } = useAppearance();

  useEffect(() => {
    if (!host.current || left === undefined || right === undefined) return;
    const extensions = [EditorState.readOnly.of(true), EditorView.editable.of(false), lineNumbers()];
    const view = new MergeView({
      parent: host.current,
      a: { doc: left, extensions: [...extensions, presentation.current[0].of([])] },
      b: { doc: right, extensions: [...extensions, presentation.current[1].of([])] },
      highlightChanges: true,
      gutter: true,
    });
    merge.current = view;
    return () => { view.destroy(); merge.current = undefined; };
  }, [left, right]);
  useEffect(() => {
    [merge.current?.a, merge.current?.b].forEach((view, index) => view?.dispatch({ effects: presentation.current[index].reconfigure([editorTheme(dark), EditorView.contentAttributes.of({ 'aria-label': index ? rightLabel : leftLabel })]) }));
  }, [left, right, leftLabel, rightLabel, dark]);

  return <div className="conflict-editors" ref={host} />;
}
