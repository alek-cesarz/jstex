/**
 * Map view: eox-map + eox-drawtools (Box), AOI outline, footprints, highlight,
 * click-to-activate. One map per widget view — drawtools is bound to this
 * view's map element (not a global selector), so several explorers coexist.
 */
import type { Actions } from '../actions';
import { bboxTo3857, geometryBbox, itemFeatures, unionBbox } from '../format';
import { S } from '../strings';
import { createFootprintPopup } from './footprint-popup';
import type { Store } from '../store';
import { basemapLayer } from '../theme';
import type { AoiGeometry, ExplorerState } from '../types';

type MapActions = Pick<Actions, 'activate' | 'setAoi' | 'setDrawMode'>;

interface OlFeature {
  get(key: string): unknown;
}
interface OlMap {
  on(
    event: 'singleclick',
    cb: (evt: { pixel: [number, number] }) => void
  ): void;
  forEachFeatureAtPixel(
    pixel: [number, number],
    cb: (f: OlFeature) => void
  ): void;
  updateSize(): void;
}
interface EoxMapElement extends HTMLElement {
  layers: unknown[];
  zoom: number;
  center: number[];
  zoomExtent: number[];
  controls: Record<string, unknown>;
  map?: OlMap;
  addOrUpdateLayer(layer: unknown): void;
}
interface EoxDrawtoolsElement extends HTMLElement {
  for: HTMLElement | string;
  type: string;
  projection: string;
  format: string;
  noShadow: boolean;
  unstyled: boolean;
  multipleFeatures: boolean;
  startDrawing(): void;
  stopDrawing(): void;
  discardDrawing(): void;
  /** Lit: resolves after the element re-rendered (e.g. rebuilt its draw interaction). */
  updateComplete?: Promise<unknown>;
}

const FOOTPRINT_STYLE = {
  'stroke-color': '#2a7de1',
  'stroke-width': 1.5,
  // Near-transparent fill: keeps click hit-detection inside the polygon without
  // stacked identical footprints piling up into an opaque blue (STEX gotcha).
  'fill-color': 'rgba(42,125,225,0.004)'
};
const HIGHLIGHT_STYLE = {
  'stroke-color': '#ff8225',
  'stroke-width': 2.5,
  'fill-color': 'rgba(255,130,37,0.2)'
};
const AOI_STYLE = {
  'stroke-color': '#0b7285',
  'stroke-width': 2,
  'stroke-line-dash': [6, 4],
  'fill-color': 'rgba(11,114,133,0.06)'
};

function vectorLayer(
  id: string,
  features: GeoJSON.Feature[],
  style: Record<string, unknown>
): Record<string, unknown> {
  const fc: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features };
  return {
    type: 'Vector',
    properties: { id },
    source: {
      type: 'Vector',
      format: 'GeoJSON',
      url: 'data:,' + encodeURIComponent(JSON.stringify(fc))
    },
    style
  };
}

/** Polygon from a drawupdate detail (FeatureCollection in 'geojson' format, or feature array). */
export function polygonFromDrawDetail(detail: unknown): AoiGeometry | null {
  const d = detail as
    { type?: string; features?: GeoJSON.Feature[] } | unknown[] | null;
  const features: unknown[] = Array.isArray(d)
    ? d
    : d && d.type === 'FeatureCollection'
      ? (d.features ?? [])
      : [];
  for (let i = features.length - 1; i >= 0; i--) {
    let f = features[i] as GeoJSON.Feature | string;
    if (typeof f === 'string') {
      try {
        f = JSON.parse(f) as GeoJSON.Feature;
      } catch {
        continue;
      }
    }
    const g = (f as GeoJSON.Feature)?.geometry;
    if (g && (g.type === 'Polygon' || g.type === 'MultiPolygon')) return g;
  }
  return null;
}

export function mountMap(
  el: HTMLElement,
  store: Store<ExplorerState>,
  actions: MapActions
): () => void {
  const wrap = document.createElement('div');
  wrap.className = 'jstex-map-wrap'; // fills .jstex-body__map; the body sets the height
  const map = document.createElement('eox-map') as EoxMapElement;
  map.className = 'jstex-map';
  const draw = document.createElement('eox-drawtools') as EoxDrawtoolsElement;
  draw.style.display = 'none';
  const tip = document.createElement('div');
  tip.className = 'jstex-draw-tip';
  tip.hidden = true;
  wrap.append(map, draw, tip);
  el.appendChild(wrap);

  map.layers = [
    basemapLayer(store.get().basemap, store.get().dark),
    vectorLayer('aoi', [], AOI_STYLE),
    vectorLayer('footprints', [], FOOTPRINT_STYLE),
    vectorLayer('highlight', [], HIGHLIGHT_STYLE)
  ];
  map.center = [1668000, 6048000]; // Europe, EPSG:3857 (same default as STEX)
  map.zoom = 4;
  map.controls = { Zoom: {} };

  draw.for = map;
  draw.type = 'Polygon';
  draw.projection = 'EPSG:4326';
  draw.format = 'geojson';
  draw.noShadow = true;
  draw.unstyled = true;
  draw.multipleFeatures = false;
  draw.addEventListener('drawupdate', e => {
    const geometry = polygonFromDrawDetail((e as CustomEvent).detail);
    if (!geometry) return; // includes the empty update fired by discardDrawing()
    actions.setAoi(geometry); // one AOI: replaces the previous one, ends drawing
    draw.discardDrawing(); // the 'aoi' layer renders the AOI from state
  });

  const renderAoi = (s: ExplorerState) => {
    const features = s.query.aois
      .filter(a => a.selected)
      .map(a => ({
        type: 'Feature' as const,
        geometry: a.geometry,
        properties: {}
      }));
    map.addOrUpdateLayer(vectorLayer('aoi', features, AOI_STYLE));
  };
  const renderFootprints = (s: ExplorerState) => {
    const features = itemFeatures(s.items);
    map.addOrUpdateLayer(vectorLayer('footprints', features, FOOTPRINT_STYLE));
    const box = unionBbox(features.map(f => geometryBbox(f.geometry)));
    if (box) map.zoomExtent = bboxTo3857(box, 0.1);
  };
  const zoomToAoi = (s: ExplorerState) => {
    const aoi = s.query.aois.find(a => a.selected);
    const box = aoi ? geometryBbox(aoi.geometry) : null;
    if (box) map.zoomExtent = bboxTo3857(box, 0.15);
  };
  const setDrawMode = (s: ExplorerState) => {
    tip.hidden = !s.drawMode;
    tip.textContent =
      s.drawMode === 'Box'
        ? S.drawBoxHint
        : s.drawMode === 'Polygon'
          ? S.drawPolygonHint
          : '';
    if (!s.drawMode) {
      draw.stopDrawing();
      return;
    }
    const mode = s.drawMode;
    if (draw.type === mode) {
      draw.startDrawing();
      return;
    }
    // Changing `type` makes eox-drawtools rebuild its draw interaction
    // asynchronously; starting before that finishes draws with the old type
    // (Polygon -> Box did nothing). Start once the element has re-rendered.
    draw.type = mode;
    void (draw.updateComplete ?? Promise.resolve()).then(() => {
      if (store.get().drawMode === mode) draw.startDrawing();
    });
  };
  const renderHighlight = (s: ExplorerState) => {
    const active = s.items.filter(i => i.id === s.activeId);
    map.addOrUpdateLayer(
      vectorLayer('highlight', itemFeatures(active), HIGHLIGHT_STYLE)
    );
  };

  const popup = createFootprintPopup(wrap, id => actions.activate(id));

  const unsubscribe = store.subscribe((s, prev) => {
    if (s.items !== prev.items || (s.drawMode && !prev.drawMode)) popup.close();
    if (s.query.aois !== prev.query.aois) renderAoi(s);
    if (s.items !== prev.items) renderFootprints(s);
    if (s.items !== prev.items || s.activeId !== prev.activeId)
      renderHighlight(s);
    if (s.drawMode !== prev.drawMode) setDrawMode(s);
    if (s.zoomToAoi !== prev.zoomToAoi) zoomToAoi(s);
    if (s.dark !== prev.dark || s.basemap !== prev.basemap)
      map.addOrUpdateLayer(basemapLayer(s.basemap, s.dark));
  });

  // The OL map is created asynchronously by eox-map: attach once it exists.
  let cancelled = false;
  const attachClick = () => {
    if (cancelled) return;
    const ol = map.map;
    if (!ol?.on) {
      requestAnimationFrame(attachClick);
      return;
    }
    ol.on('singleclick', evt => {
      const s = store.get();
      if (s.drawMode) return;
      const known = new Set(s.items.map(i => i.id));
      const hits = new Set<string>();
      ol.forEachFeatureAtPixel(evt.pixel, f => {
        const id = f.get('id');
        if (typeof id === 'string' && known.has(id)) hits.add(id);
      });
      if (hits.size === 0) popup.close();
      else if (hits.size === 1) {
        popup.close();
        actions.activate([...hits][0]);
      } else {
        // Same as STEX: list every item under the click, in result order.
        popup.show(
          evt.pixel,
          s.items.filter(i => hits.has(i.id)),
          s.activeId
        );
      }
    });
  };
  attachClick();

  const resize = new ResizeObserver(() => map.map?.updateSize());
  resize.observe(wrap);

  const initial = store.get();
  renderAoi(initial);
  if (initial.items.length) renderFootprints(initial);

  return () => {
    cancelled = true;
    popup.close();
    unsubscribe();
    resize.disconnect();
    wrap.remove();
  };
}
