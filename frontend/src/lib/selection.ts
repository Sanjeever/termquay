export function selectItems(
  order: string[],
  selected: string[],
  id: string,
  anchor: string,
  toggle: boolean,
  range: boolean,
) {
  if (range && order.includes(anchor)) {
    const start = order.indexOf(anchor);
    const end = order.indexOf(id);
    const values = order.slice(Math.min(start, end), Math.max(start, end) + 1);
    return toggle ? [...new Set([...selected, ...values])] : values;
  }
  return toggle
    ? selected.includes(id)
      ? selected.filter((value) => value !== id)
      : [...selected, id]
    : [id];
}
