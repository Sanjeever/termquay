import { message as uiMessage } from '../../i18n/messages.ts';
import type { Reference } from '../../../bindings/github.com/Sanjeever/termquay/internal/ai/models';

export function addAIReference(current: Reference[], reference: Reference, workspace: string): Reference[] {
  if (!workspace || reference.workspace !== workspace || !reference.terminal || !reference.text) throw uiMessage('ai:terminalReferenceSourceIsNoLongerAvailable');
  if (current.length >= 4) throw uiMessage('ai:attachUpTo4TerminalReferencesPerTurn');
  const bytes = current.reduce((total, item) => total + new TextEncoder().encode(item.text).length, new TextEncoder().encode(reference.text).length);
  if (bytes > 16 * 1024) throw uiMessage('ai:terminalReferencesExceed16KiBSelectLessText');
  return [...current, { ...reference }];
}
