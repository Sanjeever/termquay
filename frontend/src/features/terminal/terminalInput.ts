import type { Terminal } from '@xterm/xterm';

export function terminalCopyText(text: string) {
  return text.replace(/ +(?=\r?$)/gm, '');
}

export function addIMEInput(term: Terminal) {
  const textarea = term.textarea!;
  const element = term.element!;
  let directInput = false;
  let composing = false;
  let compositionEnd: ReturnType<typeof setTimeout> | undefined;
  const start = () => {
    clearTimeout(compositionEnd);
    composing = true;
    directInput = false;
  };
  const end = () => {
    // xterm finalizes composition in the next task. Let it consume the committed text first.
    compositionEnd = setTimeout(() => {
      composing = false;
    }, 0);
  };
  const input = (event: Event) => {
    const text = event as InputEvent;
    if (composing && text.inputType === 'insertText') {
      event.stopImmediatePropagation();
      return;
    }
    if (!directInput || text.isComposing) return;
    if (text.inputType !== 'insertText' && text.inputType !== 'deleteContentBackward') return;
    directInput = false;
    event.stopImmediatePropagation();
    if (text.inputType === 'deleteContentBackward') term.input('\x7f', true);
    else if (text.data) term.input(text.data, true);
  };
  textarea.addEventListener('compositionstart', start);
  textarea.addEventListener('compositionend', end);
  element.addEventListener('input', input, true);
  return {
    key(event: KeyboardEvent) {
      if (event.type === 'keypress' && (directInput || composing)) return false;
      if (event.type !== 'keydown') return true;
      if (event.isComposing || (composing && event.key === 'Enter')) return false;
      if (event.keyCode === 229 || event.key === 'Process') {
        // Own direct IME input through the input event, without xterm's textarea polling timer.
        directInput = !composing;
        return false;
      }
      if (!['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) directInput = false;
      return true;
    },
    dispose() {
      clearTimeout(compositionEnd);
      textarea.removeEventListener('compositionstart', start);
      textarea.removeEventListener('compositionend', end);
      element.removeEventListener('input', input, true);
    },
  };
}
