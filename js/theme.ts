/**
 * Light/dark support. The widget follows the host's theme, in this order:
 * JupyterLab (body[data-jp-theme-light]), VS Code (body.vscode-dark /
 * vscode-high-contrast), Colab (html[theme=dark]), then the OS preference.
 */
import MapboxStyle from '@eox/map/src/custom/layers/MapboxStyle.js';
import type { BasemapConfig, BasemapSource } from './types';

export function isDark(doc: Document = document): boolean {
  const body = doc.body;
  const jp = body?.dataset.jpThemeLight;
  if (jp === 'false') return true;
  if (jp === 'true') return false;
  if (
    body?.classList.contains('vscode-dark') ||
    body?.classList.contains('vscode-high-contrast')
  ) {
    return !body.classList.contains('vscode-high-contrast-light');
  }
  if (body?.classList.contains('vscode-light')) return false;
  const colab = doc.documentElement.getAttribute('theme');
  if (colab === 'dark') return true;
  if (colab === 'light') return false;
  return (
    typeof matchMedia === 'function' &&
    matchMedia('(prefers-color-scheme: dark)').matches
  );
}

/** Call `onChange` whenever any of the theme signals above changes. Returns a stop function. */
export function watchTheme(
  onChange: () => void,
  doc: Document = document
): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(doc.body, {
    attributes: true,
    attributeFilter: ['data-jp-theme-light', 'class']
  });
  observer.observe(doc.documentElement, {
    attributes: true,
    attributeFilter: ['theme', 'class']
  });
  const media =
    typeof matchMedia === 'function'
      ? matchMedia('(prefers-color-scheme: dark)')
      : null;
  media?.addEventListener?.('change', onChange);
  return () => {
    observer.disconnect();
    media?.removeEventListener?.('change', onChange);
  };
}

/** Only used when Python sent no basemap (e.g. an old kernel). Same default as jstex.config. */
const POSITRON: BasemapSource = {
  url: 'https://tiles.openfreemap.org/styles/positron',
  attribution:
    '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> <a href="https://www.openmaptiles.org/" target="_blank">&copy; OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
  kind: 'style'
};
export const DEFAULT_BASEMAP: BasemapConfig = {
  light: POSITRON,
  dark: POSITRON
};

/**
 * eox-map ships its MapboxStyle layer (ol-mapbox-style) in the "advanced
 * layers" plugin, which also pulls in STAC, WebGL layers and proj4. Register
 * just this layer type, through the same window hook the plugin uses.
 */
function registerMapboxStyle(): void {
  const w = window as unknown as {
    eoxMapAdvancedOlLayers?: Record<string, unknown>;
  };
  if (!w.eoxMapAdvancedOlLayers?.MapboxStyle)
    w.eoxMapAdvancedOlLayers = { ...w.eoxMapAdvancedOlLayers, MapboxStyle };
}

/**
 * The eox-map layer for the themed basemap. Each kind has its own layer id
 * (eox-map cannot change a layer's type in place) and sits below the data layers.
 */
export function basemapLayer(
  basemap: BasemapConfig,
  dark: boolean
): Record<string, unknown> {
  const source = dark ? basemap.dark : basemap.light;
  const kind = source.kind ?? (source.url.includes('{z}') ? 'xyz' : 'style');
  if (kind === 'style') {
    registerMapboxStyle();
    return {
      type: 'MapboxStyle',
      properties: { id: 'basemap-style', zIndex: -1, mapboxStyle: source.url }
    };
  }
  return {
    type: 'Tile',
    properties: { id: 'basemap-xyz', zIndex: -1 },
    source: { type: 'XYZ', url: source.url, attributions: source.attribution }
  };
}
