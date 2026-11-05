import { Dropdown as HeroDropdown, Popover as HeroPopover, type DropdownProps, type PopoverProps } from '@heroui/react';
import type { MotionProps } from 'framer-motion';

export const popoverMotion = {
  initial: { opacity: 0, transform: 'none' },
  animate: { opacity: 1, transform: 'none' },
  exit: { opacity: 0, transform: 'none' },
  transition: { duration: .12, ease: 'easeOut' },
} satisfies MotionProps;

export function Dropdown(props: DropdownProps) {
  return <HeroDropdown data-app-menu="" motionProps={popoverMotion} {...props} />;
}

export function Popover(props: PopoverProps) {
  return <HeroPopover motionProps={popoverMotion} {...props} />;
}
