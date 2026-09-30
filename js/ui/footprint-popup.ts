/**
 * List of items whose footprints overlap a clicked map point — same behaviour
 * as STEX's footprint popup. A plain DOM element absolutely positioned in the
 * map wrapper (not an OL overlay: that renders inside eox-map's shadow DOM).
 */
import { cloudCover, escapeHtml, formatItemDate, shortId } from '../format';
import { S } from '../strings';
import type { StacItem } from '../types';

export function popupHtml(items: StacItem[], activeId: string | null): string {
  const rows = items
    .map(item => {
      const cc = cloudCover(item);
      const meta = [
        formatItemDate(item),
        item.collection,
        cc === undefined ? '' : `☁ ${cc.toFixed(1)}%`
      ]
        .filter(Boolean)
        .map(x => escapeHtml(x))
        .join(' · ');
      return `<li><button type="button" class="jstex-fp__item${item.id === activeId ? ' jstex-active' : ''}" data-id="${escapeHtml(item.id)}">
        <span class="jstex-mono" title="${escapeHtml(item.id)}">${escapeHtml(shortId(item.id, 44))}</span>
        <span class="jstex-muted">${meta}</span></button></li>`;
    })
    .join('');
  return `<div class="jstex-fp__head"><strong>${escapeHtml(S.overlapping(items.length))}</strong>
      <button type="button" class="jstex-icon" data-close aria-label="${escapeHtml(S.close)}" title="${escapeHtml(S.close)}">✕</button></div>
    <ul class="jstex-fp__list">${rows}</ul>`;
}

/** Below the click if it fits, else above; always inside the container with an 8 px margin. */
export function popupPosition(
  pixel: [number, number],
  size: { width: number; height: number },
  container: { width: number; height: number }
): { left: number; top: number } {
  const m = 8;
  const left = Math.max(
    m,
    Math.min(pixel[0] - size.width / 2, container.width - size.width - m)
  );
  let top = pixel[1] + 12;
  if (top + size.height > container.height - m)
    top = pixel[1] - size.height - 12;
  return { left, top: Math.max(m, top) };
}

export interface FootprintPopup {
  show(
    pixel: [number, number],
    items: StacItem[],
    activeId: string | null
  ): void;
  close(): void;
  isOpen(): boolean;
}

export function createFootprintPopup(
  wrap: HTMLElement,
  onPick: (id: string) => void
): FootprintPopup {
  let el: HTMLElement | null = null;
  const onOutside = (e: Event) => {
    if (el && !el.contains(e.target as Node)) close();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };
  function close(): void {
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
    el?.remove();
    el = null;
  }
  function show(
    pixel: [number, number],
    items: StacItem[],
    activeId: string | null
  ): void {
    close();
    el = document.createElement('div');
    el.className = 'jstex-fp';
    el.setAttribute('role', 'dialog');
    el.innerHTML = popupHtml(items, activeId);
    wrap.appendChild(el);
    const pos = popupPosition(
      pixel,
      { width: el.offsetWidth, height: el.offsetHeight },
      { width: wrap.clientWidth, height: wrap.clientHeight }
    );
    el.style.left = `${pos.left}px`;
    el.style.top = `${pos.top}px`;
    el.addEventListener('click', e => {
      const target = e.target as HTMLElement;
      if (target.closest('[data-close]')) return close();
      const row = target.closest<HTMLElement>('[data-id]');
      if (row) {
        onPick(row.dataset.id!);
        close();
      }
    });
    // Registered after this click finished, so the opening click does not close it.
    setTimeout(() => {
      document.addEventListener('pointerdown', onOutside, true);
      document.addEventListener('keydown', onKey, true);
    }, 0);
  }
  return { show, close, isOpen: () => el !== null };
}
