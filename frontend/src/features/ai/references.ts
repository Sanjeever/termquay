import type { Reference } from '../../../bindings/github.com/Sanjeever/termquay/internal/ai/models';

export function addAIReference(current: Reference[], reference: Reference, workspace: string): Reference[] {
  if (!workspace || reference.workspace !== workspace || !reference.terminal || !reference.text) throw new Error('终端引用来源已失效');
  if (current.length >= 4) throw new Error('每次最多加入 4 处终端引用');
  const bytes = current.reduce((total, item) => total + new TextEncoder().encode(item.text).length, new TextEncoder().encode(reference.text).length);
  if (bytes > 16 * 1024) throw new Error('终端引用总量超过 16 KiB，请缩小选区');
  return [...current, { ...reference }];
}
