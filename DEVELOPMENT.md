# Developing jstex

## Setup

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev,test]"
jupyter labextension develop . --overwrite
jlpm build:widget          # after every change under js/
```

## Commands

| Command                                             | What                                                            |
| --------------------------------------------------- | --------------------------------------------------------------- |
| `pytest -q tests`                                   | Python unit tests (backend, auth, codec, widget protocol)       |
| `jlpm vitest run`                                   | Front-end unit tests (jsdom)                                    |
| `npx tsc -p js/tsconfig.json`                       | Typecheck the widget                                            |
| `ruff check jstex tests && ruff format jstex tests` | Python lint/format                                              |
| `jlpm lint`                                         | Template lint for the labextension + prettier                   |
| `cd ui-tests && jlpm playwright test`               | Galata e2e (starts `fake_stac.py` + JupyterLab)                 |
| `jlpm build:prod && python -m build --wheel`        | Wheel with a fresh labextension and widget bundle (see Gotchas) |

## Architecture

The full description (diagrams, widget protocol, search/auth flows, state
model) is in [docs/architecture.md](docs/architecture.md). In short:

- **Python owns all traffic and secrets.** `jstex/stac.py` (pystac-client
  `StacApiIO`) talks to STAC; `jstex/auth.py` reads the token from the hub.
  The browser never sees a token.
- **The widget is a view.** `js/widget.ts` mounts the search panel, map,
  results and details on a per-render store (`js/store.ts`); views change
  state only through `Actions` (`js/actions.ts`). Results arrive as
  `{"type":"page"}` messages; small state (query, selection, status) is synced
  traitlets (`js/model-sync.ts`).
- **The labextension** (`src/index.ts`) only publishes the `jstex`
  translation bundle for the widget.
- **Copied from STEX:** `js/antimeridian.ts` (+ tests) — the provenance header
  names the STEX commit. The `?q=` codec in `jstex/query.py` is tested against
  golden strings produced by STEX's own encoder (`tests/fixtures/`).
- **Docs screenshot:** `docs/images/explorer-dark.png` comes from
  `JSTEX_DESIGN_SHOTS=1 jlpm playwright test tests/design.spec.ts`
  (`ui-tests/design-review/1400-dark-3-results.png`).

## Gotchas

- Names: distribution and labextension are `jupyterlab-jstex`, the import
  package is `jstex` (`[tool.hatch.build.targets.wheel] packages`), the
  gettext domain is `jstex`. Switching an old dev env: `pip uninstall jstex`,
  delete `share/jupyter/labextensions/@jstex`, then `pip install -e .` and
  `jupyter labextension develop . --overwrite`.
- The GitHub social preview (`docs/images/social-preview.png`, 1280×640) has
  no API: upload it in the repo's Settings → General → Social preview.

- `vanilla-calendar-pro` ≥ 3.2 needs `extensions: [time]` for
  `selectionTimeMode` (STEX pins 3.1 and does not); without it opening the
  calendar throws. Its popup lives in `<body>`, outside `.jstex`: style it via
  `body > .vc.jstex-vc` and the `--vc-*` variables (see `js/styles.css`).

- The bundle must be one file (anywidget loads it from a blob URL):
  `inlineDynamicImports`, and @eox/ui icon fonts are dropped (their
  `@font-face` falls back to jsdelivr).
- `js/define-guard.ts` must stay the first import of `js/widget.ts` (each new
  `Explorer()` re-evaluates the bundle; @eox modules define custom elements at
  load).
- After rebuilding the bundle, restart kernels that hold old explorers,
  otherwise reopening the notebook logs `[anywidget] Failed to initialize model`.
- Basemaps: the default is OpenFreeMap Positron, a vector style, drawn by
  eox-map's `MapboxStyle` layer (ol-mapbox-style). Only that layer type is
  registered (`registerMapboxStyle()` in `js/theme.ts`), not eox-map's whole
  advanced-layers plugin. A layer cannot change type in place, so the style
  and XYZ basemaps use separate layer ids (`basemap-style` / `basemap-xyz`,
  `zIndex: -1`), and a theme switch between kinds hides one and shows the
  other; eox-map reads `visible` from the top level of a layer definition.
- Map controls (zoom, attribution) live in eox-map's shadow root, which exposes
  only colour variables; `js/ui/map.ts` adds a `<style>` there (CONTROLS_CSS)
  with selectors more specific than eox-map's own.
- Open-ended dates are sent closed (1900-01-01 / 2099-12-31): the CDSE
  firewall rejects `../end` intervals.
- ESLint (template config) ignores `js/`; the widget is checked by
  `tsc -p js/tsconfig.json` and prettier. Keep new widget code in `js/`.
- Token expiry: jstex retries a 401 once after re-reading the hub; the hub
  refreshes the upstream token at most every `auth_refresh_age` seconds.
- `js/define-guard.ts` must also stay listed in `package.json` `sideEffects`
  (see Decisions below): the template's list covers styles only and Rollup
  drops side-effect-only imports that are not listed.
- `jlpm i18n:extract` runs `scripts/i18n_extract.py`: jupyterlab-translate
  scans every `**/*.ts` and ignores only the top-level `node_modules/`, so it
  is run on a staging copy of our sources (otherwise `ui-tests/node_modules`
  floods the template). `.gitignore` un-ignores `jstex/locale/` (the
  template ignores `*.pot`/`*.mo`).
- Changing `eox-drawtools`' `type` rebuilds its draw interaction
  asynchronously; `js/ui/map.ts` starts drawing after `updateComplete`.
- **Local wheels:** `python -m build` skips the whole front-end build when
  `jstex/labextension/static/style.js` exists (the template's
  `skip-if-exists`, so an sdist builds without Node) and silently packages
  whatever `jstex/static/widget.js` is in the tree. Build a local wheel with
  `jlpm build:prod && python -m build --wheel`. CI and releases start from a
  clean checkout and are not affected.
- After `jlpm build:prod`, run `jlpm build` (development labextension) before
  local Galata runs: with the production labextension from the tree, Galata
  locally stays on the JupyterLab splash (a plain browser loads fine, and CI's
  integration tests pass on the production wheel).
- Galata's default viewport (1024 px) puts the widget in the narrow, stacked
  layout; `explorer.spec.ts` sets 1600 × 1200. Running a cell leaves an empty
  cell below it — address cells by index/count, not `last()`.

## Translations (i18n)

jstex follows the JupyterLab guide for extension authors: gettext domain
`jstex`, strings extracted with `jupyterlab-translate`, translations shipped
in the wheel under `jstex/locale/<ll_CC>/LC_MESSAGES/jstex.{po,json,mo}` and
registered with the `jupyterlab.locale` entry point (`pyproject.toml`).

- **Writing strings:** only in `js/strings.ts`, as literal
  `trans.__('Text %1', value)` / `trans._n(…)` calls — the extractor finds
  nothing else. Kernel-side messages (errors) are English for now.
- **How the widget gets them:** the labextension plugin (`src/index.ts`)
  publishes `translator.load('jstex')` under `Symbol.for('jstex.i18n')`;
  `js/i18n.ts` reads it or falls back to English (VS Code, Colab, Voilà).
- **Refresh the template:** `jlpm i18n:extract` → `jstex/locale/jstex.pot`
  (run before each release; commit it).
- **Add a language** (needs the `gettext` system package for `update`):
  ```bash
  jupyterlab-translate update . jstex -l de_DE   # or: pybabel init -i jstex/locale/jstex.pot -d jstex/locale -l de_DE -D jstex
  # translate jstex/locale/de_DE/LC_MESSAGES/jstex.po
  jupyterlab-translate compile . jstex -l de_DE  # -l is required
  git add jstex/locale/de_DE
  ```
- **Gotchas:** JupyterLab serves a package's translations only for locales
  whose official language pack is installed; keep `jstex/__init__.py`
  import-light (the server imports it via the entry point, and a failing
  import disables all third-party translations). If jstex ever becomes
  public, it can instead be added to jupyterlab/language-packs
  (`repository-map.yml`) for Crowdin translation.

## Manual smoke test on the real hub

1. As a user with access to a restricted collection: `jstex.Explorer()` — the
   collection is listed and no Anonymous badge shows.
2. Search it, open an item, run `jstex.item(<copied self link>)` in a new cell.
3. Leave the notebook idle longer than the access-token lifetime, search again —
   it succeeds (possibly after one Retry within `auth_refresh_age`).

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
