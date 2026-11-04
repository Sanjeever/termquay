import { cloneElement, useEffect, useRef, useState, type HTMLAttributes, type ReactElement, type ReactNode } from 'react';
import { Tooltip as HeroTooltip, type TooltipProps } from '@heroui/react';

let current: { dismiss(): void } | undefined;
export const tooltipDelay = 600;
const closeDelay = 120;

export default function Tooltip({ children, content, isDisabled = false, placement }: {
  children: ReactElement<HTMLAttributes<HTMLElement>>; content?: ReactNode; isDisabled?: boolean; placement?: TooltipProps['placement'];
}) {
  const [open, setOpen] = useState(false);
  const shown = useRef(false);
  const timers = useRef<{ show?: ReturnType<typeof setTimeout>; hide?: ReturnType<typeof setTimeout> }>({});
  const listeners = useRef<AbortController>();
  const body = useRef<HTMLDivElement>(null);
  const disabled = useRef(isDisabled || !content); disabled.current = isDisabled || !content;
  const owner = useRef({ dismiss: () => {} }); owner.current.dismiss = dismiss;

  function reset() {
    clearTimeout(timers.current.show); clearTimeout(timers.current.hide);
    timers.current = {};
    listeners.current?.abort(); listeners.current = undefined;
    if (current === owner.current) current = undefined;
  }
  function dismiss() { reset(); shown.current = false; setOpen(false); }
  function keepOpen() { clearTimeout(timers.current.hide); timers.current.hide = undefined; }
  function leave() {
    clearTimeout(timers.current.show); timers.current.show = undefined;
    keepOpen(); timers.current.hide = setTimeout(dismiss, closeDelay);
  }
  function enter(target: HTMLElement, immediate = false) {
    if (disabled.current || target.closest('[aria-haspopup][aria-expanded=true]')) return;
    current?.dismiss();
    current = owner.current;
    const controller = new AbortController(); listeners.current = controller;
    const options = { capture: true, signal: controller.signal };
    const outsideBody = (event: Event) => { if (!body.current?.contains(event.target as Node)) dismiss(); };
    document.addEventListener('pointerdown', outsideBody, options);
    document.addEventListener('contextmenu', dismiss, options);
    document.addEventListener('dragstart', dismiss, options);
    document.addEventListener('scroll', outsideBody, { ...options, passive: true });
    document.addEventListener('wheel', outsideBody, { ...options, passive: true });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') { if (shown.current) event.stopPropagation(); dismiss(); }
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c' && body.current?.contains(window.getSelection()?.anchorNode || null)) return;
      else if (!['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) dismiss();
    }, options);
    document.addEventListener('visibilitychange', dismiss, options);
    window.addEventListener('blur', dismiss, options);
    const show = () => {
      timers.current.show = undefined;
      if (disabled.current || !target.isConnected || target.closest('[hidden], [aria-hidden=true], [aria-haspopup][aria-expanded=true]')) { dismiss(); return; }
      shown.current = true; setOpen(true);
    };
    if (immediate) show(); else timers.current.show = setTimeout(show, tooltipDelay);
  }
  useEffect(() => { if (disabled.current) dismiss(); }, [isDisabled, !!content]);
  useEffect(() => () => reset(), []);

  if (!content) return children;
  const props = children.props;
  return <HeroTooltip content={<div ref={body} className="app-tooltip-body" onPointerEnter={keepOpen} onPointerLeave={leave}>{content}</div>}
    className="app-tooltip" placement={placement} isDisabled={isDisabled} isOpen={open && !isDisabled} onOpenChange={() => {}}
    delay={tooltipDelay} closeDelay={closeDelay} disableAnimation>
    {cloneElement(children, {
      onPointerEnter: event => { props.onPointerEnter?.(event); if (event.pointerType !== 'touch' && !event.buttons) enter(event.currentTarget); },
      onPointerLeave: event => { props.onPointerLeave?.(event); if (!body.current?.contains(event.relatedTarget as Node | null)) leave(); },
      onFocus: event => { props.onFocus?.(event); if (event.currentTarget.matches(':focus-visible')) enter(event.currentTarget, true); },
      onBlur: event => { props.onBlur?.(event); dismiss(); },
    })}
  </HeroTooltip>;
}
