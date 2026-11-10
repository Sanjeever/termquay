import {
  Dropdown as HeroDropdown,
  Popover as HeroPopover,
  type DropdownProps,
  type PopoverProps,
} from '@heroui/react';

export function Dropdown(props: DropdownProps) {
  return <HeroDropdown data-app-menu="" disableAnimation {...props} />;
}

export function Popover(props: PopoverProps) {
  return <HeroPopover disableAnimation {...props} />;
}
