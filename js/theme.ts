/**
 * Light/dark support. The widget follows the host's theme, in this order:
 * JupyterLab (body[data-jp-theme-light]), VS Code (body.vscode-dark /
 * vscode-high-contrast), Colab (html[theme=dark]), then the OS preference.
 */
import type { BasemapConfig } from './types';

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

/** Only used when Python sent no basemap (e.g. an old kernel). Same defaults as jstex.config / STEX. */
export const DEFAULT_BASEMAP: BasemapConfig = {
  light: {
    url: 'https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png',
    attribution: '© OpenStreetMap contributors © CARTO'
  },
  dark: {
    url: 'https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}@2x.png',
    attribution: '© Stadia Maps © OpenMapTiles © OpenStreetMap'
  }
};

export function basemapLayer(
  basemap: BasemapConfig,
  dark: boolean
): Record<string, unknown> {
  const source = dark ? basemap.dark : basemap.light;
  return {
    type: 'Tile',
    properties: { id: 'basemap' },
    source: { type: 'XYZ', url: source.url, attributions: source.attribution }
  };
}
