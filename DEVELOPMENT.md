# Developing jstex

## Decisions (stage 1 spikes)

- **eox-map in a cell output:** works with a single-file Vite ESM bundle
  (`inlineDynamicImports`). Bundle size: 4,245 KB (1,083 KB gzip).
  `js/define-guard.ts` must stay listed in `package.json` `sideEffects`:
  the template's list covers styles only, and Rollup silently dropped the
  guard, so re-running an Explorer cell failed with "eox-map-compare has
  already been used".
- **THREAD_SEND_OK:** yes — anywidget `send()` and trait updates from a
  worker thread do reach the front end reliably (ipykernel 7.4.0).
  Guarded by `ui-tests/tests/spike.spec.ts`.
