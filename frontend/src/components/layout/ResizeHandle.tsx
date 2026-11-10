import { useEffect, useRef } from 'react';

export default function ResizeHandle({
  label,
  value,
  min,
  max,
  onChange,
  reverse = false,
  horizontal = false,
  pixelsPerUnit = 1,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange(value: number): void;
  reverse?: boolean;
  horizontal?: boolean;
  pixelsPerUnit?: number;
}) {
  const drag = useRef<{ start: number; value: number; pointer: number }>();
  const pending = useRef<number>();
  const frame = useRef(0);
  const change = useRef(onChange);
  change.current = onChange;
  const clamp = (next: number) => Math.max(min, Math.min(max, next));
  function flush() {
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    if (pending.current !== undefined) {
      change.current(pending.current);
      pending.current = undefined;
    }
  }
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  return (
    <div
      className={`panel-separator ${horizontal ? 'horizontal' : ''}`}
      role="separator"
      aria-label={label}
      aria-orientation={horizontal ? 'horizontal' : 'vertical'}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onKeyDown={(e) => {
        const keys = horizontal ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight'];
        if (e.key === 'Home' || e.key === 'End') {
          e.preventDefault();
          onChange(e.key === 'Home' ? min : max);
        } else if (keys.includes(e.key)) {
          e.preventDefault();
          onChange(
            clamp(
              value + (e.key === keys[1] ? 1 : -1) * (e.shiftKey ? 1 : 10) * (reverse ? -1 : 1),
            ),
          );
        }
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.focus();
        e.currentTarget.setPointerCapture(e.pointerId);
        e.currentTarget.dataset.dragging = 'true';
        drag.current = { start: horizontal ? e.clientY : e.clientX, value, pointer: e.pointerId };
      }}
      onPointerMove={(e) => {
        const current = drag.current;
        if (!current || current.pointer !== e.pointerId) return;
        pending.current = clamp(
          current.value +
            (((horizontal ? e.clientY : e.clientX) - current.start) / pixelsPerUnit) *
              (reverse ? -1 : 1),
        );
        if (!frame.current) frame.current = requestAnimationFrame(flush);
      }}
      onPointerUp={(e) => {
        if (drag.current?.pointer !== e.pointerId) return;
        flush();
        drag.current = undefined;
        delete e.currentTarget.dataset.dragging;
        e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onLostPointerCapture={(e) => {
        flush();
        drag.current = undefined;
        delete e.currentTarget.dataset.dragging;
      }}
    />
  );
}
