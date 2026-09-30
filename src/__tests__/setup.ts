// jsdom has no DragEvent; @lumino/dragdrop (loaded by @jupyterlab/ui-components)
// subclasses it at import time. JupyterLab's own test setup polyfills it too.
if (typeof globalThis.DragEvent === 'undefined') {
  class DragEventPolyfill extends MouseEvent {}
  (globalThis as Record<string, unknown>).DragEvent = DragEventPolyfill;
}
// jsdom has no matchMedia either (read by @jupyterlab/ui-components at import).
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false
    }) as MediaQueryList;
}
