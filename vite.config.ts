import { defineConfig } from 'vite';

// anywidget loads the ESM from a blob URL, so the bundle must be ONE file:
// no code-split chunks (inlineDynamicImports) and one CSS file.
export default defineConfig({
  plugins: [
    {
      // @eox/ui's @font-face lists url(/material-symbols-*.woff2) followed by a
      // jsdelivr CDN fallback. The root-relative copy can never be served from a
      // blob-loaded widget, so don't ship it; browsers use the CDN entry.
      name: 'jstex-drop-eox-fonts',
      generateBundle(_options, bundle) {
        for (const name of Object.keys(bundle))
          if (name.endsWith('.woff2')) delete bundle[name];
      }
    }
  ],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    lib: {
      entry: 'js/widget.ts',
      formats: ['es'],
      fileName: () => 'widget.js'
    },
    outDir: 'jstex/static',
    emptyOutDir: true,
    cssCodeSplit: false,
    sourcemap: false,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        assetFileNames: info =>
          info.name?.endsWith('.css') ? 'widget.css' : '[name][extname]'
      }
    }
  },
  test: {
    include: ['js/__tests__/**/*.test.ts', 'src/__tests__/**/*.test.ts'],
    environment: 'jsdom',
    setupFiles: ['src/__tests__/setup.ts'],
    // @eox/map sources import 'ol/...' without extensions: let Vite resolve them.
    server: { deps: { inline: [/@eox\/map/] } }
  }
});
