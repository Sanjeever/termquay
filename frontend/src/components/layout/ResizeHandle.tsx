export default function ResizeHandle({ label, value, min, max, onChange, reverse = false, horizontal = false }: {
  label: string; value: number; min: number; max: number; onChange(value: number): void; reverse?: boolean; horizontal?: boolean;
}) {
  const clamp = (next: number) => onChange(Math.max(min, Math.min(max, next)));
  return <div className={`panel-separator ${horizontal ? 'horizontal' : ''}`} role="separator" aria-label={label} aria-orientation={horizontal ? 'horizontal' : 'vertical'} aria-valuenow={value} aria-valuemin={min} aria-valuemax={max} tabIndex={0}
    onKeyDown={e => { const keys = horizontal ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight']; if (keys.includes(e.key)) { e.preventDefault(); clamp(value + (e.key === keys[1] ? 10 : -10) * (reverse ? -1 : 1)); } }}
    onPointerDown={e => { e.preventDefault(); const start = horizontal ? e.clientY : e.clientX; const element = e.currentTarget; element.setPointerCapture(e.pointerId); element.onpointermove = event => clamp(value + ((horizontal ? event.clientY : event.clientX) - start) * (reverse ? -1 : 1)); element.onpointerup = element.onpointercancel = () => { element.onpointermove = null; element.onpointerup = null; element.onpointercancel = null; }; }} />;
}
