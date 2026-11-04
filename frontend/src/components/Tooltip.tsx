import { cloneElement, forwardRef, useCallback, useEffect, useRef, useState, type HTMLAttributes, type MutableRefObject, type ReactElement, type ReactNode, type Ref, type SyntheticEvent } from 'react';
import { Tooltip as HeroTooltip, type TooltipProps } from '@heroui/react';

let current: { dismiss(): void } | undefined;
export const tooltipDelay = 600;
const closeDelay = 120;

type TriggerProps = HTMLAttributes<HTMLElement> & { disabled?: boolean; ref?: Ref<HTMLElement> };
type Props = Omit<TriggerProps, 'children' | 'content'> & {
  children: ReactElement<TriggerProps>; content?: ReactNode; isDisabled?: boolean; placement?: TooltipProps['placement'];
};

export default forwardRef<HTMLElement, Props>(function Tooltip({ children, content, isDisabled = false, placement, ...triggerProps }, ref) {
  const [open, setOpen] = useState(false);
  const shown = useRef(false);
  const timers = useRef<{ show?: ReturnType<typeof setTimeout>; hide?: ReturnType<typeof setTimeout> }>({});
  const listeners = useRef<AbortController>();
  const body = useRef<HTMLDivElement>(null);
  const disabled = useRef(false); disabled.current = isDisabled || !!children.props.disabled || !!triggerProps.disabled || !content;
  const owner = useRef({ dismiss: () => {} }); owner.current.dismiss = dismiss;
  const childRef = (children as ReactElement & { ref?: Ref<HTMLElement> }).ref;
  const setTrigger = useCallback((node: HTMLElement | null) => {
    for (const target of [ref, childRef]) {
      if (typeof target === 'function') target(node);
      else if (target) (target as MutableRefObject<HTMLElement | null>).current = node;
    }
  }, [ref, childRef]);

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

  const props = { ...children.props, ...triggerProps };
  for (const key of Object.keys(triggerProps) as (keyof TriggerProps)[]) {
    const original = children.props[key], incoming = triggerProps[key];
    if (key.startsWith('on') && typeof original === 'function' && typeof incoming === 'function') {
      Object.assign(props, { [key]: (event: SyntheticEvent<HTMLElement>) => { original(event as never); incoming(event as never); } });
    }
  }
  if (children.props.className && triggerProps.className) props.className = `${children.props.className} ${triggerProps.className}`;
  if (children.props.disabled) props.disabled = true;
  if (!content) return cloneElement(children, { ...props, ref: setTrigger });
  return <HeroTooltip content={<div ref={body} className="app-tooltip-body" onPointerEnter={keepOpen} onPointerLeave={leave}>{content}</div>}
    className="app-tooltip" placement={placement} isDisabled={isDisabled} isOpen={open && !disabled.current} onOpenChange={() => {}}
    delay={tooltipDelay} closeDelay={closeDelay} disableAnimation>
    {cloneElement(children, {
      ...props,
      ref: setTrigger,
      onPointerEnter: event => { props.onPointerEnter?.(event); if (event.pointerType !== 'touch' && !event.buttons) enter(event.currentTarget); },
      onPointerLeave: event => { props.onPointerLeave?.(event); if (!body.current?.contains(event.relatedTarget as Node | null)) leave(); },
      onFocus: event => { props.onFocus?.(event); if (event.target instanceof HTMLElement && event.target.matches(':focus-visible')) enter(event.currentTarget, true); },
      onBlur: event => { props.onBlur?.(event); dismiss(); },
    })}
  </HeroTooltip>;
});
