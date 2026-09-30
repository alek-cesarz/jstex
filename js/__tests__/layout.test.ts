import { describe, expect, it } from 'vitest';
import { mountLayout, PANEL_MIN, PANEL_DEFAULT } from '../ui/layout';
import { byRef as q, setupView } from './helpers';

/** Layout-A body as widget.ts builds it, with a measurable width (jsdom has no layout). */
function setupLayout(values: Record<string, unknown> = {}, width = 1200) {
  const view = setupView(values);
  view.el.innerHTML = `
    <div class="jstex-body" data-ref="body">
      <div class="jstex-body__panel" data-slot="panel"></div>
      <div class="jstex-body__map" data-slot="map"></div>
    </div>`;
  const body = q(view.el, 'body');
  body.getBoundingClientRect = () =>
    ({ left: 0, width, top: 0, height: 600 }) as DOMRect;
  const cleanup = mountLayout(view.el, view.store, view.actions);
  return { ...view, body, cleanup };
}

const pointer = (type: string, clientX: number) =>
  new MouseEvent(type, { clientX, bubbles: true });

describe('layout: resizable search panel', () => {
  it('puts a splitter between panel and map and applies the width', () => {
    const { el, body, store } = setupLayout({ panel_width: 360 });
    const splitter = q(el, 'splitter');
    expect(splitter.previousElementSibling?.getAttribute('data-slot')).toBe(
      'panel'
    );
    expect(splitter.nextElementSibling?.getAttribute('data-slot')).toBe('map');
    expect(splitter.getAttribute('role')).toBe('separator');
    expect(body.style.getPropertyValue('--jstex-panel-w')).toBe('360px');
    store.set({ panelWidth: 420 });
    expect(body.style.getPropertyValue('--jstex-panel-w')).toBe('420px');
  });

  it('dragging resizes live, clamps, and saves the width on release', () => {
    const { el, store, model } = setupLayout();
    const splitter = q(el, 'splitter');
    splitter.dispatchEvent(pointer('pointerdown', 300));
    window.dispatchEvent(pointer('pointermove', 400));
    expect(store.get().panelWidth).toBe(400);
    expect(model.values.panel_width).toBeUndefined(); // not saved mid-drag
    window.dispatchEvent(pointer('pointermove', 5000));
    expect(store.get().panelWidth).toBe(1200 - 12 - 320); // map keeps 320 px
    window.dispatchEvent(pointer('pointermove', -50));
    expect(store.get().panelWidth).toBe(PANEL_MIN);
    window.dispatchEvent(pointer('pointermove', 500));
    window.dispatchEvent(pointer('pointerup', 500));
    expect(model.values.panel_width).toBe(500);
    window.dispatchEvent(pointer('pointermove', 700)); // drag is over
    expect(store.get().panelWidth).toBe(500);
  });

  it('keyboard arrows resize, double-click resets', () => {
    const { el, store, model } = setupLayout();
    const splitter = q(el, 'splitter');
    splitter.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(store.get().panelWidth).toBe(PANEL_DEFAULT + 16);
    splitter.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    splitter.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    expect(model.values.panel_width).toBe(PANEL_DEFAULT - 16);
    splitter.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(model.values.panel_width).toBe(PANEL_DEFAULT);
    expect(splitter.getAttribute('aria-valuenow')).toBe(String(PANEL_DEFAULT));
  });

  it('does not drag while the panel or the map is collapsed', () => {
    const { el, store } = setupLayout({ panel_collapsed: true });
    const splitter = q(el, 'splitter');
    splitter.dispatchEvent(pointer('pointerdown', 44));
    window.dispatchEvent(pointer('pointermove', 400));
    expect(store.get().panelWidth).toBe(PANEL_DEFAULT);
    store.set({ panelCollapsed: false, mapCollapsed: true });
    splitter.dispatchEvent(pointer('pointerdown', 300));
    window.dispatchEvent(pointer('pointermove', 400));
    expect(store.get().panelWidth).toBe(PANEL_DEFAULT);
  });
});

describe('layout: collapsible map', () => {
  it('Hide map folds the map to a rail; Show map brings it back', () => {
    const { el, body, store, model } = setupLayout();
    expect(q(el, 'mapRail').hidden).toBe(true);
    q(el, 'hideMap').click();
    expect(store.get().mapCollapsed).toBe(true);
    expect(model.values.map_collapsed).toBe(true);
    expect(body.classList.contains('jstex-body--map-collapsed')).toBe(true);
    expect((el.querySelector('[data-slot="map"]') as HTMLElement).hidden).toBe(
      true
    );
    expect(q(el, 'mapRail').hidden).toBe(false);
    q(el, 'showMap').click();
    expect(store.get().mapCollapsed).toBe(false);
    expect(body.classList.contains('jstex-body--map-collapsed')).toBe(false);
    expect(q(el, 'mapRail').hidden).toBe(true);
  });

  it('the panel and the map are never both collapsed', () => {
    const { store, actions } = setupLayout();
    actions.setPanelCollapsed(true);
    actions.setMapCollapsed(true);
    expect([store.get().panelCollapsed, store.get().mapCollapsed]).toEqual([
      false,
      true
    ]);
    actions.setPanelCollapsed(true);
    expect([store.get().panelCollapsed, store.get().mapCollapsed]).toEqual([
      true,
      false
    ]);
  });

  it('drawing or zooming to the area shows the map again; an upload does not', async () => {
    const { store, actions } = setupLayout({ map_collapsed: true });
    await actions.uploadAoi(new File(['{}'], 'area.geojson'));
    expect(store.get().mapCollapsed).toBe(true);
    actions.zoomToAoi();
    expect(store.get().mapCollapsed).toBe(false);
    actions.setMapCollapsed(true);
    actions.setDrawMode('Box');
    expect(store.get().mapCollapsed).toBe(false);
  });

  it('cleanup removes the added elements', () => {
    const { el, cleanup } = setupLayout();
    cleanup();
    expect(q(el, 'splitter')).toBeNull();
    expect(q(el, 'mapRail')).toBeNull();
    expect(q(el, 'hideMap')).toBeNull();
  });
});
