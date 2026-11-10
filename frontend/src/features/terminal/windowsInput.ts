import type { Terminal } from '@xterm/xterm';

function keyRecords(vk: number, scan: number, char: number, state: number) {
  return `\x1b[${vk};${scan};${char};1;${state};1_\x1b[${vk};${scan};${char};0;${state};1_`;
}

export function addWindowsInput(term: Terminal) {
  let enabled = false;
  const handlers = [
    ...(['h', 'l'] as const).map((final) =>
      term.parser.registerCsiHandler({ prefix: '?', final }, (params) => {
        if (params.includes(9001)) enabled = final === 'h';
        return false;
      }),
    ),
    term.parser.registerCsiHandler({ prefix: '?', intermediates: '$', final: 'p' }, (params) => {
      if (params.length !== 1 || params[0] !== 9001) return false;
      term.input(`\x1b[?9001;${enabled ? 1 : 2}$y`);
      return true;
    }),
    term.parser.registerEscHandler({ final: 'c' }, () => {
      enabled = false;
      return false;
    }),
  ];
  return {
    key(event: KeyboardEvent) {
      if (
        !enabled ||
        event.type !== 'keydown' ||
        event.isComposing ||
        event.keyCode === 229 ||
        event.metaKey ||
        event.getModifierState('AltGraph')
      )
        return true;
      let data: string;
      if (event.code === 'KeyJ' && event.ctrlKey && !event.altKey && !event.shiftKey) {
        data = keyRecords(74, 36, 10, 8);
      } else if (event.key === 'Enter' && (event.shiftKey || event.ctrlKey || event.altKey)) {
        const state =
          (event.ctrlKey ? 8 : 0) |
          (event.altKey ? 2 : 0) |
          (event.shiftKey ? 16 : 0) |
          (event.code === 'NumpadEnter' ? 256 : 0);
        data = keyRecords(13, 28, event.ctrlKey ? 10 : 13, state);
      } else return true;
      event.preventDefault();
      event.stopPropagation();
      term.input(data, true);
      return false;
    },
    newline() {
      return enabled ? keyRecords(13, 28, 13, 16) : '\x1b[13;2u';
    },
    imagePaste() {
      return enabled ? keyRecords(86, 47, 22, 8) : '\x16';
    },
    dispose() {
      handlers.forEach((handler) => handler.dispose());
    },
  };
}
