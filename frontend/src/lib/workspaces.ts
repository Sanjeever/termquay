export function nextWorkspaceAfterClose(items: { id: string }[], active: string, closing: string, recent: string[]) {
  if (active !== closing) return active;
  const remaining = items.filter(w => w.id !== closing);
  return recent.find(id => remaining.some(w => w.id === id)) ?? remaining[Math.min(items.findIndex(w => w.id === closing), remaining.length - 1)]?.id ?? '';
}
