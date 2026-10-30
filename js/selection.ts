/** Selection helpers (pure except scrollWithin). */
import type { StacItem } from './types';

/** Next/previous loaded item id, or null at either end. */
export function neighbour(
  items: StacItem[],
  activeId: string | null,
  dir: 1 | -1
): string | null {
  if (!items.length) return null;
  const at = items.findIndex(i => i.id === activeId);
  if (at === -1) return dir === 1 ? items[0].id : null;
  return items[at + dir]?.id ?? null;
}

/** Select-all checkbox state: how many of the loaded items are selected. */
export function selectAllState(
  selected: string[],
  loaded: string[]
): 'none' | 'some' | 'all' {
  const chosen = new Set(selected);
  const n = loaded.filter(id => chosen.has(id)).length;
  return n === 0 ? 'none' : n === loaded.length ? 'all' : 'some';
}

export function toggleId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id];
}

/** Scroll `row` into view inside `container` only (never the notebook). */
export function scrollWithin(
  container: HTMLElement,
  row: HTMLElement,
  stickyHeader = 0
): void {
  const c = container.getBoundingClientRect();
  const r = row.getBoundingClientRect();
  if (r.top < c.top + stickyHeader)
    container.scrollTop -= c.top + stickyHeader - r.top;
  else if (r.bottom > c.bottom) container.scrollTop += r.bottom - c.bottom;
}
