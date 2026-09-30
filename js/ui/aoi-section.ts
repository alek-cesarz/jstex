/**
 * One area of interest: draw a Polygon or a Box, or upload a GeoJSON file
 * (validated in Python). A new area replaces the old one. The chip shows the
 * kind and area with Zoom-to and Remove.
 */
import type { Actions } from '../actions';
import { escapeHtml, formatArea, geometryAreaKm2 } from '../format';
import { ICON } from '../icons';
import type { Store } from '../store';
import { S } from '../strings';
import type { AoiGeometry, DrawMode, ExplorerState } from '../types';

type AoiActions = Pick<
  Actions,
  'setAoi' | 'setDrawMode' | 'uploadAoi' | 'zoomToAoi'
>;

export function aoiSummary(geometry: AoiGeometry | undefined): string {
  if (!geometry) return '';
  const kind = geometry.type === 'Polygon' ? S.aoiPolygon : S.aoiMultiPolygon;
  return `${kind} · ${formatArea(geometryAreaKm2(geometry))}`;
}

export function mountAoiSection(
  el: HTMLElement,
  store: Store<ExplorerState>,
  actions: AoiActions
): () => void {
  el.innerHTML = `
    <div class="jstex-aoi-tools">
      <button type="button" class="jstex-control" data-draw="Polygon">${ICON.polygon}<span>${escapeHtml(S.polygon)}</span></button>
      <button type="button" class="jstex-control" data-draw="Box">${ICON.box}<span>${escapeHtml(S.box)}</span></button>
      <button type="button" class="jstex-control" data-ref="upload" title="${escapeHtml(S.uploadTitle)}">${ICON.upload}<span>${escapeHtml(S.upload)}</span></button>
      <input type="file" accept=".geojson,.json,application/geo+json,application/json" data-ref="file" hidden>
    </div>
    <div class="jstex-chip" data-ref="chip">
      <span class="jstex-chip__text" data-ref="chipText"></span>
      <button type="button" class="jstex-icon" data-ref="zoom" title="${escapeHtml(S.zoomToAoi)}" aria-label="${escapeHtml(S.zoomToAoi)}">${ICON.target}</button>
      <button type="button" class="jstex-icon" data-ref="remove" title="${escapeHtml(S.removeAoi)}" aria-label="${escapeHtml(S.removeAoi)}">${ICON.close}</button>
    </div>
    <div class="jstex-hint" data-ref="hint"></div>
    <div class="jstex-hint jstex-hint--err" role="alert" data-ref="error"></div>`;
  const ref = <T extends HTMLElement = HTMLElement>(name: string) =>
    el.querySelector(`[data-ref="${name}"]`) as T;
  const file = ref<HTMLInputElement>('file');

  const update = (s: ExplorerState) => {
    const aoi = s.query.aois.find(a => a.selected)?.geometry;
    el.querySelectorAll<HTMLElement>('[data-draw]').forEach(b => {
      b.setAttribute('aria-pressed', String(b.dataset.draw === s.drawMode));
    });
    ref('chip').hidden = !aoi;
    ref('chipText').textContent = aoiSummary(aoi);
    const hint =
      s.drawMode === 'Polygon'
        ? S.drawPolygonHint
        : s.drawMode === 'Box'
          ? S.drawBoxHint
          : aoi
            ? ''
            : S.aoiEmptyHint;
    ref('hint').textContent = hint;
    ref('hint').hidden = !hint;
    ref('error').textContent = s.aoiError;
    ref('error').hidden = !s.aoiError;
  };

  el.addEventListener('click', e => {
    const draw = (e.target as HTMLElement).closest<HTMLElement>('[data-draw]');
    if (draw) {
      const mode = draw.dataset.draw as DrawMode;
      actions.setDrawMode(store.get().drawMode === mode ? null : mode);
    }
  });
  ref('upload').addEventListener('click', () => file.click());
  file.addEventListener('change', () => {
    const chosen = file.files?.[0];
    file.value = ''; // choosing the same file again must fire 'change' again
    if (chosen) void actions.uploadAoi(chosen);
  });
  ref('zoom').addEventListener('click', () => actions.zoomToAoi());
  ref('remove').addEventListener('click', () => actions.setAoi(null));

  update(store.get());
  return store.subscribe((s, prev) => {
    if (
      s.query.aois !== prev.query.aois ||
      s.drawMode !== prev.drawMode ||
      s.aoiError !== prev.aoiError
    )
      update(s);
  });
}
