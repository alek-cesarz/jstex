import { describe, expect, it } from 'vitest';
import { aoiSummary, mountAoiSection } from '../ui/aoi-section';
import { BOX, byRef as q, flush, setupView } from './helpers';

describe('area of interest section', () => {
  it('shows the empty hint, toggles draw modes and their hints', () => {
    const { el, store, actions } = setupView();
    mountAoiSection(el, store, actions);
    expect(q(el, 'hint').textContent).toBe(
      'Draw on the map or upload a GeoJSON file.'
    );
    expect(q(el, 'chip').hidden).toBe(true);
    (el.querySelector('[data-draw="Polygon"]') as HTMLElement).click();
    expect(store.get().drawMode).toBe('Polygon');
    expect(
      el.querySelector('[data-draw="Polygon"]')!.getAttribute('aria-pressed')
    ).toBe('true');
    expect(q(el, 'hint').textContent).toContain('double-click to finish');
    (el.querySelector('[data-draw="Box"]') as HTMLElement).click();
    expect(store.get().drawMode).toBe('Box');
    (el.querySelector('[data-draw="Box"]') as HTMLElement).click();
    expect(store.get().drawMode).toBeNull();
  });

  it('chip shows kind and area; zoom and remove work', () => {
    const { el, store, actions } = setupView();
    mountAoiSection(el, store, actions);
    actions.setAoi(BOX);
    expect(q(el, 'chip').hidden).toBe(false);
    expect(q(el, 'chipText').textContent).toBe('Polygon · 8,666 km²');
    expect(
      aoiSummary({ type: 'MultiPolygon', coordinates: [BOX.coordinates] })
    ).toBe('Multipolygon · 8,666 km²');
    q(el, 'zoom').click();
    expect(store.get().zoomToAoi).toBe(1);
    q(el, 'remove').click();
    expect(store.get().query.aois).toEqual([]);
  });

  it('uploads the chosen file through Python and shows a rejection inline', async () => {
    const { el, store, actions, backend } = setupView();
    mountAoiSection(el, store, actions);
    const input = q(el, 'file') as HTMLInputElement;
    const choose = (name: string) => {
      Object.defineProperty(input, 'files', {
        value: [new File(['{"type":"Point"}'], name)],
        configurable: true
      });
      input.dispatchEvent(new Event('change'));
    };
    backend.uploadAoi.mockRejectedValueOnce(
      new Error('No polygon geometry found')
    );
    choose('points.geojson');
    await flush();
    await flush();
    expect(backend.uploadAoi).toHaveBeenCalledWith('{"type":"Point"}');
    expect(q(el, 'error').textContent).toBe(
      'points.geojson: No polygon geometry found The previous area is unchanged.'
    );
    choose('area.geojson');
    await flush();
    await flush();
    expect(q(el, 'error').hidden).toBe(true);
    expect(q(el, 'chip').hidden).toBe(false);
  });
});
