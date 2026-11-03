import type { SVGProps } from 'react';

const paths = {
  undo: 'M8 4 3 9l5 5M3 9h10a7 7 0 0 1 0 14',
  redo: 'M16 4l5 5-5 5M21 9H11a7 7 0 0 0 0 14',
  save: 'M4 3h13l4 4v14H3V3zM7 3v6h10V3M7 21v-8h10v8',
  download: 'M12 3v12M7 10l5 5 5-5M4 16v5h16v-5',
  minus: 'M5 12h14',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  eyeOff: 'M3 3l18 18M10 5.2A12 12 0 0 1 12 5c6.5 0 10 7 10 7a19 19 0 0 1-3.3 4.3M6.2 6.2A20 20 0 0 0 2 12s3.5 7 10 7a12 12 0 0 0 5.8-1.8M10 10a3 3 0 0 0 4 4',
  connections: 'M4 5h16v5H4zM4 14h16v5H4zM7 7.5h.01M7 16.5h.01',
  files: 'M3 7V5h7l2 2h9v13H3z',
  settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2',
  search: 'M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15M16 16l5 5',
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M6 18 18 6',
  terminal: 'M4 6l6 6-6 6M13 18h7',
  monitor: 'M3 13h4l3-8 4 14 3-6h4',
  transfer: 'M7 3v16M3 15l4 4 4-4M17 21V5M13 9l4-4 4 4',
  focus: 'M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5',
  sidebar: 'M3 4h18v16H3zM8 4v16',
  chevron: 'M9 5l7 7-7 7',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  up: 'M12 20V4M5 11l7-7 7 7',
  refresh: 'M20 7v5h-5M20 12a8 8 0 1 0-2 6',
  desktop: 'M3 4h18v13H3zM8 21h8M12 17v4',
} as const;

export default function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: keyof typeof paths }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}><path d={paths[name]} /></svg>;
}
