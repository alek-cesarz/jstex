/**
 * Layout A glue: theme, height, the splitter between the search panel and the
 * map (drag, arrow keys, double-click to reset), and the collapsible map
 * ("Hide map" on the map, a rail with "Show map" when it is folded away).
 * Panel width and map state live in the store (synced traits), so a
 * re-rendered view keeps them and Python can set them.
 */
import type { Actions } from '../actions';
import { escapeHtml } from '../format';
import { ICON } from '../icons';
import type { Store } from '../store';
import { S } from '../strings';
import type { ExplorerState } from '../types';

export const PANEL_DEFAULT = 300;
export const PANEL_MIN = 240;
/** Splitter width = the old gap between panel and map. */
export const SPLITTER = 12;
/** The map never gets narrower than this while resizing the panel. */
export const MAP_MIN = 320;
const KEY_STEP = 16;

type LayoutActions = Pick<
  Actions,
  'setPanelWidth' | 'setMapCollapsed' | 'setPanelCollapsed'
>;

export function mountLayout(
  root: HTMLElement,
  store: Store<ExplorerState>,
  actions: LayoutActions
): () => void {
  const body = root.querySelector('[data-ref="body"]') as HTMLElement;
  const mapSlot = body.querySelector('[data-slot="map"]') as HTMLElement;

  const splitter = document.createElement('div');
  splitter.className = 'jstex-splitter';
  splitter.dataset.ref = 'splitter';
  splitter.tabIndex = 0;
  splitter.setAttribute('role', 'separator');
  splitter.setAttribute('aria-orientation', 'vertical');
  splitter.setAttribute('aria-label', S.resizePanel);
  splitter.title = S.resizePanel;
  mapSlot.before(splitter);

  const hide = document.createElement('button');
  hide.type = 'button';
  hide.className = 'jstex-icon jstex-map-hide';
  hide.dataset.ref = 'hideMap';
  hide.title = S.hideMap;
  hide.setAttribute('aria-label', S.hideMap);
  hide.innerHTML = ICON.chevronRight;
  mapSlot.appendChild(hide);

  const rail = document.createElement('div');
  rail.className = 'jstex-rail jstex-maprail';
  rail.dataset.ref = 'mapRail';
  rail.innerHTML = `
    <button type="button" class="jstex-icon" data-ref="showMap" title="${escapeHtml(S.showMap)}" aria-label="${escapeHtml(S.showMap)}">${ICON.chevronLeft}</button>
    <button type="button" class="jstex-icon" data-ref="showMapIcon" title="${escapeHtml(S.showMap)}" aria-label="${escapeHtml(S.showMap)}">${ICON.map}</button>
    <span class="jstex-maprail__label">${escapeHtml(S.map)}</span>`;
  body.appendChild(rail);

  /** Largest panel width that still leaves the map MAP_MIN px (no limit before layout). */
  const clamp = (width: number) => {
    const total = body.getBoundingClientRect().width;
    const max = total > 0 ? total - SPLITTER - MAP_MIN : Infinity;
    return Math.round(Math.max(PANEL_MIN, Math.min(width, max)));
  };
  const resizable = () => {
    const s = store.get();
    return !s.panelCollapsed && !s.mapCollapsed;
  };

  const apply = (s: ExplorerState) => {
    root.dataset.theme = s.dark ? 'dark' : 'light';
    body.style.setProperty('--jstex-h', `${s.mapHeight}px`);
    body.style.setProperty('--jstex-panel-w', `${s.panelWidth}px`);
    body.classList.toggle('jstex-body--collapsed', s.panelCollapsed);
    body.classList.toggle('jstex-body--map-collapsed', s.mapCollapsed);
    mapSlot.hidden = s.mapCollapsed;
    rail.hidden = !s.mapCollapsed;
    splitter.setAttribute('aria-valuenow', String(s.panelWidth));
    splitter.setAttribute('aria-valuemin', String(PANEL_MIN));
    splitter.classList.toggle('jstex-splitter--fixed', !resizable());
  };

  // Dragging: listen on window (capture) so the map canvas cannot swallow moves.
  let drag: { x: number; width: number } | null = null;
  const onMove = (e: MouseEvent) => {
    if (!drag) return;
    actions.setPanelWidth(clamp(drag.width + e.clientX - drag.x), false);
  };
  const onUp = () => {
    if (!drag) return;
    drag = null;
    body.classList.remove('jstex-body--resizing');
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', onUp, true);
    actions.setPanelWidth(store.get().panelWidth);
  };
  splitter.addEventListener('pointerdown', e => {
    if (!resizable() || e.button !== 0) return;
    e.preventDefault();
    drag = { x: e.clientX, width: store.get().panelWidth };
    body.classList.add('jstex-body--resizing');
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
  });
  splitter.addEventListener('keydown', e => {
    if (!resizable()) return;
    const step =
      e.key === 'ArrowRight' ? KEY_STEP : e.key === 'ArrowLeft' ? -KEY_STEP : 0;
    if (!step) return;
    e.preventDefault();
    actions.setPanelWidth(clamp(store.get().panelWidth + step));
  });
  splitter.addEventListener('dblclick', () => {
    if (resizable()) actions.setPanelWidth(clamp(PANEL_DEFAULT));
  });

  hide.addEventListener('click', () => actions.setMapCollapsed(true));
  rail.addEventListener('click', e => {
    if ((e.target as HTMLElement).closest('button'))
      actions.setMapCollapsed(false);
  });

  apply(store.get());
  const unsubscribe = store.subscribe((s, prev) => {
    if (
      s.dark !== prev.dark ||
      s.mapHeight !== prev.mapHeight ||
      s.panelWidth !== prev.panelWidth ||
      s.panelCollapsed !== prev.panelCollapsed ||
      s.mapCollapsed !== prev.mapCollapsed
    )
      apply(s);
  });

  return () => {
    unsubscribe();
    onUp();
    splitter.remove();
    hide.remove();
    rail.remove();
  };
}
