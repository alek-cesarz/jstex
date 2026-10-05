# jstex Stage 1 (in-cell explorer widget) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `jstex` v0.1.0 — a pip-installable JupyterLab extension whose `jstex.Explorer()` widget lets a logged-in JupyterHub user search a STAC catalogue (including restricted collections) on a map and get items, attribute values and asset links into Python.

**Architecture:** A new private repo scaffolded from the official JupyterLab extension template. Python (`jstex/`) owns all STAC traffic and the OIDC token (read live from JupyterHub `auth_state`); an anywidget front end (`js/`, built by Vite into `jstex/static/`) is a thin view — a STEX-like search panel (collection search, dates, one area of interest, queryables-driven filters) beside the map, then results and item details — talking to Python over anywidget custom messages. The labextension (`src/`) stays a template stub until stage 3.

**Tech Stack:** Python ≥ 3.10, anywidget 0.11, @jupyterlab/translation + jupyterlab-translate (i18n), pystac-client 0.9 / pystac 1.15, requests, shapely 2, traitlets; TypeScript, Vite 7 (library build), Vitest 3 + jsdom, `@eox/map` 2.8 + `@eox/drawtools` 1.6; pytest + responses; Galata (Playwright for JupyterLab); hatchling + jupyter-builder (template).

**Spec:** `docs/superpowers/specs/2026-09-29-jstex-jupyterlab-design.md`. Read §1–§5, §7, §9 "Stage 1", §10, §11 before starting.

## Global Constraints

- Package/import name `jstex`; labextension name `@jstex/labextension`; env vars prefixed `JSTEX_`; server routes (stage 3) under `/jstex/api/`.
- Private: repo `alek-cesarz/jstex` private; `Private :: Do Not Upload` classifier; **no LICENSE file, no `license` field**; never publish to PyPI or npm.
- Default STAC URL `https://stac.opensearch.dataspace.copernicus.eu/v1/`; this endpoint rejects searches without a collection → Search disabled until ≥ 1 collection is selected.
- Token read from `GET $JUPYTERHUB_API_URL/users/$JUPYTERHUB_USER` (never `/hub/api/user`), header `Authorization: token $JUPYTERHUB_API_TOKEN`, field `auth_state.access_token`. The refresh token is never returned, logged, or sent to JS.
- STAC calls carry `Authorization: Bearer <token>` injected per request via pystac-client `StacApiIO(request_modifier=…)` (the spec says `modifier=`; that parameter is for STAC objects — `request_modifier` is the correct one).
- QueryState wire format = STEX `src/lib/query-codec.ts`: base64url (no padding) of UTF-8 JSON; `aois` compact `[{g, s}]`; legacy `aoi` accepted on decode; defaults omitted (`sort` = `{field:"properties.datetime",direction:"desc"}`, `pageSize` = 50); coordinates rounded to 6 dp using JS `Math.round` semantics (half-up, i.e. `floor(x*1e6+0.5)/1e6`).
- `datetime` may be open-ended. It is sent whenever either end is set, always as a closed `"from/to"` interval: a missing start becomes `1900-01-01T00:00:00Z`, a missing end `2099-12-31T23:59:59Z` (user rule, 2026-09-30). Verified on the CDSE endpoint: `…/..` works but `../…` is blocked by its firewall ("Request Rejected"), so open intervals are never sent. `intersects` only when an AOI is selected. POST body key `filter-lang` = `"cql2-json"`.
- Layout A (approved by the user 2026-09-30 from mockups): search panel (300 px, collapsible sections, Search pinned at its bottom) beside the map, both the same drag-resizable height (default 600 px); results + item details below; panel collapses to an icon rail only when the user clicks ◀; below ~760 px widget width the panel stacks above the map. No collection tags.
- One area of interest only (user decision 2026-09-30): Polygon, Box or GeoJSON upload; a new one replaces the old one. Upload validation happens in Python (`jstex/aoi.py`).
- Attribute filters come from the selected collections' queryables (fields shared by all of them). UI operators `= != < <= > >= IN` are sent as CQL2-JSON with `!=` → `<>` and `IN` → `in` (CDSE answers HTTP 400 to `!=`/`IN`, verified 2026-09-30). Search needs ≥ 1 collection and valid filters; area and dates are optional (a hint warns without them).
- Light and dark modes: the widget follows the host theme (JupyterLab `body[data-jp-theme-light]`, VS Code `body.vscode-dark`, Colab `html[theme]`, else the OS) live, via `data-theme` on the `.jstex` root; the basemap switches light ↔ dark with it.
- i18n follows the JupyterLab standard (gettext via `ITranslator`, domain **`jstex`**): English source strings only in v0.1, but every UI string is a literal `trans.__('…')` / `trans._n(…)` call in `js/strings.ts` (extraction rule of `jupyterlab-translate`). The labextension (`src/index.ts`) publishes `translator.load('jstex')` under `Symbol.for('jstex.i18n')`; the widget uses it or falls back to English (VS Code, Colab). Translations ship in the wheel as `jstex/locale/<ll_CC>/LC_MESSAGES/jstex.{po,json,mo}` via the `jupyterlab.locale` entry point; the template is `jstex/locale/jstex.pot`. Messages produced in the kernel (error texts) stay English in v0.1. All CSS scoped under `.jstex`; colours from `--jp-*` vars with fallbacks. No module-level mutable state in `js/` (per-instance store). Custom elements loaded via `customElements.get(tag)` guard.
- Basemaps are deployment config with the **same providers, defaults and rules as STEX** (`src/lib/config.ts`): light = CartoDB Voyager `https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png` (key param `key`), dark = Stadia Alidade Smooth Dark `https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png` (key param `api_key`); `{r}` → `@2x`; key appended as `?<param>=<key>` when set. Env vars `JSTEX_BASEMAP_{LIGHT,DARK}_{URL,KEY,KEY_PARAM,ATTRIBUTION}`. Both providers need an API key or a registered domain; without one they serve watermark tiles — the user takes care of keys/domain registration for the hub.
- `js/define-guard.ts` must be the first import of `js/widget.ts`: anywidget re-evaluates the bundle for every new `Explorer()` and the bundled `@eox/*` modules call `customElements.define` at load — without the guard the second explorer in a kernel fails with "the name "eox-map-compare" has already been used" (found in the plan's live smoke test). Rollup evaluates inlined dynamic imports eagerly, so a `customElements.get()` check before `import()` does NOT help.
- Repo layout follows the extension template (Python package at repo root `jstex/`, labextension TS in `src/`), not the spec's `src/jstex/` sketch; widget TS lives in `js/`.
- Local code lives in `~/code/jstex` (`/home/eouser/code/jstex`); the Python venv is `~/code/jstex/.venv` and the stage branch's worktree is `~/code/jstex/.worktrees/stage-1` (git-ignored), so everything stays under `~/code/jstex` while keeping the one-branch-per-worktree rule.
- Creating the private GitHub repo `alek-cesarz/jstex` is authorized (user, 2026-09-30). **Pushing** anything — `main`, branches or tags — needs the user's explicit confirmation first.

## Review Focus

1. **Identical footprints** (the same Sentinel-2 tile on many dates stack exactly) — a map click on stacked footprints must list all of them in a popup, like STEX (user decision 2026-09-30; thumbnails later), and picking one opens its details. Tests: Task 15 `footprint-popup.test.ts` + e2e "lists them in a popup".
2. **Items with `datetime: null`** and `start_datetime`/`end_datetime` (mosaics, CLMS) — list and details must show the range, not "null"/"Invalid Date". Test: Task 8 `formatItemDate`.
3. **Items with `geometry: null`** (allowed by STAC) — they must appear in the list and details with no footprint and no crash; zoom-to-results ignores them. Test: Task 8 `itemFeatures`.
4. **Hub misconfigured or unreachable** (`auth_state: null`, 403, connection error) — search must still work anonymously and the panel must say "Not signed in — restricted collections are hidden." so the user knows why restricted collections are missing. Tests: Task 3 fallbacks + Task 7 `test_collections_reply_and_auth_source`.
5. **Notebook reopened / output re-rendered without the kernel's results** — the widget re-renders from saved model state: query controls restored, empty results, no crash. Test: Task 8 `stateFromModel`.

---

## File Structure (new repo `/home/eouser/code/jstex`)

| Path | Responsibility |
|---|---|
| `pyproject.toml`, `package.json` | Template packaging; adds Python deps, Vite widget build, vitest |
| `jstex/__init__.py` | Public API: `Explorer`, `item`, `__version__`, template extension hooks |
| `jstex/errors.py` | `JstexError` hierarchy |
| `jstex/config.py` | `Config`, `load_config()` |
| `jstex/auth.py` | Token provider chain + cache (`TokenInfo`, `current`, `get_token`, `headers`) |
| `jstex/aoi.py` | Single-AOI GeoJSON upload validation + geometry repair |
| `jstex/query.py` | `QueryState`, `Aoi`, `encode`, `decode`, `build_cql2` (CQL2 operator mapping), `to_search_body` |
| `jstex/stac.py` | `StacBackend`, `Page` — all HTTP to STAC; collection metadata; merged queryables |
| `jstex/widget.py` | `Explorer` anywidget: traitlets, message protocol, worker threads, accessors |
| `jstex/static/` | Vite output `widget.js`, `widget.css` (git-ignored) |
| `js/types.ts` | Shared TS types |
| `js/store.ts` | Per-instance store |
| `js/backend.ts` | `Backend` interface + `CommBackend` |
| `js/model-sync.ts` | `stateFromModel`, `bindModel` (model ⇄ store) |
| `js/format.ts` | Pure formatting/geometry helpers, `escapeHtml` |
| `js/selection.ts` | `neighbour`, `toggleId`, `scrollWithin` |
| `js/filters.ts` | Filter operators, value parsing and validation (ported from STEX), row commit |
| `js/actions.ts` | User intents: query, one AOI, draw mode, upload, filter rows, sections, panel collapse, search |
| `js/clipboard.ts` | `copyText` |
| `js/snippets.ts` | Python snippet builders |
| `js/i18n.ts`, `js/strings.ts` | Translation bundle access (English fallback) + all UI strings as `trans.__()` literals |
| `js/antimeridian.ts` | Copied from STEX |
| `js/ui/panel.ts` | Search panel shell: sections, pinned Search, sign-in line, rail |
| `js/ui/section.ts`, `js/ui/collections.ts`, `js/ui/dates.ts`, `js/ui/aoi-section.ts`, `js/ui/filters-section.ts` | Panel sections |
| `js/ui/map.ts`, `js/ui/results.ts`, `js/ui/details.ts` | Views: `(el, store, actions)` |
| `js/ui/footprint-popup.ts` | STEX-style list of items under a map click |
| `js/icons.ts` | Inline SVG icons (no icon font in a blob-loaded widget) |
| `js/widget.ts` | anywidget `render()` — wires everything, follows light/dark theme |
| `src/index.ts` | labextension plugin: publishes the `jstex` translation bundle for the widget |
| `jstex/locale/` | `jstex.pot` + future `<ll_CC>/LC_MESSAGES/jstex.{po,json,mo}` |
| `js/styles.css` | Scoped styles |
| `tests/` | pytest (`test_config.py`, `test_auth.py`, `test_aoi.py`, `test_query.py`, `test_stac.py`, `test_widget.py`, `test_api.py`, fixtures) |
| `js/__tests__/` | vitest |
| `ui-tests/` | Galata e2e + `fake_stac.py` |
| `deploy/z2jh-values.example.yaml` | Hub prerequisites |
| `README.md`, `DEVELOPMENT.md`, `CHANGELOG.md` | Docs |

---

### Task 1: Scaffold the repo from the JupyterLab extension template

**Files:**
- Create: whole repo via copier; then modify `pyproject.toml`, `package.json`, `tsconfig.json`, `.gitignore`, `.github/workflows/*`
- Delete: `LICENSE`, `jest.config.js`, `babel.config.js`, `tsconfig.test.json`, `src/__tests__/`, `.github/workflows/{publish-release,prep-release,check-release}.yml`

**Interfaces:**
- Produces: a buildable package `jstex` (`pip install -e ".[dev,test]"` works, `jupyter labextension list` shows `@jstex/labextension … OK`), `jlpm test` runs vitest, `pytest` runs.

- [ ] **Step 1: Create the private GitHub repo** (authorized by the user on 2026-09-30):

```bash
gh repo create alek-cesarz/jstex --private --description "STEX-light: STAC explorer widget for JupyterLab"
```

Expected: the repo URL is printed. Nothing is pushed in this task.

- [ ] **Step 2: Generate from the template**

```bash
mkdir -p /home/eouser/code/jstex && cd /home/eouser/code/jstex && git init -q -b main
python3 -m venv .venv
.venv/bin/pip install -q copier jinja2-time "jupyterlab>=4.6,<5"
.venv/bin/copier copy --trust --defaults \
  --data kind=frontend-and-server \
  --data author_name="Aleksander Cesarz" \
  --data author_email="alek.cesarz@gmail.com" \
  --data labextension_name="@jstex/labextension" \
  --data python_name=jstex \
  --data project_short_description="STEX-light: STAC explorer widget for JupyterLab" \
  --data repository="https://github.com/alek-cesarz/jstex" \
  --data test=true --data has_settings=false --data has_binder=false \
  https://github.com/jupyterlab/extension-template .
ls
```

Expected: `jstex/`, `src/`, `ui-tests/`, `pyproject.toml`, `package.json`, `LICENSE`, `jest.config.js` … exist.

- [ ] **Step 3: Make it private and license-free.** Delete `LICENSE`. In `pyproject.toml` remove the lines `license = "BSD-3-Clause"` and `license-files = ["LICENSE"]`, and add to `classifiers` the line `"Private :: Do Not Upload",`. In `package.json` set `"private": true` and delete the `"license"` field.

- [ ] **Step 4: Add Python dependencies.** In `pyproject.toml` replace the `dependencies = [...]` block and extend `test`:

```toml
dependencies = [
    "jupyter_server>=2.13.0,<3",
    "anywidget>=0.11,<0.12",
    "pystac>=1.15,<2",
    "pystac-client>=0.9,<0.10",
    "requests>=2.31",
    "shapely>=2.0",
    "traitlets>=5.9",
]
```

and in `[project.optional-dependencies]` `test = [...]` append `"responses>=0.25",` and `"ruff>=0.6",`; in `dev = [...]` append `"jupyterlab-translate>=1.3.7",` (string extraction, Task 17; its `update` command also needs the system `gettext` package for `xgettext`).

- [ ] **Step 5: Swap jest for vitest.** Delete `jest.config.js`, `babel.config.js`, `tsconfig.test.json`, `src/__tests__/`. Remove `"types": ["jest"]` from `tsconfig.json`. Then:

```bash
jlpm remove jest ts-jest @jupyterlab/testutils @types/jest 2>/dev/null || true
jlpm add -D vite@^7.3.1 vitest@^3.1.0 jsdom@^26 @types/geojson@^7946.0.14 @anywidget/types@^0.4.0
jlpm add @eox/map@^2.8.0 @eox/drawtools@^1.6.0 @jupyterlab/translation@^4.0.0
```

In `package.json` `scripts` set `"test": "vitest run"` and add `"test:watch": "vitest"`.

In `eslint.config.mjs` add `'js'` and `'vite.config.ts'` to the top-level `ignores` array. The template's ESLint uses the root `tsconfig.json` (which only includes `src/`) and JupyterLab's `I`-prefixed interface naming; the widget code in `js/` has its own `js/tsconfig.json` (strict) and is checked by `tsc` + prettier instead. Record this in DEVELOPMENT.md (Task 18).

- [ ] **Step 6: Trim release workflows** (they target PyPI/npm via jupyter-releaser, which we never use):

```bash
git rm -q --cached LICENSE 2>/dev/null; rm -f .github/workflows/publish-release.yml .github/workflows/prep-release.yml .github/workflows/check-release.yml RELEASE.md
```

In `.github/workflows/build.yml` change the `pytest` line to `pytest -vv -r ap --cov jstex tests jstex/tests`.

- [ ] **Step 7: Install and verify**

```bash
cd /home/eouser/code/jstex
source .venv/bin/activate
pip install -e ".[dev,test]"
jupyter labextension develop . --overwrite
jupyter labextension list 2>&1 | grep -i "@jstex/labextension.*OK"
jupyter server extension list 2>&1 | grep -i "jstex.*OK"
pytest -q jstex/tests
```

Expected: both greps print a line; template server tests pass.

- [ ] **Step 8: Ignore the worktree folder and connect the remote.** Append `.worktrees/` to `.gitignore` and `.prettierignore`, add `'.worktrees'` to the `ignores` array in `eslint.config.mjs`, then:

```bash
git remote add origin https://github.com/alek-cesarz/jstex.git
```

- [ ] **Step 8b: Commit** (local only — do not push)

```bash
git add -A
git commit -m "chore: scaffold jstex from jupyterlab/extension-template

Private package (no license, Private :: Do Not Upload), vitest instead
of jest, Python deps for STAC + anywidget, releaser workflows removed."
```

- [ ] **Step 9: Create the stage branch in its own worktree, inside `~/code/jstex`** (user rules: code under `~/code/jstex`; each branch in its own worktree):

```bash
cd /home/eouser/code/jstex
git worktree add .worktrees/stage-1 -b feat/stage-1
cd .worktrees/stage-1
source /home/eouser/code/jstex/.venv/bin/activate
pip install -e ".[dev,test]" && jupyter labextension develop . --overwrite
```

All remaining tasks run inside `/home/eouser/code/jstex/.worktrees/stage-1` with that venv active. (The editable install now points at the worktree.)

---

### Task 2: Widget build pipeline + feasibility spikes (eox-map in a cell, thread messaging)

Spec §11 lists two stage-1 risks; this task proves both before any UI work, with Galata tests that stay as regression guards.

**Files:**
- Create: `vite.config.ts`, `js/tsconfig.json`, `js/define-guard.ts`, `js/widget.ts` (stub), `js/styles.css` (stub), `jstex/widget.py` (stub), `ui-tests/tests/spike.spec.ts`, `js/__tests__/define-guard.test.ts`
- Modify: `package.json` scripts, `pyproject.toml` ensured-targets, `.gitignore`, `jstex/__init__.py`
- Create at end: `DEVELOPMENT.md` (Decisions section)

**Interfaces:**
- Produces: `jlpm build:widget` → `jstex/static/widget.js` + `jstex/static/widget.css`; `jstex.Explorer` class (stub, finished in Task 7); recorded decision `THREAD_SEND_OK` (yes/no) in `DEVELOPMENT.md`.

- [ ] **Step 1: Vite library config** — `vite.config.ts`:

```ts
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
        for (const name of Object.keys(bundle)) if (name.endsWith('.woff2')) delete bundle[name];
      },
    },
  ],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    lib: { entry: 'js/widget.ts', formats: ['es'], fileName: () => 'widget.js' },
    outDir: 'jstex/static',
    emptyOutDir: true,
    cssCodeSplit: false,
    sourcemap: false,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        assetFileNames: (info) => (info.name?.endsWith('.css') ? 'widget.css' : '[name][extname]'),
      },
    },
  },
  test: {
    include: ['js/__tests__/**/*.test.ts', 'src/__tests__/**/*.test.ts'],
    environment: 'jsdom',
  },
});
```

- [ ] **Step 2: Widget tsconfig** — `js/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["DOM", "DOM.Iterable", "ES2022"],
    "strict": true,
    "noUnusedLocals": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["geojson"]
  },
  "include": ["./**/*.ts"]
}
```

- [ ] **Step 3: package.json scripts.** Add `"build:widget": "tsc -p js/tsconfig.json && vite build"`, and prepend it to both builds: `"build": "jlpm build:widget && jlpm build:lib && jlpm build:labextension:dev"`, `"build:prod": "jlpm clean && jlpm build:widget && jlpm build:lib:prod && jlpm build:labextension"`. Add `"clean:widget": "rimraf jstex/static"` and include it in `clean:all`.

- [ ] **Step 4: pyproject ensured targets.** In `[tool.hatch.build.hooks.jupyter-builder]` add `"jstex/static/widget.js",` to `ensured-targets`. In `[tool.hatch.build.targets.sdist]` set `artifacts = ["jstex/labextension", "jstex/static"]`. Add a `[tool.hatch.build.targets.wheel]` section with `artifacts = ["jstex/static"]`. Append `jstex/static/` to `.gitignore`.

- [ ] **Step 4b: Custom-element define guard (test first).** `js/__tests__/define-guard.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import '../define-guard';

describe('define-guard', () => {
  it('makes re-defining a registered tag a no-op instead of throwing', () => {
    class A extends HTMLElement {}
    class B extends HTMLElement {}
    customElements.define('jstex-guard-test', A);
    expect(() => customElements.define('jstex-guard-test', B)).not.toThrow();
    expect(customElements.get('jstex-guard-test')).toBe(A);
  });
});
```

Run `jlpm vitest run js/__tests__/define-guard.test.ts` → FAIL (`Failed to resolve import "../define-guard"`). Then create `js/define-guard.ts`:

```ts
/**
 * Must be the FIRST import of widget.ts.
 *
 * anywidget evaluates the bundle again for every new widget model (each
 * `Explorer()` gets a fresh blob URL), and the bundled @eox/* modules call
 * customElements.define() at load time. A second definition of the same tag
 * throws and kills the new widget. Make re-definition of an already
 * registered tag a no-op; first definitions are untouched.
 */
type Registry = CustomElementRegistry & { __jstexDefineGuard?: true };

const registry = window.customElements as Registry;
if (!registry.__jstexDefineGuard) {
  const define = registry.define.bind(registry);
  registry.define = (name, constructor, options) => {
    if (!registry.get(name)) define(name, constructor, options);
  };
  registry.__jstexDefineGuard = true;
}

export {};
```

Run it again → PASS.

- [ ] **Step 5: Stub widget front end** — `js/widget.ts`:

```ts
import './define-guard'; // must stay first: see define-guard.ts
import '@eox/map';
import '@eox/drawtools';
import type { RenderProps } from '@anywidget/types';
import './styles.css';

function render({ el }: RenderProps): () => void {
  const root = document.createElement('div');
  root.className = 'jstex';
  root.innerHTML = '<eox-map class="jstex-map" style="height:300px"></eox-map>';
  el.appendChild(root);
  const map = root.querySelector('eox-map') as HTMLElement & { layers: unknown; zoom: number };
  map.layers = [
    {
      type: 'Tile',
      properties: { id: 'basemap' },
      source: { type: 'XYZ', url: 'https://tiles.maps.eox.at/wmts/1.0.0/terrain-light_3857/default/g/{z}/{y}/{x}.jpg' },
    },
  ];
  map.zoom = 3;
  return () => root.remove();
}

export default { render };
```

`js/styles.css`:

```css
.jstex { font-family: var(--jp-ui-font-family, system-ui, sans-serif); }
.jstex .jstex-map { display: block; width: 100%; }
```

- [ ] **Step 6: Stub Python widget** — `jstex/widget.py`:

```python
"""anywidget front door for jstex (completed in a later task)."""

from __future__ import annotations

import pathlib

import anywidget

STATIC = pathlib.Path(__file__).parent / "static"


class Explorer(anywidget.AnyWidget):
    _esm = STATIC / "widget.js"
    _css = STATIC / "widget.css"
```

In `jstex/__init__.py`, after the `__version__` block add `from .widget import Explorer` and `__all__ = ["Explorer", "__version__"]`.

- [ ] **Step 7: Build**

Run: `jlpm build:widget && ls -la jstex/static`
Expected: `widget.js` and `widget.css` only (no chunk files, no `.woff2` — the `jstex-drop-eox-fonts` plugin removes @eox/ui's icon fonts, whose `@font-face` falls back to a jsdelivr CDN copy). While writing the plan the bundle was ~4.3 MB (1.1 MB gzip; it includes OpenLayers and @eox/map's globe dependency). Record the size in DEVELOPMENT.md.

- [ ] **Step 8: Galata spike tests** — `ui-tests/tests/spike.spec.ts`:

```ts
import { expect, test } from '@jupyterlab/galata';

test.describe('feasibility spikes', () => {
  test('eox-map renders inside a notebook cell output', async ({ page }) => {
    await page.notebook.createNew();
    await page.notebook.setCell(0, 'code', 'import jstex\njstex.Explorer()');
    await page.notebook.run();
    const map = page.locator('.jp-OutputArea-output .jstex eox-map');
    await expect(map).toBeVisible({ timeout: 30000 });
    await expect(map.locator('canvas').first()).toBeAttached({ timeout: 30000 });
    // Re-running the cell re-evaluates the bundle: the define guard must keep it working.
    await page.notebook.runCell(0);
    await expect(page.locator('.jp-OutputArea-output .jstex eox-map canvas').first()).toBeAttached({ timeout: 30000 });
  });

  test('messages and trait updates sent from a worker thread arrive', async ({ page }) => {
    await page.notebook.createNew();
    const code = [
      'import anywidget, threading, time, traitlets',
      'class T(anywidget.AnyWidget):',
      '    _esm = """export default { render({ model, el }) {',
      "      model.on('msg:custom', (m) => { el.dataset.n = String(m.n); });",
      "      model.on('change:v', () => { el.dataset.v = String(model.get('v')); });",
      '    } }"""',
      '    v = traitlets.Int(0).tag(sync=True)',
      't = T()',
      'def work():',
      '    for n in range(1, 51):',
      '        time.sleep(0.02); t.send({"n": n}); t.v = n',
      'threading.Thread(target=work, daemon=True).start()',
      't',
    ].join('\n');
    await page.notebook.setCell(0, 'code', code);
    await page.notebook.run();
    const out = page.locator('.jp-OutputArea-output [data-n]');
    await expect(out).toHaveAttribute('data-n', '50', { timeout: 20000 });
    await expect(out).toHaveAttribute('data-v', '50', { timeout: 20000 });
  });
});
```

- [ ] **Step 9: Run the spikes**

```bash
cd ui-tests && jlpm install && jlpm playwright install chromium && jlpm playwright test tests/spike.spec.ts; cd ..
```

Expected: both PASS. If test 1 fails, inspect the console (`page.on('console')`) — common causes are a code-split chunk (check Step 7) or a missing CSS import from `@eox/map`; fix in `vite.config.ts`/`widget.ts` and rerun. **Do not continue past this task with test 1 failing.** If test 2 fails, set decision `THREAD_SEND_OK = no` (Task 7 then uses its synchronous fallback, noted there).

- [ ] **Step 10: Record decisions** — create `DEVELOPMENT.md`:

```markdown
# Developing jstex

## Decisions (stage 1 spikes)

- **eox-map in a cell output:** works with a single-file Vite ESM bundle
  (`inlineDynamicImports`). Bundle size: <fill from Step 7> KB.
- **THREAD_SEND_OK:** <yes|no> — anywidget `send()` and trait updates from a
  worker thread <do|do not> reach the front end reliably (ipykernel <version>).
  Guarded by `ui-tests/tests/spike.spec.ts`.
```

(Replace the `<…>` with the observed values — this is a recorded measurement, not a placeholder to leave in.)

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat: Vite anywidget bundle + feasibility spikes (eox-map in cell, thread send)"
```

---
### Task 3: Errors, config and the token provider chain

**Files:**
- Create: `jstex/errors.py`, `jstex/config.py`, `jstex/auth.py`
- Test: `tests/test_config.py`, `tests/test_auth.py`, `tests/conftest.py`

**Interfaces:**
- Produces:
  - `jstex.errors`: `JstexError(Exception)`, `JstexAuthError(JstexError)`, `JstexStacError(JstexError)` with `.status: int | None`, `JstexQueryError(JstexError)`.
  - `jstex.config`: `DEFAULT_STAC_URL: str`, `Config(stac_url: str, stex_url: str | None, basemap_url: str, basemap_dark_url: str, basemap_attribution: str)` (frozen dataclass), `DEFAULT_BASEMAP_URL`, `DEFAULT_BASEMAP_ATTRIBUTION`, `load_config(*, stac_url: str | None = None, stex_url: str | None = None) -> Config` — `stac_url` always ends with `/`.
  - `jstex.auth`: `TokenInfo(token: str | None, source: Literal["hub","env","anonymous"], expires_at: float)`, `current(force_refresh: bool = False) -> TokenInfo`, `get_token(force_refresh: bool = False) -> str | None`, `headers() -> dict[str, str]`, `reset_cache() -> None` (tests + widget use).

- [ ] **Step 1: Write failing tests** — `tests/conftest.py`:

```python
import pytest

from jstex import auth


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    for var in (
        "JUPYTERHUB_API_URL",
        "JUPYTERHUB_API_TOKEN",
        "JUPYTERHUB_USER",
        "JSTEX_ACCESS_TOKEN",
        "JSTEX_STAC_URL",
        "JSTEX_STEX_URL",
        *(f"JSTEX_BASEMAP_{t}_{k}" for t in ("LIGHT", "DARK") for k in ("URL", "KEY", "KEY_PARAM", "ATTRIBUTION")),
    ):
        monkeypatch.delenv(var, raising=False)
    auth.reset_cache()
    yield
    auth.reset_cache()


def make_jwt(exp: float) -> str:
    import base64
    import json

    def seg(obj):
        return base64.urlsafe_b64encode(json.dumps(obj).encode()).rstrip(b"=").decode()

    return f"{seg({'alg': 'none'})}.{seg({'exp': exp, 'sub': 'u1'})}.sig"


@pytest.fixture
def hub_env(monkeypatch):
    monkeypatch.setenv("JUPYTERHUB_API_URL", "http://hub:8081/hub/api")
    monkeypatch.setenv("JUPYTERHUB_API_TOKEN", "server-token")
    monkeypatch.setenv("JUPYTERHUB_USER", "alice@example.org")
    return "http://hub:8081/hub/api/users/alice%40example.org"
```

`tests/test_config.py`:

```python
from jstex.config import (
    DEFAULT_BASEMAP_DARK_URL,
    DEFAULT_BASEMAP_LIGHT_URL,
    DEFAULT_STAC_URL,
    Basemap,
    load_config,
)


def test_defaults():
    cfg = load_config()
    assert cfg.stac_url == DEFAULT_STAC_URL == "https://stac.opensearch.dataspace.copernicus.eu/v1/"
    assert cfg.stex_url is None
    assert cfg.basemap_light.url == DEFAULT_BASEMAP_LIGHT_URL
    assert cfg.basemap_dark.url == DEFAULT_BASEMAP_DARK_URL


def test_env_overrides_default_and_gets_trailing_slash(monkeypatch):
    monkeypatch.setenv("JSTEX_STAC_URL", "https://stac.example.org/api")
    monkeypatch.setenv("JSTEX_STEX_URL", "https://stex.example.org/")
    cfg = load_config()
    assert cfg.stac_url == "https://stac.example.org/api/"
    assert cfg.stex_url == "https://stex.example.org/"


def test_kwargs_override_env(monkeypatch):
    monkeypatch.setenv("JSTEX_STAC_URL", "https://env.example.org/")
    assert load_config(stac_url="https://kw.example.org/").stac_url == "https://kw.example.org/"


def test_basemap_tile_url_matches_stex_rules():
    assert (
        load_config().basemap_light.tile_url()
        == "https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png"
    )
    b = Basemap("https://t.example.org/{z}/{x}/{y}{r}.png?style=a", key="K", key_param="api_key")
    assert b.tile_url(retina=False) == "https://t.example.org/{z}/{x}/{y}.png?style=a&api_key=K"
    assert "K" not in repr(b)


def test_basemap_env(monkeypatch):
    monkeypatch.setenv("JSTEX_BASEMAP_DARK_KEY", "secret")
    monkeypatch.setenv("JSTEX_BASEMAP_LIGHT_URL", "https://tiles.example.org/{z}/{x}/{y}.png")
    cfg = load_config()
    assert cfg.basemap_dark.tile_url().endswith("@2x.png?api_key=secret")
    assert cfg.basemap_light.tile_url() == "https://tiles.example.org/{z}/{x}/{y}.png"
```

`tests/test_auth.py`:

```python
import time

import pytest
import responses

from jstex import auth
from tests.conftest import make_jwt


@responses.activate
def test_hub_token_is_read_from_users_endpoint(hub_env):
    token = make_jwt(time.time() + 600)
    responses.get(
        hub_env,
        json={"name": "alice@example.org", "auth_state": {"access_token": token, "refresh_token": "R"}},
        match=[responses.matchers.header_matcher({"Authorization": "token server-token"})],
    )
    info = auth.current()
    assert info.token == token and info.source == "hub"
    assert "R" not in repr(info)


@responses.activate
def test_hub_token_is_cached_until_near_expiry(hub_env):
    responses.get(hub_env, json={"auth_state": {"access_token": make_jwt(time.time() + 600)}})
    auth.current()
    auth.current()
    assert len(responses.calls) == 1


@responses.activate
def test_token_close_to_expiry_is_refetched(hub_env):
    responses.get(hub_env, json={"auth_state": {"access_token": make_jwt(time.time() + 30)}})
    auth.current()
    auth._cache_until_override(0)  # simulate the 15 s floor having elapsed
    auth.current()
    assert len(responses.calls) == 2


@responses.activate
def test_force_refresh_bypasses_cache(hub_env):
    responses.get(hub_env, json={"auth_state": {"access_token": make_jwt(time.time() + 600)}})
    auth.current()
    auth.current(force_refresh=True)
    assert len(responses.calls) == 2


@responses.activate
def test_null_auth_state_warns_once_and_falls_back_to_anonymous(hub_env):
    responses.get(hub_env, json={"auth_state": None})
    with pytest.warns(UserWarning, match="auth_state"):
        info = auth.current()
    assert info.token is None and info.source == "anonymous"


@responses.activate
def test_hub_403_falls_back_with_scope_hint(hub_env):
    responses.get(hub_env, status=403, json={"message": "forbidden"})
    with pytest.warns(UserWarning, match="admin:auth_state!user"):
        assert auth.current().source == "anonymous"


def test_hub_unreachable_falls_back(hub_env):
    # no responses mock active -> real connection error to http://hub:8081
    with pytest.warns(UserWarning, match="unreachable"):
        assert auth.current().source == "anonymous"


def test_env_token_used_outside_hub(monkeypatch):
    monkeypatch.setenv("JSTEX_ACCESS_TOKEN", "dev-token")
    info = auth.current()
    assert (info.token, info.source) == ("dev-token", "env")
    assert auth.headers() == {"Authorization": "Bearer dev-token"}


def test_anonymous_has_no_headers():
    assert auth.get_token() is None
    assert auth.headers() == {}
```

- [ ] **Step 2: Run to confirm failure**

Run: `pytest tests/test_config.py tests/test_auth.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'jstex.config'`.

- [ ] **Step 3: Implement** — `jstex/errors.py`:

```python
"""Exception types raised by jstex."""

from __future__ import annotations


class JstexError(Exception):
    """Base class for all jstex errors."""


class JstexAuthError(JstexError):
    """The user's access token could not be obtained."""


class JstexStacError(JstexError):
    """A STAC API request failed."""

    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status


class JstexQueryError(JstexError):
    """A query could not be decoded or turned into a search request."""
```

`jstex/config.py`:

```python
"""Deployment configuration: explicit kwargs -> JSTEX_* env vars -> defaults."""

from __future__ import annotations

import os
from dataclasses import dataclass, field

DEFAULT_STAC_URL = "https://stac.opensearch.dataspace.copernicus.eu/v1/"

# Basemaps: same providers and defaults as STEX (src/lib/config.ts). Both need
# an API key or a registered domain; set them per deployment.
DEFAULT_BASEMAP_LIGHT_URL = "https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
DEFAULT_BASEMAP_LIGHT_KEY_PARAM = "key"
DEFAULT_BASEMAP_LIGHT_ATTRIBUTION = (
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors '
    '&copy; <a href="https://carto.com/attributions">CARTO</a>'
)
DEFAULT_BASEMAP_DARK_URL = "https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png"
DEFAULT_BASEMAP_DARK_KEY_PARAM = "api_key"
DEFAULT_BASEMAP_DARK_ATTRIBUTION = (
    '&copy; <a href="https://stadiamaps.com/">Stadia Maps</a> '
    '&copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> '
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
)


@dataclass(frozen=True)
class Basemap:
    """An XYZ tile template. ``{r}`` becomes ``@2x`` (retina), as in STEX."""

    url: str
    key: str = field(default="", repr=False)
    key_param: str = "key"
    attribution: str = ""

    def tile_url(self, retina: bool = True) -> str:
        url = self.url.replace("{r}", "@2x" if retina else "")
        if not self.key:
            return url
        sep = "&" if "?" in url else "?"
        return f"{url}{sep}{self.key_param}={self.key}"


@dataclass(frozen=True)
class Config:
    stac_url: str
    stex_url: str | None
    basemap_light: Basemap
    basemap_dark: Basemap


def _with_slash(url: str) -> str:
    return url if url.endswith("/") else url + "/"


def _basemap(theme: str, url: str, key_param: str, attribution: str) -> Basemap:
    env = os.environ.get
    prefix = f"JSTEX_BASEMAP_{theme}_"
    return Basemap(
        url=env(prefix + "URL") or url,
        key=env(prefix + "KEY") or "",
        key_param=env(prefix + "KEY_PARAM") or key_param,
        attribution=env(prefix + "ATTRIBUTION") or attribution,
    )


def load_config(*, stac_url: str | None = None, stex_url: str | None = None) -> Config:
    env = os.environ.get
    return Config(
        stac_url=_with_slash(stac_url or env("JSTEX_STAC_URL") or DEFAULT_STAC_URL),
        stex_url=stex_url or env("JSTEX_STEX_URL") or None,
        basemap_light=_basemap(
            "LIGHT", DEFAULT_BASEMAP_LIGHT_URL, DEFAULT_BASEMAP_LIGHT_KEY_PARAM, DEFAULT_BASEMAP_LIGHT_ATTRIBUTION
        ),
        basemap_dark=_basemap(
            "DARK", DEFAULT_BASEMAP_DARK_URL, DEFAULT_BASEMAP_DARK_KEY_PARAM, DEFAULT_BASEMAP_DARK_ATTRIBUTION
        ),
    )
```

`jstex/auth.py`:

```python
"""Access-token provider chain: JupyterHub auth_state -> JSTEX_ACCESS_TOKEN -> anonymous.

The hub's OAuthenticator keeps the user's OIDC tokens in the encrypted
``auth_state``. The single-user server may read it live when the hub grants
the ``admin:auth_state!user`` scope (see deploy/z2jh-values.example.yaml).
Only the access token leaves this module; the refresh token is never kept.
"""

from __future__ import annotations

import base64
import json
import os
import threading
import time
import warnings
from dataclasses import dataclass, field
from typing import Literal
from urllib.parse import quote

import requests

REFRESH_MARGIN_S = 60  # re-fetch when the token has less than this left
MIN_CACHE_S = 15  # never ask the hub more often than this
ANON_CACHE_S = 60  # how long an anonymous result is reused
HUB_TIMEOUT_S = 10

Source = Literal["hub", "env", "anonymous"]


@dataclass(frozen=True)
class TokenInfo:
    token: str | None = field(repr=False)
    source: Source
    expires_at: float


_lock = threading.Lock()
_cached: TokenInfo | None = None
_cache_until: float = 0.0
_warned: set[str] = set()


def _warn_once(key: str, message: str) -> None:
    if key not in _warned:
        _warned.add(key)
        warnings.warn(message, UserWarning, stacklevel=3)


def _jwt_exp(token: str) -> float | None:
    try:
        payload = token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        return float(json.loads(base64.urlsafe_b64decode(payload))["exp"])
    except (IndexError, ValueError, KeyError, TypeError):
        return None


def _from_hub() -> str | None:
    api = os.environ.get("JUPYTERHUB_API_URL")
    server_token = os.environ.get("JUPYTERHUB_API_TOKEN")
    user = os.environ.get("JUPYTERHUB_USER")
    if not (api and server_token and user):
        return None
    # /users/{name}, NOT /user: the latter returns auth_state: null (jupyterhub#5103).
    url = f"{api.rstrip('/')}/users/{quote(user, safe='')}"
    try:
        resp = requests.get(url, headers={"Authorization": f"token {server_token}"}, timeout=HUB_TIMEOUT_S)
    except requests.RequestException as err:
        _warn_once("unreachable", f"jstex: JupyterHub API unreachable ({err}); searching anonymously.")
        return None
    if resp.status_code == 403:
        _warn_once(
            "403",
            "jstex: the server token may not read auth_state; grant 'admin:auth_state!user' "
            "to the 'server' role (see deploy/z2jh-values.example.yaml). Searching anonymously.",
        )
        return None
    if not resp.ok:
        _warn_once(f"http{resp.status_code}", f"jstex: JupyterHub API returned {resp.status_code}; searching anonymously.")
        return None
    state = resp.json().get("auth_state") or {}
    token = state.get("access_token")
    if not token:
        _warn_once(
            "null",
            "jstex: JupyterHub returned no auth_state access token; enable "
            "Authenticator.enable_auth_state and the admin:auth_state!user scope. Searching anonymously.",
        )
        return None
    return token


def _resolve(now: float) -> tuple[TokenInfo, float]:
    token = _from_hub()
    if token:
        exp = _jwt_exp(token) or now + 300
        return TokenInfo(token, "hub", exp), max(exp - REFRESH_MARGIN_S, now + MIN_CACHE_S)
    env_token = os.environ.get("JSTEX_ACCESS_TOKEN")
    if env_token:
        exp = _jwt_exp(env_token) or now + 3600
        return TokenInfo(env_token, "env", exp), max(exp - REFRESH_MARGIN_S, now + MIN_CACHE_S)
    return TokenInfo(None, "anonymous", now + ANON_CACHE_S), now + ANON_CACHE_S


def current(force_refresh: bool = False) -> TokenInfo:
    """Return the best available token, cached until shortly before it expires."""
    global _cached, _cache_until
    with _lock:
        now = time.time()
        if not force_refresh and _cached is not None and now < _cache_until:
            return _cached
        _cached, _cache_until = _resolve(now)
        return _cached


def get_token(force_refresh: bool = False) -> str | None:
    return current(force_refresh).token


def headers() -> dict[str, str]:
    token = get_token()
    return {"Authorization": f"Bearer {token}"} if token else {}


def reset_cache() -> None:
    global _cached, _cache_until
    with _lock:
        _cached, _cache_until = None, 0.0
        _warned.clear()


def _cache_until_override(value: float) -> None:
    """Test hook: pretend the cache window ended at ``value``."""
    global _cache_until
    with _lock:
        _cache_until = value
```

- [ ] **Step 4: Run tests**

Run: `pytest tests/test_config.py tests/test_auth.py -q`
Expected: all PASS. (`test_hub_unreachable_falls_back` needs `hub` to not resolve; it does not in CI or locally.)

- [ ] **Step 5: Lint and commit**

```bash
ruff check jstex tests && ruff format jstex tests
git add jstex/errors.py jstex/config.py jstex/auth.py tests/
git commit -m "feat: config + JupyterHub auth_state token provider chain"
```

---

### Task 4: Area of interest — GeoJSON upload validation and geometry repair (`jstex/aoi.py`)

One AOI only (user decision 2026-09-30), so there is no multi-AOI logic. Upload validation lives in Python: the widget reads the file and sends its text. Python applies the spec's rules (§4 Workflow B2) with shapely and returns one Polygon or MultiPolygon, or an error. The same module repairs self-crossing drawn polygons, because CDSE answers `GEOSIntersects: TopologyException` for invalid geometries.

**Files:**
- Create: `jstex/aoi.py`
- Test: `tests/test_aoi.py`

**Interfaces:**
- Consumes: `jstex.errors.JstexError`.
- Produces:
  - `JstexAoiError(JstexError)`.
  - `parse_aoi_upload(text: str) -> dict` returns a `Polygon` or `MultiPolygon` GeoJSON geometry.
  - `repair(geometry: dict) -> dict` returns valid polygonal geometry, unchanged if already valid.
  - `MAX_UPLOAD_BYTES = 5_000_000`.
  - Error messages, verbatim (the UI shows them): `"No polygon geometry found"`, `"Only EPSG:4326 (WGS84 lon/lat) supported."`, `"Invalid coordinates in the polygon geometry."`, `"The file is not valid GeoJSON."`, `"The file is larger than 5 MB."`.

- [ ] **Step 1: Write the failing tests** — `tests/test_aoi.py`:

```python
import json

import pytest

from jstex.aoi import JstexAoiError, parse_aoi_upload, repair

SQUARE = [[[10, 45], [11, 45], [11, 46], [10, 46], [10, 45]]]
OTHER = [[[20, 50], [21, 50], [21, 51], [20, 51], [20, 50]]]


def fc(*geoms, crs=None):
    doc = {"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {}, "geometry": g} for g in geoms]}
    if crs:
        doc["crs"] = {"type": "name", "properties": {"name": crs}}
    return json.dumps(doc)


def test_feature_collection_with_one_polygon():
    assert parse_aoi_upload(fc({"type": "Polygon", "coordinates": SQUARE})) == {"type": "Polygon", "coordinates": SQUARE}


def test_two_polygons_become_one_multipolygon_without_union():
    geom = parse_aoi_upload(fc({"type": "Polygon", "coordinates": SQUARE}, {"type": "Polygon", "coordinates": OTHER}))
    assert geom == {"type": "MultiPolygon", "coordinates": [SQUARE, OTHER]}


def test_feature_and_bare_geometry_accepted_and_points_ignored():
    feat = json.dumps({"type": "Feature", "geometry": {"type": "Polygon", "coordinates": SQUARE}})
    assert parse_aoi_upload(feat)["type"] == "Polygon"
    mixed = fc({"type": "Point", "coordinates": [1, 2]}, {"type": "Polygon", "coordinates": SQUARE})
    assert parse_aoi_upload(mixed)["type"] == "Polygon"


def test_only_points_and_lines_rejected():
    with pytest.raises(JstexAoiError, match="No polygon geometry found"):
        parse_aoi_upload(fc({"type": "Point", "coordinates": [1, 2]}, {"type": "LineString", "coordinates": [[0, 0], [1, 1]]}))


@pytest.mark.parametrize("crs", ["urn:ogc:def:crs:EPSG::3857", "EPSG:32633"])
def test_non_wgs84_crs_rejected(crs):
    with pytest.raises(JstexAoiError, match=r"Only EPSG:4326 \(WGS84 lon/lat\) supported\."):
        parse_aoi_upload(fc({"type": "Polygon", "coordinates": SQUARE}, crs=crs))


@pytest.mark.parametrize("crs", ["urn:ogc:def:crs:OGC:1.3:CRS84", "EPSG:4326"])
def test_wgs84_crs_accepted(crs):
    assert parse_aoi_upload(fc({"type": "Polygon", "coordinates": SQUARE}, crs=crs))["type"] == "Polygon"


@pytest.mark.parametrize(
    "coords",
    [[[[10, 45], [11, 45], [10, 45]]], [[["a", 45], [11, 45], [11, 46], ["a", 45]]], [[[500, 45], [11, 45], [11, 46], [500, 45]]]],
)
def test_bad_coordinates_rejected(coords):
    with pytest.raises(JstexAoiError, match="Invalid coordinates"):
        parse_aoi_upload(fc({"type": "Polygon", "coordinates": coords}))


def test_not_json_rejected():
    with pytest.raises(JstexAoiError, match="not valid GeoJSON"):
        parse_aoi_upload("{nope")


def test_repair_keeps_valid_geometry_and_fixes_bowtie():
    square = {"type": "Polygon", "coordinates": SQUARE}
    assert repair(square) is square
    bowtie = {"type": "Polygon", "coordinates": [[[0, 0], [2, 2], [2, 0], [0, 2], [0, 0]]]}
    fixed = repair(bowtie)
    assert fixed["type"] == "MultiPolygon" and len(fixed["coordinates"]) == 2
```

- [ ] **Step 2: Run to confirm failure**

Run: `pytest tests/test_aoi.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'jstex.aoi'`.

- [ ] **Step 3: Implement** — `jstex/aoi.py`:

```python
"""Single area of interest: GeoJSON upload validation and geometry repair.

Upload rules (spec §4 Workflow B2): accept a Feature, a FeatureCollection or
a bare Polygon/MultiPolygon; only polygonal geometries count; several polygons
are collected into ONE MultiPolygon without a geometric union; a declared CRS
other than EPSG:4326/CRS84 is rejected; absent CRS means EPSG:4326. Errors
never change the current AOI (the caller only replaces it on success).
"""

from __future__ import annotations

import json
from typing import Any

from shapely import make_valid
from shapely.geometry import GeometryCollection, MultiPolygon, Polygon, mapping, shape

from .errors import JstexError

MAX_UPLOAD_BYTES = 5_000_000


class JstexAoiError(JstexError):
    """An uploaded or drawn area of interest cannot be used."""


def _crs_ok(doc: dict) -> bool:
    crs = doc.get("crs")
    if not crs:
        return True
    name = str((crs.get("properties") or {}).get("name", "")) if isinstance(crs, dict) else ""
    return "4326" in name or "CRS84" in name.upper()


def _polygons(doc: Any) -> list[list]:
    """Polygon coordinate arrays found in a GeoJSON document."""
    if not isinstance(doc, dict):
        return []
    kind = doc.get("type")
    if kind == "FeatureCollection":
        return [p for f in doc.get("features") or [] for p in _polygons(f)]
    if kind == "Feature":
        return _polygons(doc.get("geometry"))
    if kind == "Polygon":
        return [doc.get("coordinates")]
    if kind == "MultiPolygon":
        return list(doc.get("coordinates") or [])
    if kind == "GeometryCollection":
        return [p for g in doc.get("geometries") or [] for p in _polygons(g)]
    return []


def _valid_polygon(coords: Any) -> bool:
    if not isinstance(coords, list) or not coords:
        return False
    for ring in coords:
        if not isinstance(ring, list) or len(ring) < 4:
            return False
        for pos in ring:
            if not (isinstance(pos, list) and len(pos) >= 2 and all(isinstance(v, (int, float)) for v in pos[:2])):
                return False
            lon, lat = pos[0], pos[1]
            if not (-180 <= lon <= 180 and -90 <= lat <= 90):
                return False
    return True


def parse_aoi_upload(text: str) -> dict:
    """Validate an uploaded GeoJSON file and return one Polygon or MultiPolygon."""
    if len(text.encode("utf-8")) > MAX_UPLOAD_BYTES:
        raise JstexAoiError("The file is larger than 5 MB.")
    try:
        doc = json.loads(text)
    except ValueError as err:
        raise JstexAoiError("The file is not valid GeoJSON.") from err
    if not isinstance(doc, dict):
        raise JstexAoiError("The file is not valid GeoJSON.")
    if not _crs_ok(doc):
        raise JstexAoiError("Only EPSG:4326 (WGS84 lon/lat) supported.")
    polygons = _polygons(doc)
    if not polygons:
        raise JstexAoiError("No polygon geometry found")
    if not all(_valid_polygon(p) for p in polygons):
        raise JstexAoiError("Invalid coordinates in the polygon geometry.")
    if len(polygons) == 1:
        return {"type": "Polygon", "coordinates": polygons[0]}
    return {"type": "MultiPolygon", "coordinates": polygons}


def repair(geometry: dict) -> dict:
    """Make a polygonal geometry valid (e.g. a self-crossing drawn polygon).

    CDSE rejects invalid geometries (``GEOSIntersects: TopologyException``).
    Keeps only polygonal parts; raises if nothing polygonal is left.
    """
    geom = shape(geometry)
    if geom.is_valid:
        return geometry
    fixed = make_valid(geom)
    if isinstance(fixed, GeometryCollection):
        parts = [g for g in fixed.geoms if isinstance(g, (Polygon, MultiPolygon))]
        fixed = parts[0] if len(parts) == 1 else MultiPolygon(
            [p for g in parts for p in (g.geoms if isinstance(g, MultiPolygon) else [g])]
        )
    if not isinstance(fixed, (Polygon, MultiPolygon)) or fixed.is_empty:
        raise JstexAoiError("The area of interest has no usable polygon.")
    return json.loads(json.dumps(mapping(fixed)))
```

- [ ] **Step 4: Run tests**

Run: `pytest tests -q`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
ruff check jstex tests && ruff format jstex tests
git add jstex/aoi.py tests/test_aoi.py
git commit -m "feat: single-AOI GeoJSON upload validation and geometry repair"
```

---

### Task 5: QueryState, STEX-compatible codec, search body

**Files:**
- Create: `jstex/query.py`
- Test: `tests/test_query.py`, `tests/fixtures/stex_codec_golden.json` (generated from STEX)

**Interfaces:**
- Consumes: `jstex.errors.JstexQueryError`, `jstex.aoi.repair` (Task 4).
- Produces:
  - `Aoi(geometry: dict, selected: bool = True)`
  - `QueryState(collections: list[str] = [], datetime: dict[str, str] | None = None, aois: list[Aoi] = [], filters: list[dict] = [], sort: dict = DEFAULT_SORT, page_size: int = 50)` with `.to_dict() -> dict` and `QueryState.from_dict(d: dict) -> QueryState`. The dict form (used by the widget traitlet and JS) is `{"collections", "datetime", "aois": [{"geometry", "selected"}], "filters", "sort", "pageSize"}`.
  - `encode(state: QueryState) -> str`, `decode(q: str) -> QueryState` (accepts a bare `q`, `?q=…`, or a full URL).
  - `build_cql2(filters: list[dict]) -> dict | None` — UI operators → CQL2-JSON (`!=` → `<>`, `IN` → `in`; `IN` needs a list)
  - `to_search_body(state: QueryState) -> dict`
  - `share_url(state: QueryState, base: str | None) -> str`

- [ ] **Step 1: Generate golden fixtures from the real STEX codec.** In the STEX checkout (`/home/eouser/code/stex`), create a *temporary, uncommitted* file `tests/unit/zz-jstex-golden.test.ts`:

```ts
import { it, beforeAll } from 'vitest';
import { writeFileSync } from 'node:fs';
import { encodeQueryState } from '../../src/lib/query-codec.js';
import type { QueryState } from '../../src/lib/types.js';
import { initI18nForTests } from './_helpers/init-i18n.js';

beforeAll(initI18nForTests);

const poly = {
  type: 'Polygon',
  coordinates: [[[10.1234567891, 45.5], [11, 45.5], [11, 46.9876543219], [10.1234567891, 45.5]]],
} as GeoJSON.Polygon;

const base: QueryState = {
  collections: [],
  datetime: undefined,
  aois: [],
  filters: [],
  sort: { field: 'properties.datetime', direction: 'desc' },
  pageSize: 50,
};

const cases: Record<string, QueryState> = {
  empty: base,
  collections_only: { ...base, collections: ['sentinel-2-l2a', 'sentinel-1-grd'] },
  full: {
    collections: ['sentinel-2-l2a'],
    datetime: { from: '2024-07-01T00:00:00Z', to: '2024-08-31T23:59:59Z' },
    aois: [
      { id: 'aoi-1', geometry: poly, selected: true, label: 'x', colorIndex: 0 },
      { id: 'aoi-2', geometry: poly, selected: false, label: 'y', colorIndex: 1 },
    ],
    filters: [{ field: 'eo:cloud_cover', op: '<=', value: 10 }],
    sort: { field: 'properties.datetime', direction: 'asc' },
    pageSize: 20,
  },
  unicode: { ...base, collections: ['zażółć-gęślą'] },
};

it('writes golden fixtures', () => {
  const out = Object.fromEntries(Object.entries(cases).map(([k, v]) => [k, encodeQueryState(v)]));
  writeFileSync('/tmp/stex_codec_golden.json', JSON.stringify(out, null, 2));
});
```

Run `cd /home/eouser/code/stex && npx vitest run tests/unit/zz-jstex-golden.test.ts && rm tests/unit/zz-jstex-golden.test.ts && git status --short` (status must show no change in STEX). Then `cp /tmp/stex_codec_golden.json /home/eouser/code/jstex/.worktrees/stage-1/tests/fixtures/stex_codec_golden.json`.

- [ ] **Step 2: Write failing tests** — `tests/test_query.py`:

```python
import json
import pathlib

import pytest

from jstex.errors import JstexQueryError
from jstex.query import Aoi, QueryState, build_cql2, decode, encode, share_url, to_search_body

GOLDEN = json.loads((pathlib.Path(__file__).parent / "fixtures" / "stex_codec_golden.json").read_text())
POLY = {
    "type": "Polygon",
    "coordinates": [[[10.123457, 45.5], [11, 45.5], [11, 46.987654], [10.123457, 45.5]]],
}


def test_decode_stex_full():
    s = decode(GOLDEN["full"])
    assert s.collections == ["sentinel-2-l2a"]
    assert s.datetime == {"from": "2024-07-01T00:00:00Z", "to": "2024-08-31T23:59:59Z"}
    assert [a.selected for a in s.aois] == [True, False]
    assert s.aois[0].geometry == POLY  # rounded to 6 dp by STEX
    assert s.filters == [{"field": "eo:cloud_cover", "op": "<=", "value": 10}]
    assert s.sort == {"field": "properties.datetime", "direction": "asc"}
    assert s.page_size == 20


@pytest.mark.parametrize("name", ["empty", "collections_only", "full", "unicode"])
def test_roundtrip_matches_stex_semantics(name):
    s = decode(GOLDEN[name])
    assert decode(encode(s)) == s


def test_encode_is_byte_identical_for_integer_coordinates():
    s = QueryState(collections=["zażółć-gęślą"])
    assert encode(s) == GOLDEN["unicode"]
    assert encode(QueryState()) == GOLDEN["empty"]


def test_encode_rounds_to_6dp():
    ring = [[1.23456789, -1.23456749], [2, 0], [0, 2], [1.23456789, -1.23456749]]
    s = QueryState(aois=[Aoi({"type": "Polygon", "coordinates": [ring]})])
    assert decode(encode(s)).aois[0].geometry["coordinates"][0][0] == [1.234568, -1.234567]


def test_decode_accepts_full_share_url_and_legacy_aoi():
    import base64

    legacy = base64.urlsafe_b64encode(json.dumps({"aoi": POLY}).encode()).rstrip(b"=").decode()
    s = decode(f"https://stex.example.org/?q={legacy}&x=1")
    assert s.aois == [Aoi(POLY, True)]


@pytest.mark.parametrize("bad", ["", "%%%", "bm90LWpzb24", "eyJwYWdlU2l6ZSI6MH0", "eyJhb2lzIjpbeyJnIjp7InR5cGUiOiJQb2ludCJ9fV19"])
def test_decode_rejects_invalid(bad):
    # "not-json", {"pageSize":0}, {"aois":[{"g":{"type":"Point"}}]}
    with pytest.raises(JstexQueryError, match="Invalid query URL"):
        decode(bad)


def test_dict_roundtrip():
    s = decode(GOLDEN["full"])
    assert QueryState.from_dict(s.to_dict()) == s
    assert s.to_dict()["pageSize"] == 20


def test_cql2_single_and_multiple():
    assert build_cql2([]) is None
    one = {"field": "eo:cloud_cover", "op": "<=", "value": 10}
    assert build_cql2([one]) == {"op": "<=", "args": [{"property": "eo:cloud_cover"}, 10]}
    two = build_cql2([one, {"field": "platform", "op": "=", "value": "sentinel-2a"}])
    assert two["op"] == "and" and len(two["args"]) == 2


def test_cql2_maps_ui_operators_to_standard_names():
    # CDSE rejects "!=" and "IN" (HTTP 400); "<>" and "in" are the CQL2-JSON names.
    assert build_cql2([{"field": "platform", "op": "!=", "value": "s2a"}])["op"] == "<>"
    got = build_cql2([{"field": "platform", "op": "IN", "value": ["s2a", "s2b"]}])
    assert got == {"op": "in", "args": [{"property": "platform"}, ["s2a", "s2b"]]}
    with pytest.raises(JstexQueryError, match="IN needs a list"):
        build_cql2([{"field": "platform", "op": "IN", "value": "s2a"}])


def test_search_body_repairs_self_crossing_aoi():
    bowtie = {"type": "Polygon", "coordinates": [[[0, 0], [2, 2], [2, 0], [0, 2], [0, 0]]]}
    geom = to_search_body(QueryState(collections=["c1"], aois=[Aoi(bowtie)]))["intersects"]
    assert geom["type"] == "MultiPolygon"


def test_search_body_minimal():
    assert to_search_body(QueryState(collections=["c1"])) == {"collections": ["c1"], "limit": 50}


def test_search_body_datetime_open_ends_are_closed_with_far_bounds():
    assert "datetime" not in to_search_body(QueryState(collections=["c1"]))
    since = QueryState(collections=["c1"], datetime={"from": "2024-01-01T00:00:00Z"})
    assert to_search_body(since)["datetime"] == "2024-01-01T00:00:00Z/2099-12-31T23:59:59Z"
    until = QueryState(collections=["c1"], datetime={"to": "2024-01-31T23:59:59Z"})
    assert to_search_body(until)["datetime"] == "1900-01-01T00:00:00Z/2024-01-31T23:59:59Z"
    full = QueryState(collections=["c1"], datetime={"from": "2024-01-01T00:00:00Z", "to": "2024-01-31T23:59:59Z"})
    assert to_search_body(full)["datetime"] == "2024-01-01T00:00:00Z/2024-01-31T23:59:59Z"


def test_search_body_intersects_uses_selected_aois_only():
    s = QueryState(collections=["c1"], aois=[Aoi(POLY, True), Aoi({**POLY}, False)])
    assert to_search_body(s)["intersects"] == POLY
    assert "intersects" not in to_search_body(QueryState(collections=["c1"], aois=[Aoi(POLY, False)]))


def test_search_body_overlapping_aois_are_unioned():
    a = {"type": "Polygon", "coordinates": [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]]}
    b = {"type": "Polygon", "coordinates": [[[1, 1], [3, 1], [3, 3], [1, 3], [1, 1]]]}
    geom = to_search_body(QueryState(collections=["c1"], aois=[Aoi(a), Aoi(b)]))["intersects"]
    assert geom["type"] == "Polygon"  # one merged polygon, no overlapping parts


def test_search_body_filter():
    s = QueryState(collections=["c1"], filters=[{"field": "eo:cloud_cover", "op": "<=", "value": 10}])
    body = to_search_body(s)
    assert body["filter-lang"] == "cql2-json"
    assert body["filter"]["op"] == "<="


def test_search_body_requires_collection():
    with pytest.raises(JstexQueryError, match="collection"):
        to_search_body(QueryState())


def test_share_url():
    s = QueryState(collections=["c1"])
    assert share_url(s, "https://stex.example.org/") == f"https://stex.example.org/?q={encode(s)}"
    assert share_url(s, None) == encode(s)
```

- [ ] **Step 3: Run to confirm failure**

Run: `pytest tests/test_query.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'jstex.query'`.

- [ ] **Step 4: Implement** — `jstex/query.py`:

```python
"""QueryState and its STEX-compatible ?q= codec.

Wire format mirrors STEX src/lib/query-codec.ts: base64url (no padding) of
UTF-8 JSON, compact AOIs ``[{"g": geometry, "s": selected}]``, defaults
omitted, coordinates rounded to 6 dp with JS Math.round semantics.
"""

from __future__ import annotations

import base64
import binascii
import json
import math
from copy import deepcopy
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import parse_qs, urlparse

from shapely.geometry import mapping, shape
from shapely.ops import unary_union

from .aoi import repair
from .errors import JstexQueryError

DEFAULT_SORT = {"field": "properties.datetime", "direction": "desc"}
# Open-ended ranges are sent closed: the CDSE endpoint's firewall rejects
# "../end" (looks like path traversal), so a missing end gets a far bound.
OPEN_START = "1900-01-01T00:00:00Z"
OPEN_END = "2099-12-31T23:59:59Z"
DEFAULT_PAGE_SIZE = 50
FILTER_OPS = {"=", "!=", "<", "<=", ">", ">=", "IN"}
# UI operators -> standard CQL2-JSON. CDSE answers HTTP 400 to "!=" and "IN"
# (verified 2026-09-30); "<>" and "in" work.
CQL2_OPS = {"=": "=", "!=": "<>", "<": "<", "<=": "<=", ">": ">", ">=": ">=", "IN": "in"}
POLYGONAL = {"Polygon", "MultiPolygon"}


@dataclass
class Aoi:
    geometry: dict
    selected: bool = True


@dataclass
class QueryState:
    collections: list[str] = field(default_factory=list)
    datetime: dict[str, str] | None = None
    aois: list[Aoi] = field(default_factory=list)
    filters: list[dict] = field(default_factory=list)
    sort: dict = field(default_factory=lambda: dict(DEFAULT_SORT))
    page_size: int = DEFAULT_PAGE_SIZE

    def to_dict(self) -> dict[str, Any]:
        return {
            "collections": list(self.collections),
            "datetime": dict(self.datetime) if self.datetime else None,
            "aois": [{"geometry": deepcopy(a.geometry), "selected": a.selected} for a in self.aois],
            "filters": deepcopy(self.filters),
            "sort": dict(self.sort),
            "pageSize": self.page_size,
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> QueryState:
        return _validate(
            {
                "collections": d.get("collections") or [],
                "datetime": d.get("datetime") or None,
                "aois": [{"g": a.get("geometry"), "s": a.get("selected", True)} for a in d.get("aois") or []],
                "filters": d.get("filters") or [],
                "sort": d.get("sort") or dict(DEFAULT_SORT),
                "pageSize": d.get("pageSize", DEFAULT_PAGE_SIZE),
            }
        )


# ── codec ───────────────────────────────────────────────────────────


def _js_round(n: float) -> float:
    r = math.floor(n * 1e6 + 0.5) / 1e6
    return 0.0 if r == 0 else r


def _num(n: float) -> int | float:
    # JSON.stringify(10.0) == "10": emit ints for integral values.
    return int(n) if float(n).is_integer() else n


def _round_geometry(geom: dict) -> dict:
    def ring(r):
        return [[_num(_js_round(x)), _num(_js_round(y))] for x, y, *_ in r]

    if geom["type"] == "Polygon":
        return {"type": "Polygon", "coordinates": [ring(r) for r in geom["coordinates"]]}
    if geom["type"] == "MultiPolygon":
        return {"type": "MultiPolygon", "coordinates": [[ring(r) for r in p] for p in geom["coordinates"]]}
    return geom


def encode(state: QueryState) -> str:
    obj: dict[str, Any] = {}
    if state.collections:
        obj["collections"] = state.collections
    if state.datetime:
        obj["datetime"] = state.datetime
    if state.aois:
        obj["aois"] = [{"g": _round_geometry(a.geometry), "s": a.selected} for a in state.aois]
    if state.filters:
        obj["filters"] = state.filters
    if state.sort != DEFAULT_SORT:
        obj["sort"] = state.sort
    if state.page_size != DEFAULT_PAGE_SIZE:
        obj["pageSize"] = state.page_size
    raw = json.dumps(obj, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _extract_q(q: str) -> str:
    q = q.strip()
    if "://" in q or q.startswith("?"):
        values = parse_qs(urlparse(q).query).get("q")
        if not values:
            raise JstexQueryError("Invalid query URL")
        return values[0]
    return q


def decode(q: str) -> QueryState:
    try:
        encoded = _extract_q(q)
        if not encoded:
            raise ValueError("empty")
        raw = base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4))
        obj = json.loads(raw.decode("utf-8"))
        if not isinstance(obj, dict):
            raise ValueError("not an object")
        if "aois" not in obj and "aoi" in obj:
            obj["aois"] = [{"g": obj.pop("aoi"), "s": True}]
        return _validate(obj)
    except JstexQueryError:
        raise
    except (ValueError, TypeError, KeyError, binascii.Error, UnicodeDecodeError) as err:
        raise JstexQueryError("Invalid query URL") from err


def _validate(obj: dict[str, Any]) -> QueryState:
    def bad() -> JstexQueryError:
        return JstexQueryError("Invalid query URL")

    collections = obj.get("collections", [])
    if not (isinstance(collections, list) and all(isinstance(c, str) for c in collections)):
        raise bad()
    dt = obj.get("datetime")
    if dt is not None:
        if not isinstance(dt, dict) or not (dt.get("from") or dt.get("to")):
            raise bad()
        if any(k in dt and not isinstance(dt[k], str) for k in ("from", "to")):
            raise bad()
        dt = {k: dt[k] for k in ("from", "to") if dt.get(k)}
    aois = []
    for a in obj.get("aois", []) or []:
        geom = a.get("g") or a.get("geometry") if isinstance(a, dict) else None
        if not isinstance(geom, dict) or geom.get("type") not in POLYGONAL:
            raise bad()
        aois.append(Aoi(geom, bool(a.get("s", a.get("selected", True)))))
    filters = obj.get("filters", [])
    if not isinstance(filters, list) or not all(
        isinstance(f, dict) and isinstance(f.get("field"), str) and f.get("op") in FILTER_OPS and "value" in f
        for f in filters
    ):
        raise bad()
    sort = obj.get("sort", dict(DEFAULT_SORT))
    if not (isinstance(sort, dict) and isinstance(sort.get("field"), str) and sort.get("direction") in ("asc", "desc")):
        raise bad()
    page_size = obj.get("pageSize", DEFAULT_PAGE_SIZE)
    if not isinstance(page_size, int) or isinstance(page_size, bool) or page_size <= 0:
        raise bad()
    return QueryState(list(collections), dt, aois, filters, dict(sort), page_size)


def share_url(state: QueryState, base: str | None) -> str:
    q = encode(state)
    return f"{base.rstrip('?')}?q={q}" if base else q


# ── search request ──────────────────────────────────────────────────


def _predicate(f: dict) -> dict:
    value = f["value"]
    if f["op"] == "IN" and not isinstance(value, list):
        raise JstexQueryError(f"Filter {f['field']}: IN needs a list of values.")
    return {"op": CQL2_OPS[f["op"]], "args": [{"property": f["field"]}, value]}


def build_cql2(filters: list[dict]) -> dict | None:
    preds = [_predicate(f) for f in filters]
    if not preds:
        return None
    return preds[0] if len(preds) == 1 else {"op": "and", "args": preds}


def _intersects(aois: list[Aoi]) -> dict | None:
    geoms = [repair(a.geometry) for a in aois if a.selected]
    if not geoms:
        return None
    if len(geoms) == 1:
        return geoms[0]
    # jstex keeps one AOI; several can only come from a decoded STEX share link.
    # Overlapping parts make CDSE fail with "GEOSIntersects: TopologyException".
    merged = unary_union([shape(g).buffer(0) for g in geoms])
    return json.loads(json.dumps(mapping(merged)))  # tuples -> lists


def to_search_body(state: QueryState) -> dict[str, Any]:
    if not state.collections:
        raise JstexQueryError("Select at least one collection before searching.")
    body: dict[str, Any] = {"collections": list(state.collections), "limit": state.page_size}
    dt = state.datetime or {}
    if dt.get("from") or dt.get("to"):
        body["datetime"] = f"{dt.get('from') or OPEN_START}/{dt.get('to') or OPEN_END}"
    geom = _intersects(state.aois)
    if geom is not None:
        body["intersects"] = geom
    cql = build_cql2(state.filters)
    if cql is not None:
        body["filter"] = cql
        body["filter-lang"] = "cql2-json"
    return body
```

- [ ] **Step 5: Run tests**

Run: `pytest tests/test_query.py -q`
Expected: all PASS. If `test_encode_is_byte_identical_for_integer_coordinates` fails, compare `base64.urlsafe_b64decode` of both strings — the difference will be JSON spacing/escaping; fix `json.dumps` arguments, not the fixture.

- [ ] **Step 6: Commit**

```bash
ruff check jstex tests && ruff format jstex tests
git add jstex/query.py tests/test_query.py tests/fixtures/stex_codec_golden.json
git commit -m "feat: QueryState with STEX-compatible ?q= codec and search body builder

Golden fixtures generated by STEX's own encodeQueryState."
```

---

### Task 6: STAC backend (`StacBackend`)

**Files:**
- Create: `jstex/stac.py`
- Test: `tests/test_stac.py`

**Interfaces:**
- Consumes: `jstex.auth.get_token`, `jstex.auth.current(force_refresh=True)`, `jstex.query.QueryState`, `jstex.query.to_search_body`, `jstex.errors.JstexStacError`.
- Produces:
  - `Page(items: list[dict], next_link: dict | None, search_body: dict, matched: int | None)` dataclass.
  - `StacBackend(url: str, *, retry: Retry | None = None, timeout: float = 30)` with `.io` (a `StacApiIO`, usable as pystac `stac_io`), `.list_collections() -> list[{"id","title","description","license","start","end"}]` (sorted by title, follows `next`), `.merged_queryables(collection_ids) -> list[{"name","title","type","enum"?,"minimum"?,"maximum"?}]` (fields shared by ALL given collections; space/time fields excluded; enums kept only when all collections agree), `.queryables(collection_id) -> dict` (cached), `.search_page(state) -> Page`, `.next_page(next_link, search_body) -> Page`, `.read_item(href) -> pystac.Item`.
  - `default_retry() -> Retry` (4 retries, backoff 1 s, 429/502/503/504, POST included).

- [ ] **Step 1: Write failing tests** — `tests/test_stac.py`:

```python
import json
import time

import pytest
import responses
from responses import matchers
from responses.registries import OrderedRegistry
from urllib3.util.retry import Retry

from jstex import auth
from jstex.errors import JstexStacError
from jstex.query import QueryState
from jstex.stac import StacBackend
from tests.conftest import make_jwt

URL = "https://stac.test/v1/"
NO_WAIT = Retry(total=2, backoff_factor=0, status_forcelist=(429,), allowed_methods=None, raise_on_status=False)


def item(i: str) -> dict:
    return {
        "type": "Feature",
        "stac_version": "1.0.0",
        "id": i,
        "geometry": None,
        "properties": {"datetime": "2024-07-01T10:00:00Z"},
        "links": [{"rel": "self", "href": f"{URL}collections/c1/items/{i}"}],
        "assets": {},
    }


@responses.activate
def test_collections_follow_next_and_depend_on_token(monkeypatch):
    monkeypatch.setenv("JSTEX_ACCESS_TOKEN", "T")
    responses.get(
        URL + "collections",
        json={"collections": [{"id": "open", "title": "Open"}], "links": [{"rel": "next", "href": URL + "collections?page=2"}]},
        match=[matchers.query_param_matcher({})],
    )
    responses.get(
        URL + "collections",
        json={"collections": [{"id": "restricted", "title": "Alpha restricted"}], "links": []},
        match=[matchers.query_param_matcher({"page": "2"}), matchers.header_matcher({"Authorization": "Bearer T"})],
    )
    assert [c["id"] for c in StacBackend(URL).list_collections()] == ["restricted", "open"]


@responses.activate
def test_collections_carry_info_for_the_picker():
    responses.get(
        URL + "collections",
        json={
            "collections": [
                {
                    "id": "s2",
                    "title": "Sentinel-2",
                    "description": "Surface reflectance",
                    "license": "other",
                    "extent": {"temporal": {"interval": [["2015-06-27T10:25:31Z", None]]}},
                },
                {"id": "bare"},
            ],
            "links": [],
        },
    )
    got = {c["id"]: c for c in StacBackend(URL).list_collections()}
    assert got["s2"] == {
        "id": "s2", "title": "Sentinel-2", "description": "Surface reflectance",
        "license": "other", "start": "2015-06-27T10:25:31Z", "end": None,
    }
    assert got["bare"] == {"id": "bare", "title": "bare", "description": "", "license": "", "start": None, "end": None}


@responses.activate
def test_merged_queryables_is_an_intersection():
    responses.get(URL + "collections/a/queryables", json={"properties": {
        "eo:cloud_cover": {"title": "Cloud", "type": "number", "minimum": 0, "maximum": 100},
        "platform": {"type": "string", "enum": ["s2a", "s2b"]},
        "orbit": {"type": "integer"},
        "only_a": {"type": "string"},
        "datetime": {"type": "string"},
        "geometry": {"type": "object"},
    }})
    responses.get(URL + "collections/b/queryables", json={"properties": {
        "eo:cloud_cover": {"type": "number"},
        "platform": {"type": "string", "enum": ["s2c"]},
        "orbit": {"type": "string"},
    }})
    b = StacBackend(URL)
    assert b.merged_queryables([]) == []
    assert [f["name"] for f in b.merged_queryables(["a"])] == ["eo:cloud_cover", "only_a", "orbit", "platform"]
    both = b.merged_queryables(["a", "b"])
    assert both == [
        {"name": "eo:cloud_cover", "title": "Cloud", "type": "number", "minimum": 0, "maximum": 100},
        {"name": "platform", "title": "platform", "type": "string"},
    ]


@responses.activate
def test_search_page_posts_body_and_returns_next_link():
    nxt = {"rel": "next", "href": URL + "search", "method": "POST", "body": {"token": "abc"}, "merge": True}
    responses.post(URL + "search", json={"features": [item("a")], "links": [nxt], "numberMatched": 7})
    page = StacBackend(URL).search_page(QueryState(collections=["c1"], page_size=1))
    assert [i["id"] for i in page.items] == ["a"]
    assert page.next_link == nxt and page.matched == 7
    assert json.loads(responses.calls[0].request.body) == {"collections": ["c1"], "limit": 1}


@responses.activate
def test_next_page_follows_link_exactly_with_merge():
    nxt = {"rel": "next", "href": URL + "search?x=1", "method": "POST", "body": {"token": "abc"}, "merge": True}
    responses.post(URL + "search?x=1", json={"features": [item("b")], "links": []})
    page = StacBackend(URL).next_page(nxt, {"collections": ["c1"], "limit": 1})
    assert responses.calls[0].request.url == URL + "search?x=1"
    assert json.loads(responses.calls[0].request.body) == {"collections": ["c1"], "limit": 1, "token": "abc"}
    assert page.next_link is None


@responses.activate
def test_get_next_link_uses_href_verbatim():
    nxt = {"rel": "next", "href": URL + "search?token=abc&collections=c1"}
    responses.get(URL + "search", json={"features": [], "links": []})
    StacBackend(URL).next_page(nxt, {"collections": ["c1"]})
    assert responses.calls[0].request.url == URL + "search?token=abc&collections=c1"


@responses.activate
def test_401_refreshes_token_once_and_retries(hub_env):
    responses.get(hub_env, json={"auth_state": {"access_token": make_jwt(time.time() + 600)}})
    responses.post(URL + "search", status=401, json={"detail": "expired"})
    responses.post(URL + "search", json={"features": [], "links": []})
    StacBackend(URL).search_page(QueryState(collections=["c1"]))
    hub_calls = [c for c in responses.calls if c.request.url == hub_env]
    assert len(hub_calls) == 2  # initial + force_refresh


@responses.activate
def test_persistent_403_raises_typed_error():
    responses.post(URL + "search", status=403, json={"detail": "no"})
    with pytest.raises(JstexStacError) as exc:
        StacBackend(URL).search_page(QueryState(collections=["c1"]))
    assert exc.value.status == 403 and "Not authorised" in str(exc.value)


@responses.activate(registry=OrderedRegistry)
def test_429_is_retried():
    responses.post(URL + "search", status=429, json={})
    responses.post(URL + "search", json={"features": [item("a")], "links": []})
    page = StacBackend(URL, retry=NO_WAIT).search_page(QueryState(collections=["c1"]))
    assert [i["id"] for i in page.items] == ["a"]


@responses.activate
def test_429_exhausted_raises_rate_limited():
    responses.post(URL + "search", status=429, json={})
    with pytest.raises(JstexStacError, match="Rate limited"):
        StacBackend(URL, retry=NO_WAIT).search_page(QueryState(collections=["c1"]))


@responses.activate
def test_queryables_cached_per_collection():
    responses.get(URL + "collections/c1/queryables", json={"properties": {"eo:cloud_cover": {"type": "number"}}})
    b = StacBackend(URL)
    b.queryables("c1")
    b.queryables("c1")
    assert len(responses.calls) == 1


@responses.activate
def test_read_item_sets_self_href_when_missing():
    d = item("a")
    d["links"] = []
    responses.get(URL + "collections/c1/items/a", json=d)
    it = StacBackend(URL).read_item(URL + "collections/c1/items/a")
    assert it.id == "a" and it.get_self_href() == URL + "collections/c1/items/a"
```

- [ ] **Step 2: Run to confirm failure**

Run: `pytest tests/test_stac.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'jstex.stac'`.

- [ ] **Step 3: Implement** — `jstex/stac.py`:

```python
"""All HTTP to the STAC API. Stateless: pagination state travels in ``Page``.

Uses pystac-client's StacApiIO so ``rel=next`` links are followed exactly
(method, body and ``merge`` included) and urllib3 retries handle 429/5xx.
The user's token is injected per request, so a token refreshed mid-session
is picked up without rebuilding the client.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

import pystac
from pystac import Link
from pystac_client.exceptions import APIError
from pystac_client.stac_api_io import StacApiIO
from requests import Request
from urllib3.util.retry import Retry

from . import auth
from .errors import JstexStacError
from .query import QueryState, to_search_body

MAX_COLLECTION_PAGES = 50
# Queryables that the widget does not offer as attribute filters: space and time
# have their own controls, the rest are bookkeeping.
NOT_FILTERABLE = {"geometry", "bbox", "datetime", "start_datetime", "end_datetime", "collection", "stac_version"}
FILTER_TYPES = {"string", "number", "integer", "boolean"}


def default_retry() -> Retry:
    return Retry(
        total=4,
        backoff_factor=1.0,
        status_forcelist=(429, 502, 503, 504),
        allowed_methods=None,  # retry POST /search too
        raise_on_status=False,  # hand the final response to pystac-client
        respect_retry_after_header=True,
    )


@dataclass
class Page:
    items: list[dict]
    next_link: dict | None
    search_body: dict
    matched: int | None


def _next_link(doc: dict) -> dict | None:
    return next((link for link in doc.get("links", []) if link.get("rel") == "next"), None)


def _message(err: APIError, status: int | None) -> str:
    if status in (401, 403):
        return f"Not authorised for this STAC resource (HTTP {status})."
    if status == 429:
        return "Rate limited by the STAC API; try again shortly."
    detail = str(err).strip()[:300]
    return f"STAC request failed (HTTP {status}): {detail}" if status else f"STAC request failed: {detail}"


class StacBackend:
    def __init__(self, url: str, *, retry: Retry | None = None, timeout: float = 30):
        self.url = url
        self.io = StacApiIO(request_modifier=self._add_auth, timeout=timeout, max_retries=retry or default_retry())
        self._queryables: dict[str, dict] = {}

    @staticmethod
    def _add_auth(request: Request) -> Request:
        token = auth.get_token()
        if token:
            request.headers["Authorization"] = f"Bearer {token}"
        return request

    def _read(self, source: str | Link, method: str | None = None, parameters: dict | None = None) -> dict:
        for attempt in (0, 1):
            try:
                if isinstance(source, Link):
                    text = self.io.read_text(source, parameters=parameters or {})
                else:
                    text = self.io.request(source, method=method, parameters=parameters)
                return json.loads(text)
            except APIError as err:
                status = getattr(err, "status_code", None)
                if status == 401 and attempt == 0:
                    auth.current(force_refresh=True)
                    continue
                raise JstexStacError(_message(err, status), status) from err
        raise AssertionError("unreachable")

    def list_collections(self) -> list[dict[str, Any]]:
        """Collections the token can see: id, title, description, license, start, end (sorted by title)."""
        found: dict[str, dict[str, Any]] = {}
        source: str | Link | None = self.url + "collections"
        for _ in range(MAX_COLLECTION_PAGES):
            if source is None:
                break
            doc = self._read(source)
            for c in doc.get("collections", []):
                interval = ((((c.get("extent") or {}).get("temporal") or {}).get("interval")) or [[None, None]])[0]
                found.setdefault(
                    c["id"],
                    {
                        "id": c["id"],
                        "title": c.get("title") or c["id"],
                        "description": c.get("description") or "",
                        "license": c.get("license") or "",
                        "start": (interval + [None, None])[0],
                        "end": (interval + [None, None])[1],
                    },
                )
            nxt = _next_link(doc)
            source = Link.from_dict(nxt) if nxt else None
        return sorted(found.values(), key=lambda c: c["title"].lower())

    def queryables(self, collection_id: str) -> dict[str, Any]:
        if collection_id not in self._queryables:
            self._queryables[collection_id] = self._read(f"{self.url}collections/{collection_id}/queryables")
        return self._queryables[collection_id]

    def merged_queryables(self, collection_ids: list[str]) -> list[dict[str, Any]]:
        """Filterable fields shared by ALL given collections (intersection).

        Each field: ``{"name", "title", "type", "enum"?, "minimum"?, "maximum"?}``.
        A field whose type differs between collections is dropped; an enum is
        kept only when every collection lists the same values.
        """
        if not collection_ids:
            return []
        schemas = [(self.queryables(cid).get("properties") or {}) for cid in collection_ids]
        fields = []
        for name in sorted(schemas[0]):
            if name in NOT_FILTERABLE or not all(name in s for s in schemas):
                continue
            first = schemas[0][name]
            kind = first.get("type")
            if kind not in FILTER_TYPES or any(s[name].get("type") != kind for s in schemas[1:]):
                continue
            field: dict[str, Any] = {"name": name, "title": first.get("title") or name, "type": kind}
            enum = first.get("enum")
            if enum and all(s[name].get("enum") == enum for s in schemas[1:]):
                field["enum"] = enum
            for bound in ("minimum", "maximum"):
                if bound in first:
                    field[bound] = first[bound]
            fields.append(field)
        return fields

    def _page(self, doc: dict, body: dict) -> Page:
        matched = doc.get("numberMatched", (doc.get("context") or {}).get("matched"))
        return Page(doc.get("features", []), _next_link(doc), body, matched)

    def search_page(self, state: QueryState) -> Page:
        body = to_search_body(state)
        return self._page(self._read(self.url + "search", "POST", body), body)

    def next_page(self, next_link: dict, search_body: dict) -> Page:
        return self._page(self._read(Link.from_dict(next_link), parameters=search_body), search_body)

    def read_item(self, href: str) -> pystac.Item:
        item = pystac.Item.from_dict(self._read(href))
        if not item.get_self_href():
            item.set_self_href(href)
        return item
```

- [ ] **Step 4: Run tests**

Run: `pytest tests -q`
Expected: all PASS (this suite was verified against pystac-client 0.9.0 + responses 0.25 while writing the plan).

- [ ] **Step 5: Commit**

```bash
ruff check jstex tests && ruff format jstex tests
git add jstex/stac.py tests/test_stac.py
git commit -m "feat: stateless STAC backend with per-request token, 401 refresh, 429 retry"
```

---

### Task 7: `Explorer` Python side — message protocol, worker threads, pystac accessors, `jstex.item()`

**Files:**
- Modify: `jstex/widget.py` (replace the Task 2 stub), `jstex/__init__.py`
- Create: `jstex/api.py`
- Test: `tests/test_widget.py`, `tests/test_api.py`

**Interfaces:**
- Consumes: `StacBackend.list_collections/merged_queryables/search_page`, `jstex.aoi.parse_aoi_upload`, `Page`, `QueryState.from_dict/to_dict`, `to_search_body`, `share_url`, `auth.current`, `load_config`.
- Produces (the JS side in Tasks 8–15 relies on these exact names):
  - Synced traitlets: `query: dict` (QueryState dict form), `selected_ids: list[str]`, `active_id: str | None`, `status: "idle"|"searching"|"error"`, `error: str`, `auth_source: "hub"|"env"|"anonymous"`, `map_height: int`, `can_cancel: bool`, `basemap: {"light": {url, attribution}, "dark": {…}}` (from config, set once), `panel_collapsed: bool` (the search panel folded to its rail; remembered per widget).
  - JS → Python messages: `{"type":"collections","req_id":n}`, `{"type":"search","query":{…}}`, `{"type":"cancel"}`, `{"type":"queryables","req_id":n,"collections":[…]}`, `{"type":"aoi_upload","req_id":n,"text":str}` (validation only; the JS side replaces the AOI on success), `{"type":"sync"}` (sent on every render; Python re-sends the current page, selection untouched).
  - Python → JS messages: `{"type":"reply","req_id":n,"ok":true,"data":…}` (collections list / field list / geometry) / `{"type":"reply","req_id":n,"ok":false,"error":str}`; `{"type":"page","items":[StacItem…],"matched":int|null}` (always replaces results in stage 1).
  - Python API: `Explorer(*, stac_url=None, height=600, backend=None, runner=None)`, `.search(wait=False)`, `.cancel()`, `.results -> pystac.ItemCollection`, `.selected_items -> list[pystac.Item]`, `.selected_item -> pystac.Item | None`, `.query_url() -> str`; module-level `thread_runner`, `sync_runner`, `DEFAULT_RUNNER`.
  - `jstex.item(href, *, stac_url=None) -> pystac.Item`.

- [ ] **Step 1: Write failing tests** — `tests/test_widget.py`:

```python
import pytest

from jstex.errors import JstexQueryError, JstexStacError
from jstex.stac import Page
from jstex.widget import Explorer, sync_runner

URL = "https://stac.test/v1/"


def item(i: str) -> dict:
    return {
        "type": "Feature",
        "stac_version": "1.0.0",
        "id": i,
        "geometry": None,
        "properties": {"datetime": "2024-07-01T10:00:00Z"},
        "links": [{"rel": "self", "href": f"{URL}collections/c1/items/{i}"}],
        "assets": {"B04": {"href": f"s3://eodata/{i}/B04.jp2"}},
    }


class FakeBackend:
    def __init__(self, pages=None, error=None):
        self.pages = list(pages or [])
        self.error = error
        self.searched = []

    def list_collections(self):
        if self.error:
            raise self.error
        return [{"id": "c1", "title": "C1"}]

    def merged_queryables(self, ids):
        if self.error:
            raise self.error
        return [{"name": "eo:cloud_cover", "title": "Cloud", "type": "number"}] if ids else []

    def search_page(self, state):
        self.searched.append(state)
        if self.error:
            raise self.error
        return self.pages.pop(0)


def page(*ids, matched=None):
    return Page([item(i) for i in ids], None, {}, matched)


def make(backend, runner=sync_runner):
    ex = Explorer(backend=backend, runner=runner)
    sent = []
    ex.send = lambda content, buffers=None: sent.append(content)
    return ex, sent


def search_msg(collections=("c1",)):
    return {"type": "search", "query": {"collections": list(collections), "datetime": None, "aois": [], "filters": [], "sort": {"field": "properties.datetime", "direction": "desc"}, "pageSize": 50}}


def test_collections_reply_and_auth_source(monkeypatch):
    monkeypatch.setenv("JSTEX_ACCESS_TOKEN", "T")
    ex, sent = make(FakeBackend())
    ex._on_msg(ex, {"type": "collections", "req_id": 7}, [])
    assert sent == [{"type": "reply", "req_id": 7, "ok": True, "data": [{"id": "c1", "title": "C1"}]}]
    assert ex.auth_source == "env"


def test_collections_error_reply():
    ex, sent = make(FakeBackend(error=JstexStacError("boom", 500)))
    ex._on_msg(ex, {"type": "collections", "req_id": 1}, [])
    assert sent[0]["ok"] is False and "boom" in sent[0]["error"]
    assert ex.auth_source == "anonymous"


def test_search_message_sets_query_sends_deduped_page():
    ex, sent = make(FakeBackend([page("a", "b", "a", matched=3)]))
    ex._on_msg(ex, search_msg(), [])
    assert ex.query["collections"] == ["c1"]
    assert sent == [{"type": "page", "items": [item("a"), item("b")], "matched": 3}]
    assert ex.status == "idle" and ex.error == ""


def test_accessors_return_pystac_objects():
    ex, _ = make(FakeBackend([page("a", "b")]))
    ex._on_msg(ex, search_msg(), [])
    ex.selected_ids = ["b"]
    ex.active_id = "a"
    assert [i.id for i in ex.results] == ["a", "b"]
    assert [i.id for i in ex.selected_items] == ["b"]
    assert ex.selected_item.get_self_href() == f"{URL}collections/c1/items/a"
    assert ex.selected_item.assets["B04"].href == "s3://eodata/a/B04.jp2"


def test_new_search_clears_selection():
    ex, _ = make(FakeBackend([page("a"), page("b")]))
    ex._on_msg(ex, search_msg(), [])
    ex.selected_ids, ex.active_id = ["a"], "a"
    ex._on_msg(ex, search_msg(), [])
    assert ex.selected_ids == [] and ex.active_id is None


def test_stac_error_sets_error_status_and_keeps_results():
    backend = FakeBackend([page("a")])
    ex, sent = make(backend)
    ex._on_msg(ex, search_msg(), [])
    backend.error = JstexStacError("Rate limited by the STAC API; try again shortly.", 429)
    ex._on_msg(ex, search_msg(), [])
    assert ex.status == "error" and "Rate limited" in ex.error
    assert [i.id for i in ex.results] == ["a"]
    assert len(sent) == 1


def test_cancel_drops_stale_result_and_keeps_previous():
    deferred = []
    backend = FakeBackend([page("a"), page("b")])
    ex, sent = make(backend, runner=lambda fn, *a: deferred.append((fn, a)))
    ex._on_msg(ex, search_msg(), [])
    fn, a = deferred.pop()
    fn(*a)  # first search completes
    ex._on_msg(ex, search_msg(), [])
    assert ex.status == "searching"
    ex._on_msg(ex, {"type": "cancel"}, [])
    assert ex.status == "idle"
    fn, a = deferred.pop()
    fn(*a)  # stale completion
    assert [m["items"][0]["id"] for m in sent] == ["a"]
    assert [i.id for i in ex.results] == ["a"]


def test_search_without_collection():
    ex, sent = make(FakeBackend())
    with pytest.raises(JstexQueryError):
        ex.search()
    ex._on_msg(ex, search_msg(collections=()), [])
    assert ex.status == "error" and "collection" in ex.error and sent == []


def test_python_search_wait_populates_results():
    ex, _ = make(FakeBackend([page("a")]), runner=lambda fn, *a: None)  # runner never runs
    ex.query = {**ex.query, "collections": ["c1"]}
    ex.search(wait=True)
    assert [i.id for i in ex.results] == ["a"]


def test_instances_are_independent():
    ex1, _ = make(FakeBackend([page("a")]))
    ex2, _ = make(FakeBackend([page("b")]))
    ex1._on_msg(ex1, search_msg(), [])
    ex2._on_msg(ex2, search_msg(), [])
    assert [i.id for i in ex1.results] == ["a"] and [i.id for i in ex2.results] == ["b"]


def test_sync_runner_disables_cancel():
    assert make(FakeBackend(), runner=sync_runner)[0].can_cancel is False
    assert make(FakeBackend(), runner=lambda fn, *a: None)[0].can_cancel is True


def test_query_url(monkeypatch):
    monkeypatch.setenv("JSTEX_STEX_URL", "https://stex.example.org/")
    ex, _ = make(FakeBackend())
    assert ex.query_url() == "https://stex.example.org/?q=e30"


def test_sync_resends_current_page_without_clearing_selection():
    ex, sent = make(FakeBackend([page("a", "b", matched=2)]))
    ex._on_msg(ex, {"type": "sync"}, [])
    assert sent == []  # nothing searched yet
    ex._on_msg(ex, search_msg(), [])
    ex.selected_ids, ex.active_id = ["b"], "b"
    ex._on_msg(ex, {"type": "sync"}, [])
    assert sent[-1] == {"type": "page", "items": [item("a"), item("b")], "matched": 2}
    assert ex.selected_ids == ["b"] and ex.active_id == "b"


def test_basemap_trait_from_config(monkeypatch):
    monkeypatch.setenv("JSTEX_BASEMAP_DARK_KEY", "K")
    ex, _ = make(FakeBackend())
    assert ex.basemap["light"]["url"] == "https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png"
    assert ex.basemap["dark"]["url"].endswith("alidade_smooth_dark/{z}/{x}/{y}@2x.png?api_key=K")
    assert "CARTO" in ex.basemap["light"]["attribution"]


def test_queryables_message_replies_merged_fields():
    ex, sent = make(FakeBackend())
    ex._on_msg(ex, {"type": "queryables", "req_id": 4, "collections": ["c1", "c2"]}, [])
    assert sent == [{"type": "reply", "req_id": 4, "ok": True, "data": [{"name": "eo:cloud_cover", "title": "Cloud", "type": "number"}]}]


def test_queryables_error_is_a_failed_reply():
    ex, sent = make(FakeBackend(error=JstexStacError("down", 503)))
    ex._on_msg(ex, {"type": "queryables", "req_id": 5, "collections": ["c1"]}, [])
    assert sent[0]["ok"] is False and "down" in sent[0]["error"]


def test_aoi_upload_validates_without_touching_the_query():
    ex, sent = make(FakeBackend())
    good = '{"type":"Feature","geometry":{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,0]]]}}'
    ex._on_msg(ex, {"type": "aoi_upload", "req_id": 1, "text": good}, [])
    assert sent[-1]["ok"] is True and sent[-1]["data"]["type"] == "Polygon"
    ex._on_msg(ex, {"type": "aoi_upload", "req_id": 2, "text": '{"type":"Point","coordinates":[0,0]}'}, [])
    assert sent[-1] == {"type": "reply", "req_id": 2, "ok": False, "error": "No polygon geometry found"}
    assert ex.query["aois"] == []


def test_panel_collapsed_defaults_to_open():
    assert make(FakeBackend())[0].panel_collapsed is False
```

`tests/test_api.py`:

```python
import responses
from responses import matchers

import jstex


@responses.activate
def test_item_opens_with_bearer_token(monkeypatch):
    monkeypatch.setenv("JSTEX_ACCESS_TOKEN", "T")
    href = "https://stac.test/v1/collections/c1/items/a"
    responses.get(
        href,
        json={"type": "Feature", "stac_version": "1.0.0", "id": "a", "geometry": None,
              "properties": {"datetime": None, "start_datetime": "2024-01-01T00:00:00Z",
                             "end_datetime": "2024-12-31T23:59:59Z"},
              "links": [], "assets": {}},
        match=[matchers.header_matcher({"Authorization": "Bearer T"})],
    )
    it = jstex.item(href)
    assert it.id == "a" and it.get_self_href() == href


def test_import_is_light():
    # The Jupyter server imports jstex via the jupyterlab.locale entry point to
    # find translations; that must not pull in the widget stack.
    import subprocess
    import sys

    code = "import jstex, sys; print(any(m in sys.modules for m in ('jstex.widget', 'anywidget', 'pystac_client')))"
    out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, check=True)
    assert out.stdout.strip() == "False"
```

- [ ] **Step 2: Run to confirm failure**

Run: `pytest tests/test_widget.py tests/test_api.py -q`
Expected: FAIL — `ImportError: cannot import name 'sync_runner'` / `module 'jstex' has no attribute 'item'`. (These tests need `jstex/static/widget.js` to exist: run `jlpm build:widget` first if you cleaned.)

- [ ] **Step 3: Implement** — replace `jstex/widget.py`:

```python
"""``jstex.Explorer`` — the in-cell widget.

Python owns all STAC traffic and the token; the JS side is a view that sends
``collections`` / ``queryables`` / ``aoi_upload`` / ``search`` / ``cancel`` /
``sync`` messages and renders what comes back.
Search results travel as custom messages (a page of CDSE items can be several
MB — too big to live in a synced traitlet).
"""

from __future__ import annotations

import pathlib
import threading
from collections.abc import Callable
from typing import Any

import anywidget
import pystac
import traitlets

from . import auth
from .aoi import parse_aoi_upload
from .config import load_config
from .errors import JstexError
from .query import QueryState, share_url, to_search_body
from .stac import Page, StacBackend

STATIC = pathlib.Path(__file__).parent / "static"

Runner = Callable[..., None]


def thread_runner(fn: Callable[..., None], *args: Any) -> None:
    threading.Thread(target=fn, args=args, daemon=True).start()


def sync_runner(fn: Callable[..., None], *args: Any) -> None:
    fn(*args)


# Set from the Task 2 spike (DEVELOPMENT.md "THREAD_SEND_OK"):
# thread_runner if worker-thread sends are reliable, else sync_runner.
DEFAULT_RUNNER: Runner = thread_runner


class Explorer(anywidget.AnyWidget):
    """Map-based STAC search in a notebook cell.

    After a search, ``ex.results`` holds every loaded item, ``ex.selected_items``
    the checked ones and ``ex.selected_item`` the one shown in Item details —
    all as ``pystac`` objects.
    """

    _esm = STATIC / "widget.js"
    _css = STATIC / "widget.css"

    query = traitlets.Dict().tag(sync=True)
    selected_ids = traitlets.List(traitlets.Unicode()).tag(sync=True)
    active_id = traitlets.Unicode(None, allow_none=True).tag(sync=True)
    status = traitlets.Unicode("idle").tag(sync=True)  # idle | searching | error
    error = traitlets.Unicode("").tag(sync=True)
    auth_source = traitlets.Unicode("anonymous").tag(sync=True)
    map_height = traitlets.Int(600).tag(sync=True)
    can_cancel = traitlets.Bool(True).tag(sync=True)
    basemap = traitlets.Dict().tag(sync=True)  # {"light": {url, attribution}, "dark": {...}}
    panel_collapsed = traitlets.Bool(False).tag(sync=True)  # search panel folded to a rail

    def __init__(
        self,
        *,
        stac_url: str | None = None,
        height: int = 600,
        backend: StacBackend | None = None,
        runner: Runner | None = None,
        **kwargs: Any,
    ):
        run = runner or DEFAULT_RUNNER
        config = load_config(stac_url=stac_url)
        super().__init__(
            query=QueryState().to_dict(),
            map_height=height,
            can_cancel=run is not sync_runner,
            basemap={
                "light": {"url": config.basemap_light.tile_url(), "attribution": config.basemap_light.attribution},
                "dark": {"url": config.basemap_dark.tile_url(), "attribution": config.basemap_dark.attribution},
            },
            **kwargs,
        )
        self._config = config
        self._backend = backend or StacBackend(self._config.stac_url)
        self._run = run
        self._items: dict[str, dict] = {}
        self._page: Page | None = None
        self._gen = 0
        self._lock = threading.Lock()
        self.on_msg(self._on_msg)

    # ── messages from JS ────────────────────────────────────────────

    def _on_msg(self, _widget: Any, content: dict, _buffers: Any) -> None:
        kind = content.get("type")
        if kind == "collections":
            self._run(self._reply_collections, content.get("req_id"))
        elif kind == "queryables":
            self._run(self._reply_queryables, content.get("req_id"), list(content.get("collections") or []))
        elif kind == "aoi_upload":
            self._reply_aoi_upload(content.get("req_id"), str(content.get("text") or ""))
        elif kind == "search":
            if isinstance(content.get("query"), dict):
                self.query = content["query"]
            try:
                self.search()
            except JstexError as err:
                self.error, self.status = str(err), "error"
        elif kind == "cancel":
            self.cancel()
        elif kind == "sync":
            self._send_page()  # a (re-)rendered view asks for the current results

    def _reply_collections(self, req_id: Any) -> None:
        self.auth_source = auth.current().source
        try:
            data = self._backend.list_collections()
        except JstexError as err:
            self.send({"type": "reply", "req_id": req_id, "ok": False, "error": str(err)})
            return
        self.send({"type": "reply", "req_id": req_id, "ok": True, "data": data})

    def _reply(self, req_id: Any, fn: Callable[[], Any]) -> None:
        try:
            data = fn()
        except JstexError as err:
            self.send({"type": "reply", "req_id": req_id, "ok": False, "error": str(err)})
            return
        self.send({"type": "reply", "req_id": req_id, "ok": True, "data": data})

    def _reply_queryables(self, req_id: Any, collections: list[str]) -> None:
        self._reply(req_id, lambda: self._backend.merged_queryables(collections))

    def _reply_aoi_upload(self, req_id: Any, text: str) -> None:
        # Validation only: the JS side replaces the AOI when this succeeds, so a
        # rejected file never changes the current area.
        self._reply(req_id, lambda: parse_aoi_upload(text))

    # ── search ──────────────────────────────────────────────────────

    def search(self, wait: bool = False) -> None:
        """Run the current ``query``. With ``wait=True`` block until results are in ``.results``."""
        state = QueryState.from_dict(self.query)
        to_search_body(state)  # validate now so Python callers get the error
        with self._lock:
            self._gen += 1
            gen = self._gen
        self.error, self.status = "", "searching"
        if wait:
            self._do_search(gen, state)
        else:
            self._run(self._do_search, gen, state)

    def cancel(self) -> None:
        """Drop the in-flight search; previous results stay."""
        with self._lock:
            self._gen += 1
        if self.status == "searching":
            self.status = "idle"

    def _is_current(self, gen: int) -> bool:
        with self._lock:
            return gen == self._gen

    def _do_search(self, gen: int, state: QueryState) -> None:
        try:
            page = self._backend.search_page(state)
        except JstexError as err:
            if self._is_current(gen):
                self.error, self.status = str(err), "error"
            return
        if not self._is_current(gen):
            return
        items: dict[str, dict] = {}
        for it in page.items:
            items.setdefault(it["id"], it)
        self._items, self._page = items, page
        self.selected_ids, self.active_id = [], None
        self._send_page()
        self.status = "idle"

    def _send_page(self) -> None:
        if self._page is not None:
            self.send({"type": "page", "items": list(self._items.values()), "matched": self._page.matched})

    # ── Python accessors ────────────────────────────────────────────

    @property
    def results(self) -> pystac.ItemCollection:
        return pystac.ItemCollection([pystac.Item.from_dict(d) for d in self._items.values()])

    @property
    def selected_items(self) -> list[pystac.Item]:
        return [pystac.Item.from_dict(self._items[i]) for i in self.selected_ids if i in self._items]

    @property
    def selected_item(self) -> pystac.Item | None:
        d = self._items.get(self.active_id or "")
        return pystac.Item.from_dict(d) if d else None

    def query_url(self) -> str:
        """STEX share URL for the current query (just ``q`` when JSTEX_STEX_URL is unset)."""
        return share_url(QueryState.from_dict(self.query), self._config.stex_url)
```

**If Task 2 recorded `THREAD_SEND_OK = no`:** change the line `DEFAULT_RUNNER: Runner = thread_runner` to `DEFAULT_RUNNER: Runner = sync_runner`. `can_cancel` then becomes `False` and the panel hides Cancel (Task 12). Nothing else changes.

`jstex/api.py`:

```python
"""Small public helpers used by snippets the widget copies to the clipboard."""

from __future__ import annotations

import pystac

from .config import load_config
from .stac import StacBackend


def item(href: str, *, stac_url: str | None = None) -> pystac.Item:
    """Open a STAC item by URL, sending the user's token (restricted collections work)."""
    return StacBackend(load_config(stac_url=stac_url).stac_url).read_item(href)
```

In `jstex/__init__.py`, replace the Task 2 lines `from .widget import Explorer` / `__all__ = …` with the block below, placed right after the template's `from .routes import setup_route_handlers` line (keep the template's `__version__` block and `_jupyter_*` hooks). The import must stay light: from Task 17 on, the Jupyter server imports `jstex` through the `jupyterlab.locale` entry point, and a failing/heavy import there disables *all* third-party translations.

```python
from typing import Any

__all__ = ["Explorer", "item", "__version__"]


def __getattr__(name: str) -> Any:
    if name == "Explorer":
        from .widget import Explorer

        return Explorer
    if name == "item":
        from .api import item

        return item
    raise AttributeError(f"module 'jstex' has no attribute {name!r}")
```

- [ ] **Step 4: Run tests**

Run: `pytest tests -q`
Expected: all PASS (verified while writing the plan: all tests with anywidget 0.11.0, ipywidgets 8.1.9 — widgets instantiate without a kernel).

- [ ] **Step 5: Commit**

```bash
ruff check jstex tests && ruff format jstex tests
git add jstex/widget.py jstex/api.py jstex/__init__.py tests/test_widget.py tests/test_api.py
git commit -m "feat: Explorer message protocol, threaded search with cancel, pystac accessors"
```

---

### Task 8: Front-end foundations — types, store, backend, model sync, actions, helpers

**Files:**
- Create: `js/types.ts`, `js/store.ts`, `js/backend.ts`, `js/model-sync.ts`, `js/filters.ts`, `js/actions.ts`, `js/format.ts`, `js/selection.ts`, `js/clipboard.ts`, `js/snippets.ts`, `js/theme.ts`, `js/icons.ts`, `js/i18n.ts`, `js/strings.ts`, `js/antimeridian.ts` (copied)
- Test: `js/__tests__/helpers.ts`, `js/__tests__/foundations.test.ts`, `js/__tests__/filters.test.ts`, `js/__tests__/i18n.test.ts`, `js/__tests__/antimeridian.test.ts` (copied)

**Interfaces:**
- Consumes: the Python protocol from Task 7 (trait names, message shapes).
- Produces (used by Tasks 9–15 — exact names):
  - `types.ts`: `AoiGeometry`, `Aoi`, `FilterOp`, `FilterPredicate`, `FilterField`, `FilterRow`, `DrawMode`, `SectionId`, `QueryStateDict`, `StacLink`, `StacAsset`, `StacItem`, `CollectionSummary` (with `description`, `license`, `start`, `end`), `Status`, `BasemapSource`, `BasemapConfig`, `AuthSource`, `ExplorerState` (incl. `drawMode`, `aoiError`, `zoomToAoi`, `fields`, `fieldsLoading`, `fieldsError`, `filterRows`, `panelCollapsed`, `sections`, `basemap`, `dark`), `PageMessage`, `MinimalModel`.
  - `store.ts`: `Store<T>`, `createStore<T>(initial)`.
  - `backend.ts`: `Backend { listCollections(); queryables(collections); uploadAoi(text); search(query); cancel(); sync(); dispose() }`, `BackendEvents { onPage(msg) }`, `CommBackend(model, events)`.
  - `model-sync.ts`: `DEFAULT_QUERY`, `stateFromModel(model)`, `bindModel(model, store) -> unbind`, `applyPage(store, msg)`.
  - `filters.ts`: `operatorsFor(type)`, `parseValue(raw, field, op)`, `validate(pred, field, S)`, `commitRows(rows, fields, S) -> {rows, filters}`, `rowsFromFilters(filters, nextId)`, `filterSummary(filters, fields)`.
  - `actions.ts`: `Actions { setQuery, setAoi, setDrawMode, uploadAoi, zoomToAoi, loadFields, addFilterRow, updateFilterRow, removeFilterRow, toggleSection, setPanelCollapsed, search, cancel, dismissError, activate, toggleSelected }`, `createActions(model, store, backend, S)`.
  - `format.ts`: `escapeHtml`, `shortId`, `formatIso`, `formatItemDate`, `formatValue`, `cloudCover`, `Bbox`, `geometryBbox`, `unionBbox`, `boxAreaKm2`, `geometryAreaKm2`, `formatBbox`, `formatArea`, `dateInputToIso`, `isoToDateInput`, `bboxTo3857`, `itemFeatures`, `selfHref`.
  - `selection.ts`: `neighbour`, `toggleId`, `scrollWithin`.
  - `clipboard.ts`: `copyText`. `snippets.ts`: `pythonItemSnippet`. `icons.ts`: `ICON` (search, polygon, box, upload, target, close, chevrons, info, warn, layers, calendar, filter, plus). `theme.ts`: `isDark`, `watchTheme(onChange) -> stop`, `DEFAULT_BASEMAP`, `basemapLayer(basemap, dark)`.
  - `i18n.ts`: `TranslationBundle`, `SharedI18n`, `I18N_KEY` (= `Symbol.for('jstex.i18n')`), `strfmt`, `englishBundle`, `getTranslation()`, `languageCode()`. `strings.ts`: `createStrings(trans)`, `Strings`, `S` (built from `getTranslation()` when the bundle is evaluated).

- [ ] **Step 1: Copy the antimeridian module and its tests from STEX** (pure, no imports):

```bash
STEX=/home/eouser/code/stex
{ printf '/**\n * Copied from STEX src/utils/antimeridian.ts @ %s — keep in sync by hand.\n */\n' "$(git -C $STEX rev-parse --short HEAD)"; cat $STEX/src/utils/antimeridian.ts; } > js/antimeridian.ts
mkdir -p js/__tests__
sed "s#'../../src/utils/antimeridian.js'#'../antimeridian'#" $STEX/tests/unit/antimeridian.test.ts > js/__tests__/antimeridian.test.ts
```

- [ ] **Step 2: Write the failing tests.**

`js/__tests__/helpers.ts`:

```ts
import { vi } from 'vitest';
import { createActions } from '../actions';
import { stateFromModel } from '../model-sync';
import { createStore } from '../store';
import { S } from '../strings';
import type { AoiGeometry, FilterField, MinimalModel, StacItem } from '../types';

export class FakeModel implements MinimalModel {
  values: Record<string, unknown>;
  sent: unknown[] = [];
  saves = 0;
  private handlers = new Map<string, Set<(...args: any[]) => void>>();

  constructor(values: Record<string, unknown> = {}) {
    this.values = { ...values };
  }
  get(key: string) {
    return this.values[key];
  }
  set(key: string, value: unknown) {
    this.values[key] = value;
  }
  save_changes() {
    this.saves++;
  }
  on(event: string, cb: (...args: any[]) => void) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(cb);
  }
  off(event?: string | null, cb?: ((...args: any[]) => void) | null) {
    if (event && cb) this.handlers.get(event)?.delete(cb);
  }
  send(content: unknown) {
    this.sent.push(content);
  }
  /** Simulate Python: a custom message or a trait change. */
  emit(event: string, ...args: unknown[]) {
    this.handlers.get(event)?.forEach((cb) => cb(...args));
  }
  pyset(key: string, value: unknown) {
    this.values[key] = value;
    this.emit(`change:${key}`);
  }
}

export function item(id: string, extra: Partial<StacItem> = {}): StacItem {
  return {
    id,
    collection: 'sentinel-2-l2a',
    geometry: { type: 'Polygon', coordinates: [[[10, 45], [11, 45], [11, 46], [10, 46], [10, 45]]] },
    properties: { datetime: '2024-07-12T10:30:41.024Z', 'eo:cloud_cover': 4.12 },
    assets: { B04: { href: `s3://eodata/${id}/B04.jp2`, type: 'image/jp2', title: 'Red', roles: ['data'] } },
    links: [{ rel: 'self', href: `https://stac.test/v1/collections/sentinel-2-l2a/items/${id}` }],
    ...extra,
  };
}

/** A detached view container, a fresh store, the REAL actions and a fake backend. */
export function setupView(values: Record<string, unknown> = {}) {
  document.body.innerHTML = '';
  const el = document.createElement('div');
  document.body.appendChild(el);
  const model = new FakeModel(values);
  const store = createStore(stateFromModel(model));
  const backend = {
    listCollections: vi.fn(async () => []),
    queryables: vi.fn(async (_c: string[]): Promise<FilterField[]> => FIELDS),
    uploadAoi: vi.fn(async (_t: string): Promise<AoiGeometry> => BOX),
    search: vi.fn(),
    cancel: vi.fn(),
    sync: vi.fn(),
    dispose: vi.fn(),
  };
  const actions = createActions(model, store, backend, S);
  // Pass-through spies: real behaviour, but tests can assert on calls.
  for (const key of Object.keys(actions) as (keyof typeof actions)[]) vi.spyOn(actions, key);
  return { el, store, actions, backend, model };
}

export const BOX: GeoJSON.Polygon = { type: 'Polygon', coordinates: [[[10, 45], [11, 45], [11, 46], [10, 46], [10, 45]]] };

export const FIELDS: FilterField[] = [
  { name: 'eo:cloud_cover', title: 'Cloud cover', type: 'number', minimum: 0, maximum: 100 },
  { name: 'platform', title: 'Platform', type: 'string', enum: ['sentinel-2a', 'sentinel-2b'] },
  { name: 'sat:relative_orbit', title: 'Relative orbit', type: 'integer' },
  { name: 'eopf:instrument_mode', title: 'Instrument mode', type: 'string' },
];

export const flush = () => new Promise((r) => setTimeout(r, 0));

export const byRef = (el: HTMLElement, ref: string) => el.querySelector(`[data-ref="${ref}"]`) as HTMLElement;
```

`js/__tests__/foundations.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { CommBackend } from '../backend';
import {
  boxAreaKm2, bboxTo3857, dateInputToIso, formatItemDate, formatIso, formatValue, geometryAreaKm2, geometryBbox,
  itemFeatures, shortId, unionBbox,
} from '../format';
import { applyPage, bindModel, stateFromModel } from '../model-sync';
import { neighbour, scrollWithin, toggleId } from '../selection';
import { pythonItemSnippet } from '../snippets';
import { createStore } from '../store';
import { basemapLayer, DEFAULT_BASEMAP, isDark, watchTheme } from '../theme';
import { BOX, FakeModel, FIELDS, item, setupView } from './helpers';

describe('store', () => {
  it('notifies subscribers with state and prev; unsubscribe stops it', () => {
    const s = createStore({ a: 1, b: 2 });
    const seen: Array<[number, number]> = [];
    const off = s.subscribe((st, prev) => seen.push([st.a, prev.a]));
    s.set({ a: 5 });
    off();
    s.set({ a: 6 });
    expect(seen).toEqual([[5, 1]]);
    expect(s.get()).toEqual({ a: 6, b: 2 });
  });
});

describe('CommBackend', () => {
  it('correlates replies by req_id', async () => {
    const m = new FakeModel();
    const b = new CommBackend(m, { onPage: vi.fn() });
    const p1 = b.listCollections();
    const p2 = b.listCollections();
    expect(m.sent).toEqual([{ type: 'collections', req_id: 1 }, { type: 'collections', req_id: 2 }]);
    m.emit('msg:custom', { type: 'reply', req_id: 2, ok: false, error: 'nope' });
    m.emit('msg:custom', { type: 'reply', req_id: 1, ok: true, data: [{ id: 'c', title: 'C' }] });
    await expect(p1).resolves.toEqual([{ id: 'c', title: 'C' }]);
    await expect(p2).rejects.toThrow('nope');
  });

  it('routes pages and sends search/cancel/sync', () => {
    const m = new FakeModel();
    const onPage = vi.fn();
    const b = new CommBackend(m, { onPage });
    m.emit('msg:custom', { type: 'page', items: [], matched: 0 });
    expect(onPage).toHaveBeenCalledOnce();
    b.search({ collections: ['c'] } as never);
    b.cancel();
    b.sync();
    expect(m.sent.map((x) => (x as { type: string }).type)).toEqual(['search', 'cancel', 'sync']);
  });

  it('dispose rejects pending requests and stops listening', async () => {
    const m = new FakeModel();
    const onPage = vi.fn();
    const b = new CommBackend(m, { onPage });
    const p = b.listCollections();
    b.dispose();
    await expect(p).rejects.toThrow('disposed');
    m.emit('msg:custom', { type: 'page', items: [], matched: 0 });
    expect(onPage).not.toHaveBeenCalled();
  });
});

describe('model sync', () => {
  it('stateFromModel restores query and selection but no items (re-rendered view)', () => {
    const m = new FakeModel({
      query: { collections: ['c1'], datetime: { from: '2024-01-01T00:00:00Z' } },
      selected_ids: ['a'],
      active_id: 'a',
      status: 'idle',
      auth_source: 'hub',
      can_cancel: true,
      map_height: 300,
    });
    const s = stateFromModel(m);
    expect(s.query.collections).toEqual(['c1']);
    expect(s.query.aois).toEqual([]);
    expect(s.query.pageSize).toBe(50);
    expect(s.items).toEqual([]);
    expect(s.searched).toBe(false);
    expect([s.activeId, s.authSource, s.mapHeight]).toEqual(['a', 'hub', 300]);
  });

  it('stateFromModel tolerates an empty model', () => {
    const s = stateFromModel(new FakeModel());
    expect(s.status).toBe('idle');
    expect(s.activeId).toBeNull();
    expect(s.canCancel).toBe(true);
  });

  it('bindModel mirrors Python trait changes', () => {
    const m = new FakeModel({ query: {} });
    const store = createStore(stateFromModel(m));
    const unbind = bindModel(m, store);
    m.pyset('status', 'searching');
    m.pyset('active_id', null);
    m.pyset('query', { collections: ['x'] });
    expect(store.get().status).toBe('searching');
    expect(store.get().activeId).toBeNull();
    expect(store.get().query.collections).toEqual(['x']);
    expect(store.get().query.sort.direction).toBe('desc');
    unbind();
    m.pyset('status', 'error');
    expect(store.get().status).toBe('searching');
  });

  it('applyPage keeps only selection that is still loaded', () => {
    const store = createStore(stateFromModel(new FakeModel()));
    store.set({ selectedIds: ['a', 'gone'], activeId: 'gone' });
    applyPage(store, { type: 'page', items: [item('a'), item('b')], matched: 9 });
    expect(store.get().selectedIds).toEqual(['a']);
    expect(store.get().activeId).toBeNull();
    expect(store.get().matched).toBe(9);
    expect(store.get().searched).toBe(true);
  });
});

describe('actions', () => {
  it('push query, selection, active id and panel state to the model', () => {
    const { model: m, store, actions: a, backend } = setupView({ query: {} });
    a.setQuery({ collections: ['c1'] });
    a.setAoi(BOX);
    a.toggleSelected('x');
    a.activate('x');
    a.setPanelCollapsed(true);
    expect((m.values.query as { collections: string[] }).collections).toEqual(['c1']);
    expect((m.values.query as { aois: unknown[] }).aois).toHaveLength(1);
    expect(m.values.selected_ids).toEqual(['x']);
    expect(m.values.active_id).toBe('x');
    expect(m.values.panel_collapsed).toBe(true);
    a.setAoi(null);
    expect(store.get().query.aois).toEqual([]);
    store.set({ error: 'old', drawMode: 'Box' });
    a.search();
    expect(store.get().error).toBe('');
    expect(store.get().drawMode).toBeNull();
    expect(backend.search).toHaveBeenCalledWith(store.get().query);
  });

  it('a new area replaces the old one and ends drawing', () => {
    const { store, actions: a } = setupView();
    a.setDrawMode('Polygon');
    a.setAoi(BOX);
    a.setAoi({ ...BOX, coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] });
    expect(store.get().query.aois).toHaveLength(1);
    expect(store.get().drawMode).toBeNull();
  });

  it('uploadAoi sets and zooms to the area, or reports the file error and keeps the old area', async () => {
    const { store, actions: a, backend } = setupView();
    await a.uploadAoi(new File(['{}'], 'area.geojson'));
    expect(store.get().query.aois[0].geometry).toEqual(BOX);
    expect(store.get().zoomToAoi).toBe(1);
    backend.uploadAoi.mockRejectedValueOnce(new Error('Only EPSG:4326 (WGS84 lon/lat) supported.'));
    await a.uploadAoi(new File(['{}'], 'utm.geojson'));
    expect(store.get().aoiError).toBe('utm.geojson: Only EPSG:4326 (WGS84 lon/lat) supported. The previous area is unchanged.');
    expect(store.get().query.aois[0].geometry).toEqual(BOX);
  });

  it('filter rows: valid rows become query filters, invalid rows get an error, empty rows are ignored', async () => {
    const { store, actions: a } = setupView();
    a.setQuery({ collections: ['c1'] });
    await a.loadFields();
    a.addFilterRow();
    a.addFilterRow();
    const [r1, r2] = store.get().filterRows;
    a.updateFilterRow(r1.id, { field: 'eo:cloud_cover', op: '<=', value: '20' });
    a.updateFilterRow(r2.id, { field: 'sat:relative_orbit', op: '>=', value: 'abc' });
    expect(store.get().query.filters).toEqual([{ field: 'eo:cloud_cover', op: '<=', value: 20 }]);
    expect(store.get().filterRows[1].error).toBe('Enter a number.');
    a.updateFilterRow(r2.id, { value: '' });
    expect(store.get().filterRows[1].error).toBe('');
    a.removeFilterRow(r1.id);
    expect(store.get().query.filters).toEqual([]);
  });

  it('loadFields ignores a stale answer when the selection changed meanwhile', async () => {
    const { store, actions: a, backend } = setupView();
    let release!: (f: typeof FIELDS) => void;
    backend.queryables.mockImplementationOnce(() => new Promise((r) => (release = r)));
    a.setQuery({ collections: ['slow'] });
    const first = a.loadFields();
    a.setQuery({ collections: ['fast'] });
    await a.loadFields();
    release([FIELDS[0]]);
    await first;
    expect(store.get().fields).toEqual(FIELDS);
  });

  it('rows for fields that vanish after a collection change are flagged', async () => {
    const { store, actions: a, backend } = setupView();
    a.setQuery({ collections: ['c1'] });
    await a.loadFields();
    a.addFilterRow();
    a.updateFilterRow(store.get().filterRows[0].id, { field: 'platform', value: 'sentinel-2a' });
    backend.queryables.mockResolvedValueOnce([FIELDS[0]]);
    a.setQuery({ collections: ['c1', 'c2'] });
    await a.loadFields();
    expect(store.get().filterRows[0].error).toBe('Not available for the selected collections.');
    expect(store.get().query.filters).toEqual([]);
  });
});

describe('format', () => {
  it('shortId keeps start and end', () => {
    const id = 'S2B_MSIL2A_20240712T103031_N0510_R108_T32TPS_20240712T134417';
    expect(shortId(id)).toBe('S2B_MSIL2A_20240712T103…40712T134417');
    expect(shortId(id).length).toBe(36);
    expect(shortId('short')).toBe('short');
  });

  it('formatItemDate handles datetime, ranges and missing values', () => {
    expect(formatItemDate(item('a'))).toBe('2024-07-12 10:30Z');
    expect(
      formatItemDate(item('m', { properties: { datetime: null, start_datetime: '2021-01-01T00:00:00Z', end_datetime: '2021-12-31T23:59:59Z' } })),
    ).toBe('2021-01-01 – 2021-12-31');
    expect(formatItemDate(item('n', { properties: {} }))).toBe('—');
    expect(formatIso('not a date')).toBe('not a date');
  });

  it('formatValue stringifies objects compactly', () => {
    expect(formatValue({ a: [1, 2] })).toBe('{"a":[1,2]}');
    expect(formatValue(null)).toBe('null');
    expect(formatValue(3.5)).toBe('3.5');
  });

  it('bbox, area and projection', () => {
    const b = geometryBbox({ type: 'Polygon', coordinates: [[[10, 45], [11, 45], [11, 46], [10, 45]]] })!;
    expect(b).toEqual([10, 45, 11, 46]);
    expect(Math.round(boxAreaKm2(b))).toBe(8666);
    expect(geometryBbox(null)).toBeNull();
    expect(unionBbox([b, null, [0, 0, 1, 1]])).toEqual([0, 0, 11, 46]);
    const ext = bboxTo3857([0, 0, 1, 1], 0);
    expect(ext[0]).toBeCloseTo(0);
    expect(ext[2]).toBeCloseTo(111319.49, 1);
  });

  it('geometryAreaKm2 matches the exact box area and subtracts holes', () => {
    expect(Math.round(geometryAreaKm2(BOX))).toBe(Math.round(boxAreaKm2([10, 45, 11, 46])));
    const withHole: GeoJSON.Polygon = {
      type: 'Polygon',
      coordinates: [BOX.coordinates[0], [[10.25, 45.25], [10.75, 45.25], [10.75, 45.75], [10.25, 45.75], [10.25, 45.25]]],
    };
    expect(geometryAreaKm2(withHole)).toBeLessThan(geometryAreaKm2(BOX) * 0.8);
    const multi: GeoJSON.MultiPolygon = { type: 'MultiPolygon', coordinates: [BOX.coordinates, BOX.coordinates] };
    expect(Math.round(geometryAreaKm2(multi))).toBe(Math.round(2 * geometryAreaKm2(BOX)));
  });

  it('dateInputToIso', () => {
    expect(dateInputToIso('2024-07-01', false)).toBe('2024-07-01T00:00:00Z');
    expect(dateInputToIso('2024-07-01', true)).toBe('2024-07-01T23:59:59Z');
    expect(dateInputToIso('', true)).toBeUndefined();
  });

  it('itemFeatures skips null geometries', () => {
    const f = itemFeatures([item('a'), item('b', { geometry: null })]);
    expect(f.map((x) => x.id)).toEqual(['a']);
  });
});

describe('selection', () => {
  it('neighbour stops at the ends', () => {
    const items = [item('a'), item('b')];
    expect(neighbour(items, 'a', 1)).toBe('b');
    expect(neighbour(items, 'b', 1)).toBeNull();
    expect(neighbour(items, 'a', -1)).toBeNull();
    expect(neighbour(items, null, 1)).toBe('a');
    expect(neighbour([], null, 1)).toBeNull();
  });

  it('toggleId', () => {
    expect(toggleId(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleId(['a', 'b'], 'a')).toEqual(['b']);
  });

  it('scrollWithin moves only the container', () => {
    const c = document.createElement('div');
    const r = document.createElement('tr');
    c.scrollTop = 100;
    c.getBoundingClientRect = () => ({ top: 0, bottom: 200 }) as DOMRect;
    r.getBoundingClientRect = () => ({ top: 250, bottom: 280 }) as DOMRect;
    scrollWithin(c, r);
    expect(c.scrollTop).toBe(180);
    r.getBoundingClientRect = () => ({ top: 10, bottom: 40 }) as DOMRect;
    scrollWithin(c, r, 30);
    expect(c.scrollTop).toBe(160);
  });
});

describe('snippets and theme', () => {
  it('python snippet is valid literal', () => {
    expect(pythonItemSnippet('https://x/items/a"b')).toBe('import jstex\n\nitem = jstex.item("https://x/items/a\\"b")');
  });

  it('isDark follows JupyterLab, then VS Code, then Colab', () => {
    document.body.dataset.jpThemeLight = 'false';
    expect(isDark()).toBe(true);
    document.body.dataset.jpThemeLight = 'true';
    expect(isDark()).toBe(false);
    delete document.body.dataset.jpThemeLight;
    document.body.classList.add('vscode-dark');
    expect(isDark()).toBe(true);
    document.body.classList.remove('vscode-dark');
    document.body.classList.add('vscode-light');
    expect(isDark()).toBe(false);
    document.body.classList.remove('vscode-light');
    document.documentElement.setAttribute('theme', 'dark');
    expect(isDark()).toBe(true);
    document.documentElement.removeAttribute('theme');
  });

  it('watchTheme fires when JupyterLab switches theme', async () => {
    let calls = 0;
    const stop = watchTheme(() => calls++);
    document.body.dataset.jpThemeLight = 'false';
    await Promise.resolve();
    stop();
    document.body.dataset.jpThemeLight = 'true';
    await Promise.resolve();
    expect(calls).toBe(1);
    delete document.body.dataset.jpThemeLight;
  });

  it('basemapLayer picks the themed source', () => {
    const cfg = { light: { url: 'L/{z}/{x}/{y}', attribution: 'a' }, dark: { url: 'D/{z}/{x}/{y}', attribution: 'b' } };
    expect(basemapLayer(cfg, true).source).toEqual({ type: 'XYZ', url: 'D/{z}/{x}/{y}', attributions: 'b' });
    expect((basemapLayer(cfg, false).source as { url: string }).url).toBe('L/{z}/{x}/{y}');
  });

  it('stateFromModel falls back to the STEX default basemaps', () => {
    expect(stateFromModel(new FakeModel()).basemap).toEqual(DEFAULT_BASEMAP);
    const custom = stateFromModel(
      new FakeModel({ basemap: { light: { url: 'L', attribution: '' }, dark: { url: 'D', attribution: '' } } }),
    );
    expect(custom.basemap.dark.url).toBe('D');
  });
});
```

`js/__tests__/i18n.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { englishBundle, getTranslation, I18N_KEY, languageCode, strfmt } from '../i18n';
import { createStrings } from '../strings';

afterEach(() => {
  delete (globalThis as Record<symbol, unknown>)[I18N_KEY];
});

describe('i18n', () => {
  it('strfmt fills %1..%n like JupyterLab', () => {
    expect(strfmt('%1 of %2', 3, 9)).toBe('3 of 9');
    expect(strfmt('%1 and %3', 'a')).toBe('a and %3');
  });

  it('falls back to English outside JupyterLab', () => {
    expect(getTranslation()).toBe(englishBundle);
    expect(languageCode()).toBe('en');
    expect(englishBundle._n('%1 item', '%1 items', 2, 2)).toBe('2 items');
  });

  it('uses the bundle published by the labextension', () => {
    const bundle = {
      __: (m: string, ...a: unknown[]) => strfmt(m === 'Search' ? 'Suchen' : m, ...a),
      _n: englishBundle._n,
      _p: englishBundle._p,
    };
    (globalThis as Record<symbol, unknown>)[I18N_KEY] = { languageCode: 'de-DE', bundle };
    expect(languageCode()).toBe('de-DE');
    const S = createStrings(getTranslation());
    expect(S.search).toBe('Suchen');
    expect(S.collectionsCount(3, 214)).toBe('3 of 214');
    expect(S.loaded(1)).toBe('1 loaded');
  });
});
```

`js/__tests__/filters.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { commitRows, filterSummary, operatorsFor, parseValue, rowsFromFilters, validate } from '../filters';
import { S } from '../strings';
import { FIELDS } from './helpers';

const [cloud, platform, orbit, mode] = FIELDS;

describe('filter logic (ported from STEX filter-validation)', () => {
  it('operators depend on the field type', () => {
    expect(operatorsFor('number')).toEqual(['=', '!=', '<', '<=', '>', '>=']);
    expect(operatorsFor('integer')).toEqual(['=', '!=', '<', '<=', '>', '>=']);
    expect(operatorsFor('string')).toEqual(['=', '!=', 'IN']);
    expect(operatorsFor('boolean')).toEqual(['=', '!=']);
  });

  it('parses raw text by type; IN is a comma list', () => {
    expect(parseValue('12.5', cloud, '<=')).toBe(12.5);
    expect(parseValue('abc', cloud, '<=')).toBe('abc');
    expect(parseValue(' a, b ,,c', mode, 'IN')).toEqual(['a', 'b', 'c']);
    expect(parseValue('TRUE', { name: 'x', title: 'X', type: 'boolean' }, '=')).toBe(true);
  });

  it('validates numbers, bounds, integers, enums and IN', () => {
    expect(validate({ field: 'eo:cloud_cover', op: '<=', value: 20 }, cloud, S)).toBe('');
    expect(validate({ field: 'eo:cloud_cover', op: '<=', value: 'x' }, cloud, S)).toBe('Enter a number.');
    expect(validate({ field: 'eo:cloud_cover', op: '<=', value: 120 }, cloud, S)).toBe('Must be at most 100.');
    expect(validate({ field: 'eo:cloud_cover', op: '>=', value: -1 }, cloud, S)).toBe('Must be at least 0.');
    expect(validate({ field: 'sat:relative_orbit', op: '=', value: 1.5 }, orbit, S)).toBe('Enter a whole number.');
    expect(validate({ field: 'platform', op: '=', value: 'landsat' }, platform, S)).toBe('Choose one of the listed values.');
    expect(validate({ field: 'platform', op: '<=', value: 'x' }, platform, S)).toBe('<= is not allowed for Platform.');
    expect(validate({ field: 'platform', op: 'IN', value: [] }, platform, S)).toBe('Enter one or more values, comma-separated.');
  });

  it('commitRows returns valid predicates and flags the rest', () => {
    const rows = [
      { id: 1, field: 'eo:cloud_cover', op: '<=' as const, value: '10', error: '' },
      { id: 2, field: 'platform', op: 'IN' as const, value: 'sentinel-2a, sentinel-2b', error: '' },
      { id: 3, field: 'sat:relative_orbit', op: '=' as const, value: '', error: 'old' },
      { id: 4, field: 'gone', op: '=' as const, value: 'x', error: '' },
    ];
    const { rows: out, filters } = commitRows(rows, FIELDS, S);
    expect(filters).toEqual([
      { field: 'eo:cloud_cover', op: '<=', value: 10 },
      { field: 'platform', op: 'IN', value: ['sentinel-2a', 'sentinel-2b'] },
    ]);
    expect(out.map((r) => r.error)).toEqual(['', '', '', 'Not available for the selected collections.']);
    // before the fields have loaded, unknown fields are not (yet) an error
    expect(commitRows(rows, [], S).rows[3].error).toBe('');
  });

  it('round-trips filters restored from a query and summarises them', () => {
    let n = 0;
    const rows = rowsFromFilters([{ field: 'platform', op: 'IN', value: ['a', 'b'] }], () => ++n);
    expect(rows).toEqual([{ id: 1, field: 'platform', op: 'IN', value: 'a, b', error: '' }]);
    expect(filterSummary([{ field: 'eo:cloud_cover', op: '<=', value: 20 }], FIELDS)).toBe('Cloud cover <= 20');
  });
});
```

- [ ] **Step 3: Run to confirm failure**

Run: `jlpm vitest run js/__tests__/foundations.test.ts`
Expected: FAIL — `Failed to resolve import "../actions"`.

- [ ] **Step 4: Implement the modules.**

`js/types.ts`:

```ts
/** Shared front-end types. Mirrors the Python widget protocol (jstex/widget.py). */

export type AoiGeometry = GeoJSON.Polygon | GeoJSON.MultiPolygon;

export interface Aoi {
  geometry: AoiGeometry;
  selected: boolean;
}

export type FilterOp = '=' | '!=' | '<' | '<=' | '>' | '>=' | 'IN';

/** A committed attribute filter (the QueryState / ?q= form). */
export interface FilterPredicate {
  field: string;
  op: FilterOp;
  value: unknown;
}

/** A filterable field, from StacBackend.merged_queryables(). */
export interface FilterField {
  name: string;
  title: string;
  type: 'string' | 'number' | 'integer' | 'boolean';
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
}

/** An editable row of the filter builder (UI state; raw text value). */
export interface FilterRow {
  id: number;
  field: string;
  op: FilterOp;
  value: string;
  error: string;
}

export type DrawMode = 'Polygon' | 'Box';
export type SectionId = 'collections' | 'dates' | 'aoi' | 'filters';

/** QueryState dict form — identical keys to jstex.query.QueryState.to_dict(). */
export interface QueryStateDict {
  collections: string[];
  datetime: { from?: string; to?: string } | null;
  aois: Aoi[];
  filters: FilterPredicate[];
  sort: { field: string; direction: 'asc' | 'desc' };
  pageSize: number;
}

export interface StacLink {
  rel: string;
  href: string;
  type?: string;
  title?: string;
}

export interface StacAsset {
  href: string;
  title?: string;
  type?: string;
  roles?: string[];
  alternate?: Record<string, { href?: string }>;
  [key: string]: unknown;
}

export interface StacItem {
  id: string;
  collection?: string;
  geometry: GeoJSON.Geometry | null;
  bbox?: number[];
  properties: Record<string, unknown>;
  assets: Record<string, StacAsset>;
  links: StacLink[];
}

export interface CollectionSummary {
  id: string;
  title: string;
  description?: string;
  license?: string;
  start?: string | null;
  end?: string | null;
}

export type Status = 'idle' | 'searching' | 'error';

/** One XYZ basemap, key and retina already applied by Python (jstex.config.Basemap). */
export interface BasemapSource {
  url: string;
  attribution: string;
}

/** Deployment basemaps (JSTEX_BASEMAP_{LIGHT,DARK}_* env vars). */
export interface BasemapConfig {
  light: BasemapSource;
  dark: BasemapSource;
}
export type AuthSource = 'hub' | 'env' | 'anonymous';

export interface ExplorerState {
  collections: CollectionSummary[];
  collectionsLoading: boolean;
  collectionsError: string;
  query: QueryStateDict;
  items: StacItem[];
  matched: number | null;
  searched: boolean;
  selectedIds: string[];
  activeId: string | null;
  status: Status;
  error: string;
  authSource: AuthSource;
  canCancel: boolean;
  mapHeight: number;
  basemap: BasemapConfig;
  dark: boolean;
  /** Active draw tool, or null. One AOI only: finishing a drawing replaces it. */
  drawMode: DrawMode | null;
  aoiError: string;
  /** Bumped to ask the map to zoom to the AOI. */
  zoomToAoi: number;
  fields: FilterField[];
  fieldsLoading: boolean;
  fieldsError: string;
  filterRows: FilterRow[];
  panelCollapsed: boolean;
  sections: Record<SectionId, boolean>;
}

export interface PageMessage {
  type: 'page';
  items: StacItem[];
  matched: number | null;
}

/** The subset of the anywidget model API jstex uses (keeps tests free of anywidget). */
export interface MinimalModel {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  save_changes(): void;
  on(event: string, cb: (...args: any[]) => void): void;
  off(event?: string | null, cb?: ((...args: any[]) => void) | null): void;
  send(content: unknown): void;
}
```

`js/store.ts`:

```ts
/** Minimal per-instance observable store (one per rendered widget view). */

export interface Store<T> {
  get(): T;
  set(patch: Partial<T>): void;
  subscribe(fn: (state: T, prev: T) => void): () => void;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const subscribers = new Set<(state: T, prev: T) => void>();
  return {
    get: () => state,
    set(patch) {
      const prev = state;
      state = { ...state, ...patch };
      subscribers.forEach((fn) => fn(state, prev));
    },
    subscribe(fn) {
      subscribers.add(fn);
      return () => {
        subscribers.delete(fn);
      };
    },
  };
}
```

`js/backend.ts`:

```ts
/**
 * Backend interface the views talk to. Stage 1 has one implementation,
 * CommBackend (anywidget custom messages to the kernel); stage 3 adds a REST
 * backend for the JupyterLab panel. Search is push-based: results arrive via
 * `onPage`, so searches started from Python (`ex.search()`) render too.
 */
import type { AoiGeometry, CollectionSummary, FilterField, MinimalModel, PageMessage, QueryStateDict } from './types';

export interface Backend {
  listCollections(): Promise<CollectionSummary[]>;
  /** Filterable fields shared by all given collections. */
  queryables(collections: string[]): Promise<FilterField[]>;
  /** Validate an uploaded GeoJSON text; resolves to one Polygon/MultiPolygon. */
  uploadAoi(text: string): Promise<AoiGeometry>;
  search(query: QueryStateDict): void;
  cancel(): void;
  sync(): void;
  dispose(): void;
}

export interface BackendEvents {
  onPage(msg: PageMessage): void;
}

interface Pending {
  resolve(data: unknown): void;
  reject(err: Error): void;
}

export class CommBackend implements Backend {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly handler = (msg: unknown) => this.onMessage(msg);

  constructor(
    private readonly model: MinimalModel,
    private readonly events: BackendEvents,
  ) {
    model.on('msg:custom', this.handler);
  }

  private request<T>(type: string, payload: Record<string, unknown> = {}): Promise<T> {
    const req_id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(req_id, { resolve: (d) => resolve(d as T), reject });
      this.model.send({ type, req_id, ...payload });
    });
  }

  listCollections(): Promise<CollectionSummary[]> {
    return this.request('collections');
  }

  queryables(collections: string[]): Promise<FilterField[]> {
    return this.request('queryables', { collections });
  }

  uploadAoi(text: string): Promise<AoiGeometry> {
    return this.request('aoi_upload', { text });
  }

  search(query: QueryStateDict): void {
    this.model.send({ type: 'search', query });
  }

  cancel(): void {
    this.model.send({ type: 'cancel' });
  }

  sync(): void {
    this.model.send({ type: 'sync' });
  }

  dispose(): void {
    this.model.off('msg:custom', this.handler);
    this.pending.forEach((p) => p.reject(new Error('disposed')));
    this.pending.clear();
  }

  private onMessage(raw: unknown): void {
    const msg = raw as { type?: string; req_id?: number; ok?: boolean; data?: unknown; error?: string };
    if (msg.type === 'reply' && typeof msg.req_id === 'number') {
      const p = this.pending.get(msg.req_id);
      if (!p) return;
      this.pending.delete(msg.req_id);
      if (msg.ok) p.resolve(msg.data);
      else p.reject(new Error(msg.error || 'Request failed'));
    } else if (msg.type === 'page') {
      this.events.onPage(raw as PageMessage);
    }
  }
}
```

`js/model-sync.ts`:

```ts
/** Model (Python traitlets) <-> per-instance store. */
import type { Store } from './store';
import { rowsFromFilters } from './filters';
import { DEFAULT_BASEMAP } from './theme';
import type { BasemapConfig, ExplorerState, MinimalModel, PageMessage, QueryStateDict } from './types';

export const DEFAULT_QUERY: QueryStateDict = {
  collections: [],
  datetime: null,
  aois: [],
  filters: [],
  sort: { field: 'properties.datetime', direction: 'desc' },
  pageSize: 50,
};

/** Initial state for a fresh view. Items are NOT in the model — they arrive via `sync`. */
export function stateFromModel(model: MinimalModel): ExplorerState {
  const query = (model.get('query') as Partial<QueryStateDict> | null) ?? {};
  let rowId = 0;
  return {
    collections: [],
    collectionsLoading: true,
    collectionsError: '',
    query: { ...DEFAULT_QUERY, ...query },
    items: [],
    matched: null,
    searched: false,
    selectedIds: (model.get('selected_ids') as string[] | null) ?? [],
    activeId: (model.get('active_id') as string | null) ?? null,
    status: ((model.get('status') as ExplorerState['status']) || 'idle') as ExplorerState['status'],
    error: (model.get('error') as string) || '',
    authSource: ((model.get('auth_source') as ExplorerState['authSource']) || 'anonymous'),
    canCancel: model.get('can_cancel') !== false,
    mapHeight: (model.get('map_height') as number) || 600,
    basemap: { ...DEFAULT_BASEMAP, ...((model.get('basemap') as Partial<BasemapConfig> | null) ?? {}) },
    dark: false, // set from the host theme by widget.ts
    drawMode: null,
    aoiError: '',
    zoomToAoi: 0,
    fields: [],
    fieldsLoading: false,
    fieldsError: '',
    filterRows: rowsFromFilters(query.filters ?? [], () => ++rowId),
    panelCollapsed: model.get('panel_collapsed') === true,
    sections: { collections: true, dates: true, aoi: true, filters: true },
  };
}

const TRAITS: Array<[string, keyof ExplorerState]> = [
  ['query', 'query'],
  ['selected_ids', 'selectedIds'],
  ['active_id', 'activeId'],
  ['status', 'status'],
  ['error', 'error'],
  ['auth_source', 'authSource'],
  ['can_cancel', 'canCancel'],
  ['map_height', 'mapHeight'],
  ['panel_collapsed', 'panelCollapsed'],
];

/** Mirror trait changes made in Python into the store. Returns an unbind function. */
export function bindModel(model: MinimalModel, store: Store<ExplorerState>): () => void {
  const offs = TRAITS.map(([trait, key]) => {
    const cb = () => {
      const value = model.get(trait);
      const patch: Partial<ExplorerState> = {};
      (patch as Record<string, unknown>)[key] =
        key === 'query' ? { ...DEFAULT_QUERY, ...(value as object) } : (value ?? (key === 'activeId' ? null : value));
      store.set(patch);
    };
    model.on(`change:${trait}`, cb);
    return () => model.off(`change:${trait}`, cb);
  });
  return () => offs.forEach((off) => off());
}

/** Apply a results page: replace items; keep selection that still refers to loaded items. */
export function applyPage(store: Store<ExplorerState>, msg: PageMessage): void {
  const ids = new Set(msg.items.map((i) => i.id));
  const { selectedIds, activeId } = store.get();
  store.set({
    items: msg.items,
    matched: msg.matched,
    searched: true,
    selectedIds: selectedIds.filter((id) => ids.has(id)),
    activeId: activeId && ids.has(activeId) ? activeId : null,
  });
}
```

`js/actions.ts`:

```ts
/** User intents. Each updates the store and, where Python cares, the model. */
import type { Backend } from './backend';
import { commitRows } from './filters';
import { toggleId } from './selection';
import type { Store } from './store';
import type { Strings } from './strings';
import type {
  AoiGeometry,
  DrawMode,
  ExplorerState,
  FilterRow,
  MinimalModel,
  QueryStateDict,
  SectionId,
} from './types';

export interface Actions {
  setQuery(patch: Partial<QueryStateDict>): void;
  /** One AOI: replaces the current one (null clears it). */
  setAoi(geometry: AoiGeometry | null): void;
  setDrawMode(mode: DrawMode | null): void;
  uploadAoi(file: File): Promise<void>;
  zoomToAoi(): void;
  /** Fetch the filterable fields for the selected collections. */
  loadFields(): Promise<void>;
  addFilterRow(): void;
  updateFilterRow(id: number, patch: Partial<Pick<FilterRow, 'field' | 'op' | 'value'>>): void;
  removeFilterRow(id: number): void;
  toggleSection(id: SectionId): void;
  setPanelCollapsed(collapsed: boolean): void;
  search(): void;
  cancel(): void;
  dismissError(): void;
  activate(id: string | null): void;
  toggleSelected(id: string): void;
}

/** File contents as text (FileReader fallback where Blob.text() is missing). */
function readText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsText(file);
  });
}

export function createActions(
  model: MinimalModel,
  store: Store<ExplorerState>,
  backend: Backend,
  S: Strings,
): Actions {
  let nextRowId = Math.max(0, ...store.get().filterRows.map((r) => r.id)) + 1;
  const push = (trait: string, value: unknown) => {
    model.set(trait, value);
    model.save_changes();
  };
  const commit = (rows: FilterRow[]) => {
    const { rows: checked, filters } = commitRows(rows, store.get().fields, S);
    store.set({ filterRows: checked });
    actions.setQuery({ filters });
  };
  let fieldsRequest = 0;

  const actions: Actions = {
    setQuery(patch) {
      const query = { ...store.get().query, ...patch };
      store.set({ query });
      push('query', query);
    },
    setAoi(geometry) {
      store.set({ drawMode: null, aoiError: '' });
      actions.setQuery({ aois: geometry ? [{ geometry, selected: true }] : [] });
    },
    setDrawMode(mode) {
      store.set({ drawMode: mode, aoiError: '' });
    },
    async uploadAoi(file) {
      store.set({ drawMode: null, aoiError: '' });
      try {
        const geometry = await backend.uploadAoi(await readText(file));
        actions.setAoi(geometry);
        actions.zoomToAoi();
      } catch (err) {
        store.set({ aoiError: S.uploadRejected(file.name, (err as Error).message) });
      }
    },
    zoomToAoi() {
      store.set({ zoomToAoi: store.get().zoomToAoi + 1 });
    },
    async loadFields() {
      const collections = store.get().query.collections;
      const request = ++fieldsRequest;
      if (!collections.length) {
        store.set({ fields: [], fieldsLoading: false, fieldsError: '' });
        commit(store.get().filterRows);
        return;
      }
      store.set({ fieldsLoading: true, fieldsError: '' });
      try {
        const fields = await backend.queryables(collections);
        if (request !== fieldsRequest) return; // a newer selection won
        store.set({ fields, fieldsLoading: false });
        commit(store.get().filterRows);
      } catch (err) {
        if (request !== fieldsRequest) return;
        store.set({ fields: [], fieldsLoading: false, fieldsError: (err as Error).message });
      }
    },
    addFilterRow() {
      const first = store.get().fields[0];
      const row: FilterRow = { id: nextRowId++, field: first?.name ?? '', op: '=', value: '', error: '' };
      store.set({ filterRows: [...store.get().filterRows, row], sections: { ...store.get().sections, filters: true } });
    },
    updateFilterRow(id, patch) {
      commit(store.get().filterRows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    },
    removeFilterRow(id) {
      commit(store.get().filterRows.filter((r) => r.id !== id));
    },
    toggleSection(id) {
      const sections = store.get().sections;
      store.set({ sections: { ...sections, [id]: !sections[id] } });
    },
    setPanelCollapsed(collapsed) {
      store.set({ panelCollapsed: collapsed });
      push('panel_collapsed', collapsed);
    },
    search() {
      store.set({ error: '', drawMode: null });
      backend.search(store.get().query);
    },
    cancel() {
      backend.cancel();
    },
    dismissError() {
      store.set({ error: '' });
    },
    activate(id) {
      store.set({ activeId: id });
      push('active_id', id);
    },
    toggleSelected(id) {
      const selectedIds = toggleId(store.get().selectedIds, id);
      store.set({ selectedIds });
      push('selected_ids', selectedIds);
    },
  };
  return actions;
}
```

`js/format.ts`:

```ts
/** Pure formatting and geometry helpers (no DOM). */
import { splitAtAntimeridian } from './antimeridian';
import type { StacItem } from './types';

const EARTH_RADIUS_KM = 6371.0088;
const MERC = 20037508.342789244;

export function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Keep the start and the (distinctive) end of long product ids. */
export function shortId(id: string, max = 36): string {
  if (id.length <= max) return id;
  return `${id.slice(0, max - 13)}…${id.slice(-12)}`;
}

/** "2024-07-12T10:30:41.024Z" -> "2024-07-12 10:30Z"; unparseable input is returned unchanged. */
export function formatIso(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toISOString().slice(0, 16).replace('T', ' ')}Z`;
}

/** An item's time: `datetime`, else its start/end range, else an em dash. */
export function formatItemDate(item: StacItem): string {
  const p = item.properties ?? {};
  if (typeof p.datetime === 'string') return formatIso(p.datetime);
  const start = typeof p.start_datetime === 'string' ? p.start_datetime.slice(0, 10) : '';
  const end = typeof p.end_datetime === 'string' ? p.end_datetime.slice(0, 10) : '';
  if (start || end) return `${start || '…'} – ${end || '…'}`;
  return '—';
}

export function formatValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return String(value);
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function cloudCover(item: StacItem): number | undefined {
  const v = item.properties?.['eo:cloud_cover'];
  return typeof v === 'number' ? v : undefined;
}

export type Bbox = [number, number, number, number];

export function geometryBbox(geom: GeoJSON.Geometry | null | undefined): Bbox | null {
  if (!geom) return null;
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  const visit = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === 'number') {
      const [x, y] = c as number[];
      w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y);
    } else if (Array.isArray(c)) c.forEach(visit);
  };
  if (geom.type === 'GeometryCollection') geom.geometries.forEach((g) => visit((g as GeoJSON.Polygon).coordinates));
  else visit((geom as GeoJSON.Polygon).coordinates);
  return Number.isFinite(w) ? [w, s, e, n] : null;
}

export function unionBbox(boxes: Array<Bbox | null>): Bbox | null {
  const valid = boxes.filter((b): b is Bbox => b !== null);
  if (!valid.length) return null;
  return [
    Math.min(...valid.map((b) => b[0])),
    Math.min(...valid.map((b) => b[1])),
    Math.max(...valid.map((b) => b[2])),
    Math.max(...valid.map((b) => b[3])),
  ];
}

/** Exact area of a lon/lat box on a sphere. */
export function boxAreaKm2([w, s, e, n]: Bbox): number {
  const rad = Math.PI / 180;
  return EARTH_RADIUS_KM ** 2 * Math.abs((e - w) * rad) * Math.abs(Math.sin(n * rad) - Math.sin(s * rad));
}

/**
 * Area of a (Multi)Polygon on a sphere, holes subtracted — the ring formula
 * used by turf/area (Chamberlain & Duquette, JPL 07-03). Exact for boxes.
 */
export function geometryAreaKm2(geom: GeoJSON.Polygon | GeoJSON.MultiPolygon): number {
  const rad = Math.PI / 180;
  const ringArea = (ring: number[][]): number => {
    let total = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      const [x1, y1] = ring[i];
      const [x2, y2] = ring[i + 1];
      total += (x2 - x1) * rad * (2 + Math.sin(y1 * rad) + Math.sin(y2 * rad));
    }
    return Math.abs((total * EARTH_RADIUS_KM ** 2) / 2);
  };
  const polygonArea = (rings: number[][][]) =>
    rings.reduce((sum, ring, i) => sum + (i === 0 ? ringArea(ring) : -ringArea(ring)), 0);
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  return polys.reduce((sum, p) => sum + polygonArea(p), 0);
}

export function formatBbox(b: Bbox): string {
  return b.map((v) => v.toFixed(3)).join(', ');
}

export function formatArea(km2: number): string {
  return km2 < 10 ? `${km2.toFixed(2)} km²` : `${Math.round(km2).toLocaleString('en')} km²`;
}

/** <input type=date> value -> ISO instant at the start or end of that UTC day. */
export function dateInputToIso(value: string, endOfDay: boolean): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  return `${value}T${endOfDay ? '23:59:59' : '00:00:00'}Z`;
}

export function isoToDateInput(iso: string | undefined): string {
  return iso ? iso.slice(0, 10) : '';
}

/** lon/lat bbox -> EPSG:3857 extent, padded by `pad` of its size on each side. */
export function bboxTo3857([w, s, e, n]: Bbox, pad = 0.1): Bbox {
  const x = (lon: number) => (lon * MERC) / 180;
  const y = (lat: number) => {
    const c = Math.max(-85, Math.min(85, lat));
    return (Math.log(Math.tan(((90 + c) * Math.PI) / 360)) / (Math.PI / 180)) * (MERC / 180);
  };
  const [x0, y0, x1, y1] = [x(w), y(s), x(e), y(n)];
  // A minimum pad keeps a single point / tiny box from zooming in absurdly far.
  const dx = pad ? Math.max((x1 - x0) * pad, 1000) : 0;
  const dy = pad ? Math.max((y1 - y0) * pad, 1000) : 0;
  return [x0 - dx, y0 - dy, x1 + dx, y1 + dy];
}

/** Map features for items that have a geometry (null geometries are skipped). */
export function itemFeatures(items: StacItem[]): GeoJSON.Feature[] {
  return items
    .filter((i) => i.geometry)
    .map((i) => ({
      type: 'Feature' as const,
      id: i.id,
      geometry: splitAtAntimeridian(i.geometry as GeoJSON.Geometry),
      properties: { id: i.id },
    }));
}

export function selfHref(item: StacItem): string | undefined {
  return item.links?.find((l) => l.rel === 'self')?.href;
}
```

`js/selection.ts`:

```ts
/** Selection helpers (pure except scrollWithin). */
import type { StacItem } from './types';

/** Next/previous loaded item id, or null at either end. */
export function neighbour(items: StacItem[], activeId: string | null, dir: 1 | -1): string | null {
  if (!items.length) return null;
  const at = items.findIndex((i) => i.id === activeId);
  if (at === -1) return dir === 1 ? items[0].id : null;
  return items[at + dir]?.id ?? null;
}

export function toggleId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}

/** Scroll `row` into view inside `container` only (never the notebook). */
export function scrollWithin(container: HTMLElement, row: HTMLElement, stickyHeader = 0): void {
  const c = container.getBoundingClientRect();
  const r = row.getBoundingClientRect();
  if (r.top < c.top + stickyHeader) container.scrollTop -= c.top + stickyHeader - r.top;
  else if (r.bottom > c.bottom) container.scrollTop += r.bottom - c.bottom;
}
```

`js/clipboard.ts`:

```ts
/** Copy text; falls back to execCommand where the async clipboard API is unavailable. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}
```

`js/snippets.ts`:

```ts
/** Code snippets the details view copies. JSON string literals are valid Python literals. */
export function pythonItemSnippet(selfHref: string): string {
  return `import jstex\n\nitem = jstex.item(${JSON.stringify(selfHref)})`;
}
```

`js/theme.ts`:

```ts
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
  if (body?.classList.contains('vscode-dark') || body?.classList.contains('vscode-high-contrast')) {
    return !body.classList.contains('vscode-high-contrast-light');
  }
  if (body?.classList.contains('vscode-light')) return false;
  const colab = doc.documentElement.getAttribute('theme');
  if (colab === 'dark') return true;
  if (colab === 'light') return false;
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
}

/** Call `onChange` whenever any of the theme signals above changes. Returns a stop function. */
export function watchTheme(onChange: () => void, doc: Document = document): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(doc.body, { attributes: true, attributeFilter: ['data-jp-theme-light', 'class'] });
  observer.observe(doc.documentElement, { attributes: true, attributeFilter: ['theme', 'class'] });
  const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
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
    attribution: '© OpenStreetMap contributors © CARTO',
  },
  dark: {
    url: 'https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}@2x.png',
    attribution: '© Stadia Maps © OpenMapTiles © OpenStreetMap',
  },
};

export function basemapLayer(basemap: BasemapConfig, dark: boolean): Record<string, unknown> {
  const source = dark ? basemap.dark : basemap.light;
  return {
    type: 'Tile',
    properties: { id: 'basemap' },
    source: { type: 'XYZ', url: source.url, attributions: source.attribution },
  };
}
```

`js/filters.ts`:

```ts
/**
 * Attribute-filter logic (pure). Operators by field type and validation follow
 * STEX src/utils/filter-validation.ts; values are typed from the raw text of
 * the builder rows. The UI keeps rows (with errors); only valid rows become
 * QueryState filters.
 */
import type { Strings } from './strings';
import type { FilterField, FilterOp, FilterPredicate, FilterRow } from './types';

const NUMERIC_OPS: FilterOp[] = ['=', '!=', '<', '<=', '>', '>='];
const STRING_OPS: FilterOp[] = ['=', '!=', 'IN'];
const BOOLEAN_OPS: FilterOp[] = ['=', '!='];

export function operatorsFor(type: string): FilterOp[] {
  if (type === 'number' || type === 'integer') return [...NUMERIC_OPS];
  if (type === 'string') return [...STRING_OPS];
  return [...BOOLEAN_OPS];
}

/** Raw row text -> typed value (IN: comma-separated list). Unparseable input is kept for validation to report. */
export function parseValue(raw: string, field: FilterField, op: FilterOp): unknown {
  if (op === 'IN') {
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (field.type === 'number' || field.type === 'integer') {
    const n = raw.trim() === '' ? NaN : Number(raw);
    return Number.isNaN(n) ? raw : n;
  }
  if (field.type === 'boolean') {
    const v = raw.trim().toLowerCase();
    return v === 'true' ? true : v === 'false' ? false : raw;
  }
  return raw;
}

export function validate(pred: FilterPredicate, field: FilterField, S: Strings): string {
  if (!operatorsFor(field.type).includes(pred.op)) return S.errOperator(pred.op, field.title);
  if (pred.op === 'IN') return Array.isArray(pred.value) && pred.value.length ? '' : S.errInList;
  if (field.type === 'number' || field.type === 'integer') {
    if (typeof pred.value !== 'number') return S.errNumber;
    if (field.type === 'integer' && !Number.isInteger(pred.value)) return S.errInteger;
    if (field.minimum !== undefined && pred.value < field.minimum) return S.errMin(field.minimum);
    if (field.maximum !== undefined && pred.value > field.maximum) return S.errMax(field.maximum);
    return '';
  }
  if (field.type === 'boolean') return typeof pred.value === 'boolean' ? '' : S.errBoolean;
  if (field.enum && !field.enum.includes(pred.value)) return S.errEnum;
  return pred.value === '' ? S.errValue : '';
}

/**
 * Validate every row against the current fields. Returns rows with `error`
 * set and the predicates of the valid, non-empty rows. Rows with an empty
 * value are neither errors nor filters (the user is still typing).
 */
export function commitRows(
  rows: FilterRow[],
  fields: FilterField[],
  S: Strings,
): { rows: FilterRow[]; filters: FilterPredicate[] } {
  const byName = new Map(fields.map((f) => [f.name, f]));
  const filters: FilterPredicate[] = [];
  const checked = rows.map((row) => {
    const field = byName.get(row.field);
    if (!field) return { ...row, error: fields.length ? S.errFieldUnavailable : '' };
    if (row.value.trim() === '') return { ...row, error: '' };
    const pred: FilterPredicate = { field: row.field, op: row.op, value: parseValue(row.value, field, row.op) };
    const error = validate(pred, field, S);
    if (!error) filters.push(pred);
    return { ...row, error };
  });
  return { rows: checked, filters };
}

/** Rows for filters restored from a query (e.g. ?q= or a re-rendered view). */
export function rowsFromFilters(filters: FilterPredicate[], nextId: () => number): FilterRow[] {
  return filters.map((f) => ({
    id: nextId(),
    field: f.field,
    op: f.op,
    value: Array.isArray(f.value) ? f.value.join(', ') : String(f.value),
    error: '',
  }));
}

export function filterSummary(filters: FilterPredicate[], fields: FilterField[]): string {
  const title = (name: string) => fields.find((f) => f.name === name)?.title ?? name;
  return filters
    .map((f) => `${title(f.field)} ${f.op} ${Array.isArray(f.value) ? f.value.join('|') : String(f.value)}`)
    .join(', ');
}
```

`js/icons.ts`:

```ts
/** Inline SVG icons (currentColor, 16×16 viewBox) — no icon font needed in a blob-loaded widget. */
const svg = (body: string) =>
  `<svg class="jstex-svg" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">${body}</svg>`;
const stroke = 'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"';

export const ICON = {
  search: svg(`<circle cx="7" cy="7" r="4.5" ${stroke}/><path d="M10.4 10.4 14 14" ${stroke}/>`),
  polygon: svg(`<path d="M3 5.5 8 2.5l5 3.5-1.8 6.5H4.6z" ${stroke}/>`),
  box: svg(`<rect x="2.5" y="3.5" width="11" height="9" rx="1" ${stroke} stroke-dasharray="2.4 1.6"/>`),
  upload: svg(`<path d="M8 10.5V2.8M5 5.6 8 2.6l3 3M3 10.5v2.2h10v-2.2" ${stroke}/>`),
  target: svg(`<circle cx="8" cy="8" r="4.5" ${stroke}/><path d="M8 1.5v2.5M8 12v2.5M1.5 8H4M12 8h2.5" ${stroke}/>`),
  close: svg(`<path d="M4.5 4.5l7 7m0-7-7 7" ${stroke}/>`),
  chevronRight: svg(`<path d="M6 3.5 10.5 8 6 12.5" ${stroke}/>`),
  chevronLeft: svg(`<path d="M10 3.5 5.5 8l4.5 4.5" ${stroke}/>`),
  info: svg(`<circle cx="8" cy="8" r="6.2" ${stroke}/><path d="M8 7.2v4M8 4.9v.1" ${stroke}/>`),
  warn: svg(`<path d="M8 2.2 14.3 13.5H1.7z" ${stroke}/><path d="M8 6.5v3.2M8 11.6v.1" ${stroke}/>`),
  layers: svg(`<path d="m8 2.5 6 3-6 3-6-3zM2 8.5l6 3 6-3M2 11.2l6 3 6-3" ${stroke}/>`),
  calendar: svg(`<rect x="2.5" y="3.5" width="11" height="10" rx="1.2" ${stroke}/><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" ${stroke}/>`),
  filter: svg(`<path d="M2.5 3.5h11L9.3 8.6v4.2l-2.6-1.3V8.6z" ${stroke}/>`),
  plus: svg(`<path d="M8 3v10M3 8h10" ${stroke}/>`),
};
```

`js/i18n.ts`:

```ts
/**
 * Translations for the widget, following JupyterLab's i18n standard (gettext
 * via ITranslator, domain "jstex").
 *
 * The widget is not a JupyterLab plugin, so it cannot ask for ITranslator
 * itself. The jstex labextension (src/index.ts) loads the "jstex" bundle at
 * startup and publishes it under Symbol.for('jstex.i18n'). Outside JupyterLab
 * (VS Code, Colab, Voilà) nothing is published and the widget uses English.
 *
 * Strings MUST be written as literal calls on a variable named `trans`
 * (`trans.__('Search')`) so `jupyterlab-translate extract` finds them.
 */

export interface TranslationBundle {
  __(msgid: string, ...args: unknown[]): string;
  _n(msgid: string, msgidPlural: string, n: number, ...args: unknown[]): string;
  _p(msgctxt: string, msgid: string, ...args: unknown[]): string;
}

export interface SharedI18n {
  languageCode: string;
  bundle: TranslationBundle;
}

/** Shared with src/index.ts (a separate build) — keep the key identical. */
export const I18N_KEY = Symbol.for('jstex.i18n');

/** JupyterLab-compatible placeholder substitution: "%1 of %2". */
export function strfmt(msg: string, ...args: unknown[]): string {
  return msg.replace(/%(\d+)/g, (match, n: string) => {
    const value = args[Number(n) - 1];
    return value === undefined ? match : String(value);
  });
}

export const englishBundle: TranslationBundle = {
  __: (msgid, ...args) => strfmt(msgid, ...args),
  _n: (msgid, msgidPlural, n, ...args) => strfmt(n === 1 ? msgid : msgidPlural, ...args),
  _p: (_ctx, msgid, ...args) => strfmt(msgid, ...args),
};

function shared(): SharedI18n | undefined {
  return (globalThis as Record<symbol, SharedI18n | undefined>)[I18N_KEY];
}

export function getTranslation(): TranslationBundle {
  return shared()?.bundle ?? englishBundle;
}

export function languageCode(): string {
  return shared()?.languageCode ?? 'en';
}
```

`js/strings.ts`:

```ts
/**
 * All user-visible widget strings. English source strings, translated through
 * the JupyterLab gettext bundle for domain "jstex" when one is available.
 * Keep every call a literal `trans.__('…')` / `trans._n(…)` (extraction rule).
 */
import { getTranslation, type TranslationBundle } from './i18n';

export function createStrings(trans: TranslationBundle) {
  return {
    // ── search panel ──
    collapsePanel: trans.__('Collapse search panel'),
    expandPanel: trans.__('Expand search panel'),
    // collections
    collections: trans.__('Collections'),
    collectionsSearch: trans.__('Search collections…'),
    clearSearch: trans.__('Clear search'),
    onlySelected: trans.__('Only selected'),
    collectionsCount: (shown: number, total: number) => trans.__('%1 of %2', shown, total),
    collectionsLoading: trans.__('Loading collections…'),
    collectionsEmpty: trans.__('No collections available.'),
    collectionsNoMatch: trans.__('No collections match.'),
    collectionInfo: trans.__('About this collection'),
    timeRange: (start: string, end: string) => trans.__('%1 → %2', start, end),
    ongoing: trans.__('ongoing'),
    license: (license: string) => trans.__('License: %1', license),
    // dates
    dates: trans.__('Dates'),
    utc: trans.__('(UTC)'),
    from: trans.__('From'),
    to: trans.__('To'),
    open: trans.__('open'),
    clearDates: trans.__('Clear dates'),
    datesHint: trans.__('Either end may stay empty.'),
    // area of interest (one area)
    aoi: trans.__('Area of interest'),
    polygon: trans.__('Polygon'),
    box: trans.__('Box'),
    upload: trans.__('Upload'),
    uploadTitle: trans.__('Upload a GeoJSON file (EPSG:4326)'),
    aoiEmptyHint: trans.__('Draw on the map or upload a GeoJSON file.'),
    drawPolygonHint: trans.__('Click to add points, double-click to finish · Esc cancels'),
    drawBoxHint: trans.__('Click two opposite corners · Esc cancels'),
    aoiPolygon: trans.__('Polygon'),
    aoiMultiPolygon: trans.__('Multipolygon'),
    zoomToAoi: trans.__('Zoom to area'),
    removeAoi: trans.__('Remove area'),
    uploadRejected: (file: string, message: string) => trans.__('%1: %2 The previous area is unchanged.', file, message),
    // filters
    filters: trans.__('Filters'),
    addFilter: trans.__('Add filter'),
    removeFilter: trans.__('Remove filter'),
    field: trans.__('Field'),
    operator: trans.__('Operator'),
    value: trans.__('Value'),
    inPlaceholder: trans.__('a, b, c'),
    chooseValue: trans.__('Choose…'),
    fieldsLoading: trans.__('Loading fields…'),
    fieldsNeedCollection: trans.__('Select a collection to filter by its attributes.'),
    fieldsShared: (n: number) => trans._n('Fields of the selected collection.', 'Fields shared by all %1 collections.', n, n),
    fieldsNone: trans.__('No filterable fields.'),
    errOperator: (op: string, field: string) => trans.__('%1 is not allowed for %2.', op, field),
    errInList: trans.__('Enter one or more values, comma-separated.'),
    errNumber: trans.__('Enter a number.'),
    errInteger: trans.__('Enter a whole number.'),
    errMin: (n: number) => trans.__('Must be at least %1.', n),
    errMax: (n: number) => trans.__('Must be at most %1.', n),
    errBoolean: trans.__('Choose true or false.'),
    errEnum: trans.__('Choose one of the listed values.'),
    errValue: trans.__('Enter a value.'),
    errFieldUnavailable: trans.__('Not available for the selected collections.'),
    // footer
    search: trans.__('Search'),
    cancel: trans.__('Cancel'),
    needCollection: trans.__('Select at least one collection.'),
    fixFilters: trans.__('Fix the filters above to search.'),
    noConstraint: (n: number) => trans.__('No area or dates set — showing the first %1 matches.', n),
    signedIn: trans.__('Signed in — restricted collections included.'),
    anonymousNote: trans.__('Not signed in — restricted collections are hidden.'),
    anonymousHint: trans.__(
      'No access token — restricted collections are hidden. Ask your hub admin to enable auth_state (see jstex README).',
    ),
    retry: trans.__('Retry'),
    dismiss: trans.__('Dismiss'),
    // ── results ──
    select: trans.__('Select'),
    results: trans.__('Results'),
    resultsIdle: trans.__('Run a search to see items.'),
    resultsSearching: trans.__('Searching…'),
    resultsNone: trans.__('No items match this query.'),
    loaded: (n: number) => trans._n('%1 loaded', '%1 loaded', n, n),
    selected: (n: number) => trans._n('%1 selected', '%1 selected', n, n),
    matched: (n: number) => trans._n('%1 matched', '%1 matched', n, n.toLocaleString('en')),
    colId: trans.__('ID'),
    colDatetime: trans.__('Datetime'),
    colCollection: trans.__('Collection'),
    colCloud: trans.__('Cloud %'),
    // ── item details ──
    details: trans.__('Item details'),
    detailsEmpty: trans.__('Click a result or a footprint to see its details.'),
    prev: trans.__('◀ Prev'),
    next: trans.__('Next ▶'),
    copySelf: trans.__('Copy self link'),
    copyId: trans.__('Copy id'),
    copyPython: trans.__('Copy Python'),
    copy: trans.__('Copy'),
    copied: trans.__('Copied'),
    copyFailed: trans.__('Copy failed'),
    properties: trans.__('Properties'),
    assets: trans.__('Assets'),
    links: trans.__('Links'),
    pythonHint: trans.__('In Python, .selected_item on your Explorer returns this item as a pystac.Item.'),
    // ── map ──
    overlapping: (n: number) => trans._n('%1 overlapping item', '%1 overlapping items', n, n),
    close: trans.__('Close'),
  };
}

export type Strings = ReturnType<typeof createStrings>;

/**
 * Built when the bundle is evaluated — anywidget evaluates it when an
 * Explorer is created, i.e. after the labextension published the bundle.
 */
export const S: Strings = createStrings(getTranslation());
```

- [ ] **Step 5: Run tests and typecheck**

Run: `jlpm vitest run && npx tsc -p js/tsconfig.json`
Expected: all PASS (antimeridian, foundations, filters, i18n and the Task 2 define-guard test); tsc prints nothing. (Verified while writing the plan with vite 7.3.6, vitest 3.2.7, typescript 5.9.)

- [ ] **Step 6: Commit**

```bash
jlpm prettier --write "js/**/*.ts"
git add js/
git commit -m "feat(js): store, comm backend, model sync, actions and pure helpers

antimeridian.ts copied from STEX with provenance header."
```

---

### Task 9: Search panel building blocks — collapsible section, collection search, dates

The panel follows layout A, approved by the user on 2026-09-30 (mockup: `layout-a-detail.html`, reproduced in the spec amendments). Collapsible sections sit in a panel as tall as the map, and closed sections show a one-line summary. This task builds the section container and the first two sections.

**Files:**
- Create: `js/ui/section.ts`, `js/ui/collections.ts`, `js/ui/dates.ts`
- Test: `js/__tests__/collections.test.ts`, `js/__tests__/dates.test.ts`

**Interfaces:**
- Consumes: `Store<ExplorerState>`, `Actions.setQuery`, `S`, `ICON`, `escapeHtml`, `dateInputToIso`, `isoToDateInput` (Task 8).
- Produces:
  - `createSection(id: SectionId, title: string, extraTitle?: string) -> Section { el, body, update(open, summary, badge) }`.
    - DOM: `section.jstex-section[data-panel-section=<id>]`, `button[data-toggle-section=<id>]`, `.jstex-section__sum`, `.jstex-badge`.
  - `mountCollections(el, store, actions) -> () => void`.
    - Refs: `collSearch`, `onlySelected`, `collCount`, `collList`.
    - Rows: `.jstex-coll[data-id]` (`.jstex-coll--sel` when selected), `input[data-toggle][value=<id>]`, `button[data-info=<id>]`, `.jstex-coll__about`.
  - `visibleCollections(all, selected, search, onlySelected) -> CollectionSummary[]`: selected collections always stay listed.
  - `mountDates(el, store, actions) -> () => void` with refs `from`, `to`, `clear`.
  - `datesSummary(datetime) -> string`, e.g. `"2024-07-01 → open"`.

- [ ] **Step 1: Write the failing tests** — `js/__tests__/collections.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { mountCollections, visibleCollections } from '../ui/collections';
import { byRef as q, setupView } from './helpers';

const COLLS = [
  { id: 'sentinel-2-l2a', title: 'Sentinel-2 Level-2A', description: 'Surface reflectance', license: 'other', start: '2015-06-27T10:25:31Z', end: null },
  { id: 'sentinel-2-l1c', title: 'Sentinel-2 Level-1C' },
  { id: 'landsat-c2-l2', title: 'Landsat Collection 2 Level-2' },
];

describe('collections', () => {
  it('visibleCollections: search by title or id, keep selected, only-selected', () => {
    expect(visibleCollections(COLLS, [], 'landsat', false).map((c) => c.id)).toEqual(['landsat-c2-l2']);
    expect(visibleCollections(COLLS, [], 'L1C', false).map((c) => c.id)).toEqual(['sentinel-2-l1c']);
    expect(visibleCollections(COLLS, ['sentinel-2-l2a'], 'landsat', false).map((c) => c.id)).toEqual([
      'sentinel-2-l2a',
      'landsat-c2-l2',
    ]);
    expect(visibleCollections(COLLS, ['sentinel-2-l1c'], '', true).map((c) => c.id)).toEqual(['sentinel-2-l1c']);
  });

  it('renders loading, then the list with a count; typing filters; ticking selects', () => {
    const { el, store, actions } = setupView();
    mountCollections(el, store, actions);
    expect(el.textContent).toContain('Loading collections…');
    store.set({ collections: COLLS, collectionsLoading: false });
    expect(el.querySelectorAll('.jstex-coll')).toHaveLength(3);
    expect(q(el, 'collCount').textContent).toBe('3 of 3');
    const search = q(el, 'collSearch') as HTMLInputElement;
    search.value = 'sentinel';
    search.dispatchEvent(new Event('input'));
    expect(el.querySelectorAll('.jstex-coll')).toHaveLength(2);
    const cb = el.querySelector('input[value="sentinel-2-l1c"]') as HTMLInputElement;
    cb.checked = true;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
    expect(actions.setQuery).toHaveBeenCalledWith({ collections: ['sentinel-2-l1c'] });
    expect(el.querySelector('[data-id="sentinel-2-l1c"]')!.classList.contains('jstex-coll--sel')).toBe(true);
  });

  it('ⓘ expands description, time range and license; state survives re-render', () => {
    const { el, store, actions } = setupView();
    mountCollections(el, store, actions);
    store.set({ collections: COLLS, collectionsLoading: false });
    (el.querySelector('[data-info="sentinel-2-l2a"]') as HTMLElement).click();
    const about = el.querySelector('.jstex-coll__about')!;
    expect(about.textContent).toContain('Surface reflectance');
    expect(about.textContent).toContain('2015-06-27 → ongoing · License: other');
    store.set({ query: { ...store.get().query, collections: ['landsat-c2-l2'] } });
    expect(el.querySelector('.jstex-coll__about')).not.toBeNull();
  });

  it('only-selected hides the rest; an empty search result says so', () => {
    const { el, store, actions } = setupView();
    mountCollections(el, store, actions);
    store.set({ collections: COLLS, collectionsLoading: false, query: { ...store.get().query, collections: ['landsat-c2-l2'] } });
    const only = q(el, 'onlySelected') as HTMLInputElement;
    only.checked = true;
    only.dispatchEvent(new Event('change'));
    expect(el.querySelectorAll('.jstex-coll')).toHaveLength(1);
    only.checked = false;
    only.dispatchEvent(new Event('change'));
    store.set({ query: { ...store.get().query, collections: [] } });
    const search = q(el, 'collSearch') as HTMLInputElement;
    search.value = 'modis';
    search.dispatchEvent(new Event('input'));
    expect(el.textContent).toContain('No collections match.');
  });
});
```

`js/__tests__/dates.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { datesSummary, mountDates } from '../ui/dates';
import { byRef as q, setupView } from './helpers';

describe('dates section', () => {
  it('either end may be set; values map to UTC day bounds; Clear resets both', () => {
    const { el, store, actions } = setupView();
    mountDates(el, store, actions);
    const from = q(el, 'from') as HTMLInputElement;
    const to = q(el, 'to') as HTMLInputElement;
    expect(q(el, 'clear').hidden).toBe(true);
    to.value = '2024-07-31';
    to.dispatchEvent(new Event('change'));
    expect(store.get().query.datetime).toEqual({ to: '2024-07-31T23:59:59Z' });
    from.value = '2024-07-01';
    from.dispatchEvent(new Event('change'));
    expect(store.get().query.datetime).toEqual({ from: '2024-07-01T00:00:00Z', to: '2024-07-31T23:59:59Z' });
    expect(q(el, 'clear').hidden).toBe(false);
    q(el, 'clear').click();
    expect(store.get().query.datetime).toBeNull();
    expect([from.value, to.value]).toEqual(['', '']);
  });

  it('reflects a query set from Python and summarises open ends', () => {
    const { el, store, actions } = setupView();
    mountDates(el, store, actions);
    store.set({ query: { ...store.get().query, datetime: { from: '2023-01-01T00:00:00Z' } } });
    expect((q(el, 'from') as HTMLInputElement).value).toBe('2023-01-01');
    expect(datesSummary({ from: '2023-01-01T00:00:00Z' })).toBe('2023-01-01 → open');
    expect(datesSummary({ to: '2023-02-01T23:59:59Z' })).toBe('open → 2023-02-01');
    expect(datesSummary(null)).toBe('');
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `jlpm vitest run js/__tests__/collections.test.ts js/__tests__/dates.test.ts`
Expected: FAIL — `Failed to resolve import "../ui/collections"`.

- [ ] **Step 3: Implement** — `js/ui/section.ts`:

```ts
/** A collapsible panel section: header (caret, title, summary when closed, badge) + body. */
import { escapeHtml } from '../format';
import { ICON } from '../icons';
import type { SectionId } from '../types';

export interface Section {
  el: HTMLElement;
  body: HTMLElement;
  /** Open/closed, one-line summary (shown when closed) and badge text ('' hides it). */
  update(open: boolean, summary: string, badge: string): void;
}

export function createSection(id: SectionId, title: string, extraTitle = ''): Section {
  const el = document.createElement('section');
  el.className = 'jstex-section';
  el.dataset.panelSection = id;
  el.innerHTML = `
    <button type="button" class="jstex-section__head" data-toggle-section="${id}" aria-expanded="true">
      <span class="jstex-section__caret">${ICON.chevronRight}</span>
      <span class="jstex-section__title">${escapeHtml(title)}${extraTitle ? ` <span class="jstex-muted">${escapeHtml(extraTitle)}</span>` : ''}</span>
      <span class="jstex-section__sum"></span>
      <span class="jstex-badge"></span>
    </button>
    <div class="jstex-section__body"></div>`;
  const head = el.querySelector('.jstex-section__head') as HTMLElement;
  const sum = el.querySelector('.jstex-section__sum') as HTMLElement;
  const badge = el.querySelector('.jstex-badge') as HTMLElement;
  const body = el.querySelector('.jstex-section__body') as HTMLElement;
  return {
    el,
    body,
    update(open, summary, badgeText) {
      el.classList.toggle('jstex-section--closed', !open);
      head.setAttribute('aria-expanded', String(open));
      body.hidden = !open;
      sum.textContent = open ? '' : summary;
      sum.title = summary;
      badge.textContent = badgeText;
      badge.hidden = !badgeText;
    },
  };
}
```

`js/ui/collections.ts` (DOM-only state, the expanded ⓘ rows, lives in the closure because the list is re-rendered):

```ts
/**
 * Collection search: search box (title or id), "Only selected", "n of N",
 * rows with checkbox, title, id and an ⓘ that expands description, time
 * extent and license inline (as in STEX, without tags). Selected collections
 * always stay listed, whatever the search text.
 */
import type { Actions } from '../actions';
import { escapeHtml } from '../format';
import { ICON } from '../icons';
import type { Store } from '../store';
import { S } from '../strings';
import type { CollectionSummary, ExplorerState } from '../types';

type CollectionActions = Pick<Actions, 'setQuery'>;

export function visibleCollections(
  all: CollectionSummary[],
  selected: string[],
  search: string,
  onlySelected: boolean,
): CollectionSummary[] {
  const needle = search.trim().toLowerCase();
  const chosen = new Set(selected);
  return all.filter((c) => {
    if (chosen.has(c.id)) return true;
    if (onlySelected) return false;
    return !needle || c.id.toLowerCase().includes(needle) || c.title.toLowerCase().includes(needle);
  });
}

function aboutHtml(c: CollectionSummary): string {
  const day = (iso?: string | null) => (iso ? iso.slice(0, 10) : '');
  const range = c.start ? S.timeRange(day(c.start), c.end ? day(c.end) : S.ongoing) : '';
  const meta = [range, c.license ? S.license(c.license) : ''].filter(Boolean).join(' · ');
  return `<div class="jstex-coll__about">${c.description ? `<p>${escapeHtml(c.description)}</p>` : ''}${
    meta ? `<div class="jstex-muted">${escapeHtml(meta)}</div>` : ''
  }</div>`;
}

export function mountCollections(el: HTMLElement, store: Store<ExplorerState>, actions: CollectionActions): () => void {
  el.innerHTML = `
    <div class="jstex-search-box">${ICON.search}
      <input type="search" data-ref="collSearch" placeholder="${escapeHtml(S.collectionsSearch)}" aria-label="${escapeHtml(S.collectionsSearch)}">
    </div>
    <div class="jstex-row jstex-between">
      <label class="jstex-switch"><input type="checkbox" data-ref="onlySelected"><span class="jstex-switch__track"></span>${escapeHtml(S.onlySelected)}</label>
      <span class="jstex-muted jstex-small" data-ref="collCount"></span>
    </div>
    <div class="jstex-coll-list" data-ref="collList"></div>`;
  const ref = <T extends HTMLElement = HTMLElement>(name: string) => el.querySelector(`[data-ref="${name}"]`) as T;
  const search = ref<HTMLInputElement>('collSearch');
  const onlySelected = ref<HTMLInputElement>('onlySelected');
  const list = ref('collList');
  // DOM-only state lives here, not in the DOM: the list is re-rendered.
  const expanded = new Set<string>();

  const render = () => {
    const s = store.get();
    if (s.collectionsLoading || s.collectionsError || !s.collections.length) {
      list.innerHTML = `<div class="jstex-empty jstex-muted">${escapeHtml(
        s.collectionsLoading ? S.collectionsLoading : s.collectionsError || S.collectionsEmpty,
      )}</div>`;
      ref('collCount').textContent = '';
      return;
    }
    const selected = new Set(s.query.collections);
    const shown = visibleCollections(s.collections, s.query.collections, search.value, onlySelected.checked);
    ref('collCount').textContent = S.collectionsCount(shown.length, s.collections.length);
    list.innerHTML = shown.length
      ? shown
          .map((c) => {
            const sel = selected.has(c.id);
            const open = expanded.has(c.id);
            return `<div class="jstex-coll${sel ? ' jstex-coll--sel' : ''}" data-id="${escapeHtml(c.id)}">
              <label class="jstex-coll__main">
                <input type="checkbox" data-toggle value="${escapeHtml(c.id)}"${sel ? ' checked' : ''}>
                <span class="jstex-coll__text"><span class="jstex-coll__title">${escapeHtml(c.title)}</span>
                <span class="jstex-mono jstex-muted">${escapeHtml(c.id)}</span></span>
              </label>
              <button type="button" class="jstex-icon jstex-coll__info" data-info="${escapeHtml(c.id)}"
                aria-expanded="${open}" title="${escapeHtml(S.collectionInfo)}" aria-label="${escapeHtml(S.collectionInfo)}">${ICON.info}</button>
            </div>${open ? aboutHtml(c) : ''}`;
          })
          .join('')
      : `<div class="jstex-empty jstex-muted">${escapeHtml(S.collectionsNoMatch)}</div>`;
  };

  list.addEventListener('change', (e) => {
    const cb = (e.target as HTMLElement).closest<HTMLInputElement>('input[data-toggle]');
    if (!cb) return;
    const current = store.get().query.collections;
    actions.setQuery({ collections: cb.checked ? [...current, cb.value] : current.filter((id) => id !== cb.value) });
  });
  list.addEventListener('click', (e) => {
    const info = (e.target as HTMLElement).closest<HTMLElement>('[data-info]');
    if (!info) return;
    const id = info.dataset.info!;
    if (expanded.has(id)) expanded.delete(id);
    else expanded.add(id);
    render();
  });
  search.addEventListener('input', render);
  onlySelected.addEventListener('change', render);

  render();
  return store.subscribe((s, prev) => {
    if (
      s.collections !== prev.collections ||
      s.collectionsLoading !== prev.collectionsLoading ||
      s.collectionsError !== prev.collectionsError ||
      s.query.collections !== prev.query.collections
    ) {
      render();
    }
  });
}
```

`js/ui/dates.ts`:

```ts
/** Date range (UTC days). Either end may be empty; the search sends it closed (1900 / 2099). */
import type { Actions } from '../actions';
import { dateInputToIso, escapeHtml, isoToDateInput } from '../format';
import { ICON } from '../icons';
import type { Store } from '../store';
import { S } from '../strings';
import type { ExplorerState } from '../types';

export function datesSummary(datetime: ExplorerState['query']['datetime']): string {
  if (!datetime?.from && !datetime?.to) return '';
  return `${isoToDateInput(datetime.from) || S.open} → ${isoToDateInput(datetime.to) || S.open}`;
}

export function mountDates(el: HTMLElement, store: Store<ExplorerState>, actions: Pick<Actions, 'setQuery'>): () => void {
  el.innerHTML = `
    <div class="jstex-row">
      <input type="date" class="jstex-control jstex-grow" data-ref="from" aria-label="${escapeHtml(S.from)}" title="${escapeHtml(S.from)}">
      <span class="jstex-muted" aria-hidden="true">–</span>
      <input type="date" class="jstex-control jstex-grow" data-ref="to" aria-label="${escapeHtml(S.to)}" title="${escapeHtml(S.to)}">
      <button type="button" class="jstex-icon" data-ref="clear" title="${escapeHtml(S.clearDates)}" aria-label="${escapeHtml(S.clearDates)}">${ICON.close}</button>
    </div>
    <div class="jstex-hint">${escapeHtml(S.datesHint)}</div>`;
  const from = el.querySelector('[data-ref="from"]') as HTMLInputElement;
  const to = el.querySelector('[data-ref="to"]') as HTMLInputElement;
  const clear = el.querySelector('[data-ref="clear"]') as HTMLElement;

  const update = (s: ExplorerState) => {
    const f = isoToDateInput(s.query.datetime?.from);
    const t = isoToDateInput(s.query.datetime?.to);
    if (document.activeElement !== from && from.value !== f) from.value = f;
    if (document.activeElement !== to && to.value !== t) to.value = t;
    clear.hidden = !(f || t);
  };
  const onChange = () => {
    const f = dateInputToIso(from.value, false);
    const t = dateInputToIso(to.value, true);
    actions.setQuery({ datetime: f || t ? { ...(f ? { from: f } : {}), ...(t ? { to: t } : {}) } : null });
  };
  from.addEventListener('change', onChange);
  to.addEventListener('change', onChange);
  clear.addEventListener('click', () => {
    from.value = '';
    to.value = '';
    actions.setQuery({ datetime: null });
  });
  update(store.get());
  return store.subscribe((s, prev) => {
    if (s.query.datetime !== prev.query.datetime) update(s);
  });
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `jlpm vitest run && npx tsc -p js/tsconfig.json`
Expected: all PASS, no tsc output.

- [ ] **Step 5: Commit**

```bash
jlpm prettier --write "js/**/*.ts"
git add js/ui/section.ts js/ui/collections.ts js/ui/dates.ts js/__tests__/collections.test.ts js/__tests__/dates.test.ts
git commit -m "feat(js): panel section, collection search with info, open-ended dates"
```

---

### Task 10: Area-of-interest section — Polygon / Box / Upload, chip with zoom and remove

**Files:**
- Create: `js/ui/aoi-section.ts`
- Test: `js/__tests__/aoi-section.test.ts`

**Interfaces:**
- Consumes: `Actions.setAoi / setDrawMode / uploadAoi / zoomToAoi` (Task 8), `geometryAreaKm2`, `formatArea` (Task 8), and the Python `aoi_upload` reply (Task 7).
- Produces:
  - `mountAoiSection(el, store, actions) -> () => void`.
  - Refs: `upload`, `file`, `chip`, `chipText`, `zoom`, `remove`, `hint`, `error`.
  - Buttons: `[data-draw="Polygon"]` and `[data-draw="Box"]` (`aria-pressed` while active; clicking again stops drawing).
  - `aoiSummary(geometry) -> string`, e.g. `"Polygon · 8,666 km²"`.

- [ ] **Step 1: Write the failing test** — `js/__tests__/aoi-section.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { aoiSummary, mountAoiSection } from '../ui/aoi-section';
import { BOX, byRef as q, flush, setupView } from './helpers';

describe('area of interest section', () => {
  it('shows the empty hint, toggles draw modes and their hints', () => {
    const { el, store, actions } = setupView();
    mountAoiSection(el, store, actions);
    expect(q(el, 'hint').textContent).toBe('Draw on the map or upload a GeoJSON file.');
    expect(q(el, 'chip').hidden).toBe(true);
    (el.querySelector('[data-draw="Polygon"]') as HTMLElement).click();
    expect(store.get().drawMode).toBe('Polygon');
    expect(el.querySelector('[data-draw="Polygon"]')!.getAttribute('aria-pressed')).toBe('true');
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
    expect(aoiSummary({ type: 'MultiPolygon', coordinates: [BOX.coordinates] })).toBe('Multipolygon · 8,666 km²');
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
      Object.defineProperty(input, 'files', { value: [new File(['{"type":"Point"}'], name)], configurable: true });
      input.dispatchEvent(new Event('change'));
    };
    backend.uploadAoi.mockRejectedValueOnce(new Error('No polygon geometry found'));
    choose('points.geojson');
    await flush();
    await flush();
    expect(backend.uploadAoi).toHaveBeenCalledWith('{"type":"Point"}');
    expect(q(el, 'error').textContent).toBe('points.geojson: No polygon geometry found The previous area is unchanged.');
    choose('area.geojson');
    await flush();
    await flush();
    expect(q(el, 'error').hidden).toBe(true);
    expect(q(el, 'chip').hidden).toBe(false);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `jlpm vitest run js/__tests__/aoi-section.test.ts`
Expected: FAIL — `Failed to resolve import "../ui/aoi-section"`.

- [ ] **Step 3: Implement** — `js/ui/aoi-section.ts`:

```ts
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

type AoiActions = Pick<Actions, 'setAoi' | 'setDrawMode' | 'uploadAoi' | 'zoomToAoi'>;

export function aoiSummary(geometry: AoiGeometry | undefined): string {
  if (!geometry) return '';
  const kind = geometry.type === 'Polygon' ? S.aoiPolygon : S.aoiMultiPolygon;
  return `${kind} · ${formatArea(geometryAreaKm2(geometry))}`;
}

export function mountAoiSection(el: HTMLElement, store: Store<ExplorerState>, actions: AoiActions): () => void {
  el.innerHTML = `
    <div class="jstex-row jstex-wrap">
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
  const ref = <T extends HTMLElement = HTMLElement>(name: string) => el.querySelector(`[data-ref="${name}"]`) as T;
  const file = ref<HTMLInputElement>('file');

  const update = (s: ExplorerState) => {
    const aoi = s.query.aois.find((a) => a.selected)?.geometry;
    el.querySelectorAll<HTMLElement>('[data-draw]').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.draw === s.drawMode));
    });
    ref('chip').hidden = !aoi;
    ref('chipText').textContent = aoiSummary(aoi);
    const hint = s.drawMode === 'Polygon' ? S.drawPolygonHint : s.drawMode === 'Box' ? S.drawBoxHint : aoi ? '' : S.aoiEmptyHint;
    ref('hint').textContent = hint;
    ref('hint').hidden = !hint;
    ref('error').textContent = s.aoiError;
    ref('error').hidden = !s.aoiError;
  };

  el.addEventListener('click', (e) => {
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
    if (s.query.aois !== prev.query.aois || s.drawMode !== prev.drawMode || s.aoiError !== prev.aoiError) update(s);
  });
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `jlpm vitest run && npx tsc -p js/tsconfig.json`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
jlpm prettier --write "js/**/*.ts"
git add js/ui/aoi-section.ts js/__tests__/aoi-section.test.ts
git commit -m "feat(js): single area-of-interest section (draw polygon/box, upload, zoom, remove)"
```

---

### Task 11: Filter builder section — fields from queryables, typed values, inline errors

**Files:**
- Create: `js/ui/filters-section.ts`
- Test: `js/__tests__/filters-section.test.ts`

**Interfaces:**
- Consumes: `Actions.addFilterRow / updateFilterRow / removeFilterRow`, `operatorsFor` (Task 8), and the fields from `loadFields()` (Tasks 7 and 8).
- Produces:
  - `mountFiltersSection(el, store, actions) -> () => void`.
  - Refs: `rows`, `add`, `hint`.
  - Rows `[data-row=<id>]` with `[data-f="field"|"op"|"value"]`, `[data-remove=<id>]` and `[data-err]`.
  - Rows are rebuilt only when their structure (id, field, operator) or the field list changes, so typing never loses focus.

- [ ] **Step 1: Write the failing test** — `js/__tests__/filters-section.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { mountFiltersSection } from '../ui/filters-section';
import { byRef as q, setupView } from './helpers';

async function ready() {
  const view = setupView();
  mountFiltersSection(view.el, view.store, view.actions);
  view.actions.setQuery({ collections: ['c1', 'c2'] });
  await view.actions.loadFields();
  return view;
}

describe('filters section', () => {
  it('asks for a collection first; then offers shared fields', async () => {
    const { el, store, actions } = setupView();
    mountFiltersSection(el, store, actions);
    expect(q(el, 'hint').textContent).toBe('Select a collection to filter by its attributes.');
    expect((q(el, 'add') as HTMLButtonElement).disabled).toBe(true);
    actions.setQuery({ collections: ['c1', 'c2'] });
    await actions.loadFields();
    expect(q(el, 'hint').textContent).toBe('Fields shared by all 2 collections.');
    expect((q(el, 'add') as HTMLButtonElement).disabled).toBe(false);
  });

  it('adds a row with typed controls; enum fields get a dropdown', async () => {
    const { el, store } = await ready();
    q(el, 'add').click();
    const row = el.querySelector('[data-row]')!;
    const field = row.querySelector('[data-f="field"]') as HTMLSelectElement;
    expect([...field.options].map((o) => o.textContent)).toEqual(['Cloud cover', 'Platform', 'Relative orbit', 'Instrument mode']);
    expect([...(row.querySelector('[data-f="op"]') as HTMLSelectElement).options].map((o) => o.value)).toEqual([
      '=', '!=', '<', '<=', '>', '>=',
    ]);
    field.value = 'platform';
    field.dispatchEvent(new Event('change', { bubbles: true }));
    const value = el.querySelector('[data-row] [data-f="value"]') as HTMLSelectElement;
    expect(value.tagName).toBe('SELECT');
    value.value = 'sentinel-2b';
    value.dispatchEvent(new Event('change', { bubbles: true }));
    expect(store.get().query.filters).toEqual([{ field: 'platform', op: '=', value: 'sentinel-2b' }]);
  });

  it('typing keeps focus on the same input and shows errors inline', async () => {
    const { el, store } = await ready();
    q(el, 'add').click();
    const input = el.querySelector('[data-row] [data-f="value"]') as HTMLInputElement;
    input.focus();
    input.value = '1';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.value = '1x';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(el.querySelector('[data-row] [data-f="value"]')).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(el.querySelector('[data-err]')!.textContent).toBe('Enter a number.');
    expect(input.classList.contains('jstex-invalid')).toBe(true);
    input.value = '15';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(store.get().query.filters).toEqual([{ field: 'eo:cloud_cover', op: '=', value: 15 }]);
    (el.querySelector('[data-remove]') as HTMLElement).click();
    expect(el.querySelectorAll('[data-row]')).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `jlpm vitest run js/__tests__/filters-section.test.ts`
Expected: FAIL — `Failed to resolve import "../ui/filters-section"`.

- [ ] **Step 3: Implement.** Selects report through `change` and text inputs through `input`. Browsers fire both for a select, and handling both would reset a field change twice. `js/ui/filters-section.ts`:

```ts
/**
 * Attribute filter builder driven by the selected collections' queryables:
 * field (title; key in the tooltip) · operator (by type) · value (dropdown for
 * enums and booleans, text otherwise; IN takes a comma list). Rows are rebuilt
 * only when their structure changes, so typing never loses focus.
 */
import type { Actions } from '../actions';
import { escapeHtml } from '../format';
import { operatorsFor } from '../filters';
import { ICON } from '../icons';
import type { Store } from '../store';
import { S } from '../strings';
import type { ExplorerState, FilterField, FilterRow } from '../types';

type FilterActions = Pick<Actions, 'addFilterRow' | 'updateFilterRow' | 'removeFilterRow'>;

const option = (value: string, label: string, selected: boolean, title = '') =>
  `<option value="${escapeHtml(value)}"${selected ? ' selected' : ''}${title ? ` title="${escapeHtml(title)}"` : ''}>${escapeHtml(label)}</option>`;

function valueControl(row: FilterRow, field: FilterField | undefined): string {
  const choices = field?.type === 'boolean' ? ['true', 'false'] : field?.enum && row.op !== 'IN' ? field.enum.map(String) : null;
  if (choices) {
    return `<select class="jstex-control" data-f="value" aria-label="${escapeHtml(S.value)}">${option('', S.chooseValue, row.value === '')}${choices
      .map((c) => option(c, c, row.value === c))
      .join('')}</select>`;
  }
  const numeric = field?.type === 'number' || field?.type === 'integer';
  return `<input class="jstex-control" data-f="value" type="text" value="${escapeHtml(row.value)}"
    ${numeric && row.op !== 'IN' ? 'inputmode="decimal"' : ''} aria-label="${escapeHtml(S.value)}"
    placeholder="${escapeHtml(row.op === 'IN' ? S.inPlaceholder : S.value)}">`;
}

function rowHtml(row: FilterRow, fields: FilterField[]): string {
  const field = fields.find((f) => f.name === row.field);
  const fieldOptions = (field ? fields : [{ name: row.field, title: row.field } as FilterField, ...fields])
    .map((f) => option(f.name, f.title, f.name === row.field, f.name))
    .join('');
  const ops = operatorsFor(field?.type ?? 'string');
  return `<div class="jstex-filter" data-row="${row.id}">
    <select class="jstex-control" data-f="field" aria-label="${escapeHtml(S.field)}">${fieldOptions}</select>
    <select class="jstex-control" data-f="op" aria-label="${escapeHtml(S.operator)}">${ops.map((o) => option(o, o === 'IN' ? 'in' : o, o === row.op)).join('')}</select>
    ${valueControl(row, field)}
    <button type="button" class="jstex-icon" data-remove="${row.id}" title="${escapeHtml(S.removeFilter)}" aria-label="${escapeHtml(S.removeFilter)}">${ICON.close}</button>
    <div class="jstex-hint jstex-hint--err" data-err></div>
  </div>`;
}

export function mountFiltersSection(el: HTMLElement, store: Store<ExplorerState>, actions: FilterActions): () => void {
  el.innerHTML = `
    <div class="jstex-filter-rows" data-ref="rows"></div>
    <div class="jstex-row jstex-between">
      <button type="button" class="jstex-link" data-ref="add">${ICON.plus}<span>${escapeHtml(S.addFilter)}</span></button>
      <span class="jstex-hint" data-ref="hint"></span>
    </div>`;
  const rowsEl = el.querySelector('[data-ref="rows"]') as HTMLElement;
  const add = el.querySelector('[data-ref="add"]') as HTMLButtonElement;
  const hint = el.querySelector('[data-ref="hint"]') as HTMLElement;
  let structure = '';

  const update = (s: ExplorerState) => {
    const key = s.filterRows.map((r) => `${r.id}:${r.field}:${r.op}`).join('|') + '#' + s.fields.map((f) => f.name).join(',');
    if (key !== structure) {
      structure = key;
      rowsEl.innerHTML = s.filterRows.map((r) => rowHtml(r, s.fields)).join('');
    }
    for (const row of s.filterRows) {
      const rowEl = rowsEl.querySelector<HTMLElement>(`[data-row="${row.id}"]`);
      const err = rowEl?.querySelector<HTMLElement>('[data-err]');
      if (!rowEl || !err) continue;
      err.textContent = row.error;
      err.hidden = !row.error;
      rowEl.querySelector('[data-f="value"]')?.classList.toggle('jstex-invalid', Boolean(row.error));
    }
    const n = s.query.collections.length;
    hint.textContent = !n
      ? S.fieldsNeedCollection
      : s.fieldsLoading
        ? S.fieldsLoading
        : s.fieldsError || (s.fields.length ? S.fieldsShared(n) : S.fieldsNone);
    add.disabled = !s.fields.length || s.fieldsLoading;
  };

  const onEdit = (e: Event) => {
    const target = e.target as HTMLInputElement | HTMLSelectElement;
    const rowEl = target.closest<HTMLElement>('[data-row]');
    const f = target.dataset.f as 'field' | 'op' | 'value' | undefined;
    if (!rowEl || !f) return;
    const id = Number(rowEl.dataset.row);
    if (f === 'field') {
      const field = store.get().fields.find((x) => x.name === target.value);
      const ops = operatorsFor(field?.type ?? 'string');
      const current = store.get().filterRows.find((r) => r.id === id);
      actions.updateFilterRow(id, { field: target.value, op: current && ops.includes(current.op) ? current.op : ops[0], value: '' });
    } else {
      actions.updateFilterRow(id, { [f]: target.value });
    }
  };
  // Text inputs report on every keystroke ('input'); selects once ('change').
  rowsEl.addEventListener('input', (e) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') onEdit(e);
  });
  rowsEl.addEventListener('change', (e) => {
    if ((e.target as HTMLElement).tagName === 'SELECT') onEdit(e);
  });
  rowsEl.addEventListener('click', (e) => {
    const remove = (e.target as HTMLElement).closest<HTMLElement>('[data-remove]');
    if (remove) actions.removeFilterRow(Number(remove.dataset.remove));
  });
  add.addEventListener('click', () => actions.addFilterRow());

  update(store.get());
  return store.subscribe((s, prev) => {
    if (
      s.filterRows !== prev.filterRows ||
      s.fields !== prev.fields ||
      s.fieldsLoading !== prev.fieldsLoading ||
      s.fieldsError !== prev.fieldsError ||
      s.query.collections !== prev.query.collections
    ) {
      update(s);
    }
  });
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `jlpm vitest run && npx tsc -p js/tsconfig.json`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
jlpm prettier --write "js/**/*.ts"
git add js/ui/filters-section.ts js/__tests__/filters-section.test.ts
git commit -m "feat(js): queryables-driven filter builder with inline validation"
```

---

### Task 12: Search panel shell — sections, pinned Search, sign-in line, collapse to rail

**Files:**
- Create: `js/ui/panel.ts`
- Test: `js/__tests__/panel.test.ts`

**Interfaces:**
- Consumes: Tasks 9–11 (`createSection`, `mountCollections`, `mountDates`, `mountAoiSection`, `mountFiltersSection`, `datesSummary`, `aoiSummary`) and `filterSummary` (Task 8).
- Produces:
  - `mountPanel(el, store, actions) -> () => void`.
  - `searchBlocker(state) -> string`:
    - `''` means Search is enabled;
    - otherwise `"Select at least one collection."` or `"Fix the filters above to search."`.
    - Area and dates are not required; without them the footer shows the "first N matches" hint instead.
  - Refs: `panel`, `scroll`, `search`, `cancel`, `reason`, `auth`, `authText`, `errorBanner`, `errorText`, `retry`, `dismiss`, `collapse`, `rail`.
  - Rail buttons `[data-rail="expand"|"collections"|"dates"|"aoi"|"filters"|"search"]` carry `sup` badges and a tooltip summary.
  - The panel collapses only when the user clicks ◀, and the state is persisted in the `panel_collapsed` trait (Task 7).

- [ ] **Step 1: Write the failing test** — `js/__tests__/panel.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { mountPanel, searchBlocker } from '../ui/panel';
import { BOX, byRef as q, setupView } from './helpers';

describe('search panel', () => {
  it('Search needs a collection and valid filters; the reason is shown', async () => {
    const { el, store, actions } = setupView();
    mountPanel(el, store, actions);
    expect(searchBlocker(store.get())).toBe('Select at least one collection.');
    expect((q(el, 'search') as HTMLButtonElement).disabled).toBe(true);
    expect(q(el, 'reason').textContent).toBe('Select at least one collection.');
    actions.setQuery({ collections: ['c1'] });
    expect((q(el, 'search') as HTMLButtonElement).disabled).toBe(false);
    expect(q(el, 'reason').textContent).toBe('No area or dates set — showing the first 50 matches.');
    actions.setAoi(BOX);
    expect(q(el, 'reason').hidden).toBe(true);
    await actions.loadFields();
    actions.addFilterRow();
    actions.updateFilterRow(store.get().filterRows[0].id, { value: 'x' });
    expect(q(el, 'reason').textContent).toBe('Fix the filters above to search.');
    expect((q(el, 'search') as HTMLButtonElement).disabled).toBe(true);
  });

  it('closed sections show a summary and badge', () => {
    const { el, store, actions } = setupView();
    mountPanel(el, store, actions);
    actions.setQuery({ collections: ['c1', 'c2'], datetime: { from: '2024-07-01T00:00:00Z' } });
    actions.setAoi(BOX);
    for (const id of ['collections', 'dates', 'aoi'] as const) actions.toggleSection(id);
    const sum = (id: string) => el.querySelector(`[data-panel-section="${id}"] .jstex-section__sum`)!.textContent;
    expect(sum('collections')).toBe('c1, c2');
    expect(sum('dates')).toBe('2024-07-01 → open');
    expect(sum('aoi')).toBe('Polygon · 8,666 km²');
    expect(el.querySelector('[data-panel-section="collections"] .jstex-badge')!.textContent).toBe('2');
    (el.querySelector('[data-toggle-section="dates"]') as HTMLElement).click();
    expect(store.get().sections.dates).toBe(true);
  });

  it('collapses to a rail with badges; a rail icon re-opens its section', () => {
    const { el, store, actions, model } = setupView();
    mountPanel(el, store, actions);
    actions.setQuery({ collections: ['c1'] });
    actions.toggleSection('filters');
    q(el, 'collapse').click();
    expect(q(el, 'panel').hidden).toBe(true);
    expect(q(el, 'rail').hidden).toBe(false);
    expect(model.values.panel_collapsed).toBe(true);
    const railColl = el.querySelector('[data-rail="collections"]') as HTMLElement;
    expect(railColl.title).toBe('Collections: c1');
    expect(railColl.querySelector('sup')!.textContent).toBe('1');
    (el.querySelector('[data-rail="filters"]') as HTMLElement).click();
    expect(q(el, 'panel').hidden).toBe(false);
    expect(store.get().sections.filters).toBe(true);
    (el.querySelector('[data-rail="search"]') as HTMLElement).click();
    expect(actions.search).toHaveBeenCalled();
  });

  it('sign-in line, cancel and error banner follow state', () => {
    const { el, store, actions } = setupView();
    mountPanel(el, store, actions);
    store.set({ collectionsLoading: false, authSource: 'anonymous' });
    expect(q(el, 'authText').textContent).toBe('Not signed in — restricted collections are hidden.');
    store.set({ authSource: 'hub' });
    expect(q(el, 'authText').textContent).toBe('Signed in — restricted collections included.');
    store.set({ status: 'searching', canCancel: true, error: 'Rate limited' });
    expect(q(el, 'cancel').hidden).toBe(false);
    expect(q(el, 'errorText').textContent).toBe('Rate limited');
    q(el, 'retry').click();
    expect(actions.search).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `jlpm vitest run js/__tests__/panel.test.ts`
Expected: FAIL — `Failed to resolve import "../ui/panel"`.

- [ ] **Step 3: Implement** — `js/ui/panel.ts`:

```ts
/**
 * Search panel (layout A): collapsible sections — Collections, Dates (UTC),
 * Area of interest, Filters — scrolling inside a panel as tall as the map,
 * with Search pinned at the bottom. Collapses (only when the user asks) to a
 * rail of icons with badges; a rail icon re-opens the panel at its section.
 */
import type { Actions } from '../actions';
import { escapeHtml } from '../format';
import { filterSummary } from '../filters';
import { ICON } from '../icons';
import type { Store } from '../store';
import { S } from '../strings';
import type { ExplorerState, SectionId } from '../types';
import { aoiSummary, mountAoiSection } from './aoi-section';
import { mountCollections } from './collections';
import { datesSummary, mountDates } from './dates';
import { mountFiltersSection } from './filters-section';
import { createSection } from './section';

/** Why Search is disabled ('' = enabled). */
export function searchBlocker(s: ExplorerState): string {
  if (!s.query.collections.length) return S.needCollection;
  if (s.filterRows.some((r) => r.error)) return S.fixFilters;
  return '';
}

export function mountPanel(el: HTMLElement, store: Store<ExplorerState>, actions: Actions): () => void {
  el.innerHTML = `
    <div class="jstex-panel" data-ref="panel">
      <div class="jstex-panel__scroll" data-ref="scroll"></div>
      <div class="jstex-panel__foot">
        <div class="jstex-row">
          <button type="button" class="jstex-control jstex-primary jstex-grow" data-ref="search">${ICON.search}<span>${escapeHtml(S.search)}</span></button>
          <button type="button" class="jstex-control" data-ref="cancel">${escapeHtml(S.cancel)}</button>
        </div>
        <div class="jstex-hint" data-ref="reason"></div>
        <div class="jstex-hint jstex-hint--icon" data-ref="auth">${ICON.info}<span data-ref="authText"></span></div>
        <div class="jstex-error" role="alert" data-ref="errorBanner">
          <span data-ref="errorText"></span>
          <button type="button" class="jstex-control" data-ref="retry">${escapeHtml(S.retry)}</button>
          <button type="button" class="jstex-icon" data-ref="dismiss" title="${escapeHtml(S.dismiss)}" aria-label="${escapeHtml(S.dismiss)}">${ICON.close}</button>
        </div>
      </div>
      <button type="button" class="jstex-panel__collapse" data-ref="collapse" title="${escapeHtml(S.collapsePanel)}" aria-label="${escapeHtml(S.collapsePanel)}">${ICON.chevronLeft}</button>
    </div>
    <div class="jstex-rail" data-ref="rail">
      <button type="button" class="jstex-icon" data-rail="expand" title="${escapeHtml(S.expandPanel)}" aria-label="${escapeHtml(S.expandPanel)}">${ICON.chevronRight}</button>
      <button type="button" class="jstex-icon" data-rail="collections" aria-label="${escapeHtml(S.collections)}">${ICON.layers}<sup></sup></button>
      <button type="button" class="jstex-icon" data-rail="dates" aria-label="${escapeHtml(S.dates)}">${ICON.calendar}<sup></sup></button>
      <button type="button" class="jstex-icon" data-rail="aoi" aria-label="${escapeHtml(S.aoi)}">${ICON.polygon}<sup></sup></button>
      <button type="button" class="jstex-icon" data-rail="filters" aria-label="${escapeHtml(S.filters)}">${ICON.filter}<sup></sup></button>
      <button type="button" class="jstex-icon jstex-primary" data-rail="search" title="${escapeHtml(S.search)}" aria-label="${escapeHtml(S.search)}">${ICON.search}</button>
    </div>`;
  const ref = <T extends HTMLElement = HTMLElement>(name: string) => el.querySelector(`[data-ref="${name}"]`) as T;
  const scroll = ref('scroll');

  const sections = {
    collections: createSection('collections', S.collections),
    dates: createSection('dates', S.dates, S.utc),
    aoi: createSection('aoi', S.aoi),
    filters: createSection('filters', S.filters),
  };
  Object.values(sections).forEach((sec) => scroll.appendChild(sec.el));
  const cleanups = [
    mountCollections(sections.collections.body, store, actions),
    mountDates(sections.dates.body, store, actions),
    mountAoiSection(sections.aoi.body, store, actions),
    mountFiltersSection(sections.filters.body, store, actions),
  ];

  const summaries = (s: ExplorerState): Record<SectionId, [string, string]> => ({
    collections: [s.query.collections.join(', '), s.query.collections.length ? String(s.query.collections.length) : ''],
    dates: [datesSummary(s.query.datetime), s.query.datetime ? '•' : ''],
    aoi: [aoiSummary(s.query.aois.find((a) => a.selected)?.geometry), s.query.aois.length ? '•' : ''],
    filters: [filterSummary(s.query.filters, s.fields), s.query.filters.length ? String(s.query.filters.length) : ''],
  });

  const update = (s: ExplorerState) => {
    const sum = summaries(s);
    (Object.keys(sections) as SectionId[]).forEach((id) => {
      sections[id].update(s.sections[id], sum[id][0], sum[id][1]);
      const railBtn = el.querySelector<HTMLElement>(`[data-rail="${id}"]`)!;
      railBtn.title = sum[id][0] ? `${railBtn.getAttribute('aria-label')}: ${sum[id][0]}` : railBtn.getAttribute('aria-label')!;
      railBtn.querySelector('sup')!.textContent = sum[id][1];
    });
    ref('panel').hidden = s.panelCollapsed;
    ref('rail').hidden = !s.panelCollapsed;

    const searching = s.status === 'searching';
    const blocker = searchBlocker(s);
    const hasArea = s.query.aois.some((a) => a.selected);
    const hasDates = Boolean(s.query.datetime?.from || s.query.datetime?.to);
    ref<HTMLButtonElement>('search').disabled = Boolean(blocker) || searching;
    el.querySelector<HTMLButtonElement>('[data-rail="search"]')!.disabled = Boolean(blocker) || searching;
    ref('search').classList.toggle('jstex-busy', searching);
    ref('cancel').hidden = !(searching && s.canCancel);
    const reason = blocker || (!hasArea && !hasDates ? S.noConstraint(s.query.pageSize) : '');
    ref('reason').textContent = reason;
    ref('reason').hidden = !reason;
    ref('reason').classList.toggle('jstex-hint--warn', Boolean(reason));
    ref('auth').hidden = s.collectionsLoading;
    ref('auth').title = s.authSource === 'anonymous' ? S.anonymousHint : '';
    ref('authText').textContent = s.authSource === 'anonymous' ? S.anonymousNote : S.signedIn;
    ref('errorBanner').hidden = !s.error;
    ref('errorText').textContent = s.error;
  };

  el.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const head = target.closest<HTMLElement>('[data-toggle-section]');
    if (head) {
      actions.toggleSection(head.dataset.toggleSection as SectionId);
      return;
    }
    const rail = target.closest<HTMLElement>('[data-rail]');
    if (!rail) return;
    const what = rail.dataset.rail!;
    if (what === 'search') {
      actions.search();
      return;
    }
    actions.setPanelCollapsed(false);
    if (what !== 'expand') {
      const id = what as SectionId;
      if (!store.get().sections[id]) actions.toggleSection(id);
      sections[id].el.scrollIntoView?.({ block: 'nearest' });
    }
  });
  ref('search').addEventListener('click', () => actions.search());
  ref('cancel').addEventListener('click', () => actions.cancel());
  ref('retry').addEventListener('click', () => actions.search());
  ref('dismiss').addEventListener('click', () => actions.dismissError());
  ref('collapse').addEventListener('click', () => actions.setPanelCollapsed(true));

  update(store.get());
  const unsubscribe = store.subscribe(update);
  return () => {
    unsubscribe();
    cleanups.forEach((fn) => fn());
  };
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `jlpm vitest run && npx tsc -p js/tsconfig.json`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
jlpm prettier --write "js/**/*.ts"
git add js/ui/panel.ts js/__tests__/panel.test.ts
git commit -m "feat(js): search panel shell with pinned Search, sign-in line and collapsible rail"
```

---

### Task 13: Results table view

**Files:**
- Create: `js/ui/results.ts`
- Test: `js/__tests__/results.test.ts`

**Interfaces:**
- Consumes: `Store<ExplorerState>`, `Actions` (Task 8), helpers named in the imports below.
- Produces: `mountResults(el: HTMLElement, store: Store<ExplorerState>, actions) -> () => void` (returns an unsubscribe/cleanup). Table with its own scroll area and sticky header; Cloud % column only when items carry `eo:cloud_cover`; row click → `activate`, checkbox → `toggleSelected`; when `activeId` changes from elsewhere (map click) the row scrolls into view inside the table only.

- [ ] **Step 1: Write the failing test**

`js/__tests__/results.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { mountResults } from '../ui/results';
import { byRef as q, item, setupView as setup } from './helpers';

describe('results', () => {
  it('renders rows, cloud column, counts; row click activates, checkbox toggles', () => {
    const { el, store, actions } = setup();
    mountResults(el, store, actions);
    expect(q(el, 'empty').textContent).toBe('Run a search to see items.');
    store.set({ items: [item('a'), item('b', { properties: { datetime: '2024-01-01T00:00:00Z' } })], searched: true, matched: 40, selectedIds: ['b'] });
    const rows = el.querySelectorAll('tr[data-id]');
    expect(rows).toHaveLength(2);
    expect(el.querySelector('thead')!.textContent).toContain('Cloud %');
    expect(q(el, 'count').textContent).toBe('2 loaded · 1 selected · 40 matched');
    expect((rows[1].querySelector('input') as HTMLInputElement).checked).toBe(true);
    (rows[0].children[2] as HTMLElement).click();
    expect(actions.activate).toHaveBeenCalledWith('a');
    expect(rows[0].classList.contains('jstex-active')).toBe(true);
    (rows[1].querySelector('input') as HTMLInputElement).click();
    expect(actions.toggleSelected).toHaveBeenCalledWith('b');
  });

  it('says when nothing matched', () => {
    const { el, store, actions } = setup();
    mountResults(el, store, actions);
    store.set({ items: [], searched: true });
    expect(q(el, 'empty').textContent).toBe('No items match this query.');
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `jlpm vitest run js/__tests__/results.test.ts`
Expected: FAIL — `Failed to resolve import "../ui/results"`.

- [ ] **Step 3: Implement**

`js/ui/results.ts`:

```ts
/** Results table: own scroll area, sticky header, checkbox + row activation. */
import type { Actions } from '../actions';
import { cloudCover, escapeHtml, formatItemDate, shortId } from '../format';
import { scrollWithin } from '../selection';
import type { Store } from '../store';
import { S } from '../strings';
import type { ExplorerState } from '../types';

type ResultsActions = Pick<Actions, 'activate' | 'toggleSelected'>;

export function mountResults(el: HTMLElement, store: Store<ExplorerState>, actions: ResultsActions): () => void {
  el.innerHTML = `
    <div class="jstex-results">
      <div class="jstex-results__head"><strong>${escapeHtml(S.results)}</strong> <span class="jstex-muted" data-ref="count"></span></div>
      <div class="jstex-results__scroll" data-ref="scroll">
        <table class="jstex-table">
          <thead data-ref="head"></thead>
          <tbody data-ref="body"></tbody>
        </table>
        <div class="jstex-muted jstex-empty" data-ref="empty"></div>
      </div>
    </div>`;
  const ref = <T extends HTMLElement = HTMLElement>(name: string) => el.querySelector(`[data-ref="${name}"]`) as T;
  const scroll = ref('scroll');
  const body = ref('body');

  const renderRows = (state: ExplorerState) => {
    const withCloud = state.items.some((i) => cloudCover(i) !== undefined);
    ref('head').innerHTML = `<tr><th></th><th>${S.colId}</th><th>${S.colDatetime}</th><th>${S.colCollection}</th>${
      withCloud ? `<th class="jstex-num">${S.colCloud}</th>` : ''
    }</tr>`;
    body.innerHTML = state.items
      .map((item) => {
        const cc = cloudCover(item);
        return `<tr data-id="${escapeHtml(item.id)}">
          <td><input type="checkbox" data-toggle="${escapeHtml(item.id)}" aria-label="${escapeHtml(S.select)}"></td>
          <td class="jstex-mono" title="${escapeHtml(item.id)}">${escapeHtml(shortId(item.id))}</td>
          <td>${escapeHtml(formatItemDate(item))}</td>
          <td>${escapeHtml(item.collection ?? '')}</td>
          ${withCloud ? `<td class="jstex-num">${cc === undefined ? '' : cc.toFixed(1)}</td>` : ''}
        </tr>`;
      })
      .join('');
  };

  const update = (state: ExplorerState, prev: ExplorerState | null) => {
    if (!prev || prev.items !== state.items) renderRows(state);
    const selected = new Set(state.selectedIds);
    body.querySelectorAll<HTMLTableRowElement>('tr[data-id]').forEach((tr) => {
      const id = tr.dataset.id!;
      tr.classList.toggle('jstex-active', id === state.activeId);
      (tr.querySelector('input[data-toggle]') as HTMLInputElement).checked = selected.has(id);
    });
    const parts = [S.loaded(state.items.length), S.selected(state.selectedIds.length)];
    if (state.matched !== null) parts.push(S.matched(state.matched));
    ref('count').textContent = state.searched ? parts.join(' · ') : '';
    const empty = ref('empty');
    empty.textContent =
      state.status === 'searching' ? S.resultsSearching : !state.searched ? S.resultsIdle : state.items.length ? '' : S.resultsNone;
    empty.hidden = empty.textContent === '';
    if (state.activeId && prev && prev.activeId !== state.activeId) {
      const row = [...body.querySelectorAll<HTMLElement>('tr[data-id]')].find((tr) => tr.dataset.id === state.activeId);
      if (row) scrollWithin(scroll, row, ref('head').getBoundingClientRect().height);
    }
  };

  body.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const toggle = target.closest<HTMLInputElement>('input[data-toggle]');
    if (toggle) {
      actions.toggleSelected(toggle.dataset.toggle!);
      return;
    }
    const row = target.closest<HTMLTableRowElement>('tr[data-id]');
    if (row) actions.activate(row.dataset.id!);
  });

  update(store.get(), null);
  return store.subscribe(update);
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `jlpm vitest run && npx tsc -p js/tsconfig.json`
Expected: all PASS, no tsc output.

- [ ] **Step 5: Commit**

```bash
jlpm prettier --write "js/**/*.ts"
git add js/ui/results.ts js/__tests__/results.test.ts
git commit -m "feat(js): results table with selection and in-table scrolling"
```

---

### Task 14: Item details view

**Files:**
- Create: `js/ui/details.ts`
- Test: `js/__tests__/details.test.ts`

**Interfaces:**
- Consumes: `Store<ExplorerState>`, `Actions` (Task 8), helpers named in the imports below.
- Produces: `mountDetails(el: HTMLElement, store: Store<ExplorerState>, actions) -> () => void` (returns an unsubscribe/cleanup). Header copy actions (self link, id, Python snippet), Prev/Next, Properties (collapsed) / Assets / Links (expanded) with a copy button per value/href incl. `alternate` hrefs; section open state kept in the closure (the DOM is rebuilt on every item change).

- [ ] **Step 1: Write the failing test**

`js/__tests__/details.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { mountDetails } from '../ui/details';
import { item, setupView as setup } from './helpers';

describe('details', () => {
  it('renders copy targets, sections and navigates', () => {
    const { el, store, actions } = setup();
    mountDetails(el, store, actions);
    expect(el.textContent).toContain('Click a result');
    const a = item('a', {
      assets: { B04: { href: 'https://x/B04.jp2', type: 'image/jp2', alternate: { s3: { href: 's3://eodata/B04.jp2' } } } },
    });
    store.set({ items: [a, item('b')], activeId: 'a' });
    const copies = [...el.querySelectorAll<HTMLButtonElement>('[data-copy]')].map((b) => b.dataset.copy);
    expect(copies).toContain('https://stac.test/v1/collections/sentinel-2-l2a/items/a');
    expect(copies).toContain('a');
    expect(copies).toContain('import jstex\n\nitem = jstex.item("https://stac.test/v1/collections/sentinel-2-l2a/items/a")');
    expect(copies).toContain('https://x/B04.jp2');
    expect(copies).toContain('s3://eodata/B04.jp2');
    expect(copies).toContain('4.12');
    const sections = el.querySelectorAll<HTMLDetailsElement>('details[data-section]');
    expect([...sections].map((d) => d.open)).toEqual([false, true, true]);
    (el.querySelector('button[data-nav="1"]') as HTMLButtonElement).click();
    expect(actions.activate).toHaveBeenCalledWith('b');
    expect((el.querySelector('button[data-nav="1"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('remembers opened sections across re-render', () => {
    const { el, store, actions } = setup();
    mountDetails(el, store, actions);
    store.set({ items: [item('a'), item('b')], activeId: 'a' });
    const props = el.querySelector<HTMLDetailsElement>('details[data-section="properties"]')!;
    props.open = true;
    props.dispatchEvent(new Event('toggle'));
    store.set({ activeId: 'b' });
    expect(el.querySelector<HTMLDetailsElement>('details[data-section="properties"]')!.open).toBe(true);
  });

  it('omits self-link actions when the item has no self link', () => {
    const { el, store, actions } = setup();
    mountDetails(el, store, actions);
    store.set({ items: [item('a', { links: [] })], activeId: 'a' });
    expect(el.textContent).not.toContain('Copy self link');
    expect(el.textContent).toContain('Copy id');
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `jlpm vitest run js/__tests__/details.test.ts`
Expected: FAIL — `Failed to resolve import "../ui/details"`.

- [ ] **Step 3: Implement**

`js/ui/details.ts`:

```ts
/** Item details: header copy actions, Prev/Next, Properties / Assets / Links. */
import type { Actions } from '../actions';
import { copyText } from '../clipboard';
import { escapeHtml, formatItemDate, formatValue, selfHref } from '../format';
import { neighbour } from '../selection';
import { pythonItemSnippet } from '../snippets';
import type { Store } from '../store';
import { S } from '../strings';
import type { ExplorerState, StacAsset, StacItem } from '../types';

type DetailsActions = Pick<Actions, 'activate'>;
type Section = 'properties' | 'assets' | 'links';

const copyBtn = (text: string, label = S.copy) =>
  `<button type="button" class="jstex-copy" data-copy="${escapeHtml(text)}">${escapeHtml(label)}</button>`;

function assetRow(key: string, a: StacAsset): string {
  const meta = [a.title, a.type, a.roles?.join(', ')].filter(Boolean).map((x) => escapeHtml(x)).join(' · ');
  const alternates = Object.entries(a.alternate ?? {})
    .filter(([, alt]) => alt?.href)
    .map(
      ([name, alt]) =>
        `<div class="jstex-href"><span class="jstex-muted">${escapeHtml(name)}:</span> <span class="jstex-mono">${escapeHtml(alt.href!)}</span> ${copyBtn(alt.href!)}</div>`,
    )
    .join('');
  return `<tr><td class="jstex-mono">${escapeHtml(key)}</td><td>${meta}</td>
    <td><div class="jstex-href"><span class="jstex-mono">${escapeHtml(a.href)}</span> ${copyBtn(a.href)}</div>${alternates}</td></tr>`;
}

function renderItem(item: StacItem, index: number, total: number, open: Record<Section, boolean>): string {
  const self = selfHref(item);
  const props = Object.keys(item.properties ?? {}).sort();
  const assets = Object.entries(item.assets ?? {});
  const links = item.links ?? [];
  const sec = (name: Section, title: string, n: number, rows: string) =>
    `<details class="jstex-sec" data-section="${name}"${open[name] ? ' open' : ''}>
      <summary>${escapeHtml(title)} (${n})</summary><table class="jstex-table jstex-kv">${rows}</table></details>`;
  return `
    <div class="jstex-details__nav">
      <strong>${escapeHtml(S.details)}</strong>
      <button type="button" data-nav="-1"${index === 0 ? ' disabled' : ''}>${escapeHtml(S.prev)}</button>
      <span class="jstex-muted">${index + 1} / ${total}</span>
      <button type="button" data-nav="1"${index === total - 1 ? ' disabled' : ''}>${escapeHtml(S.next)}</button>
      <span class="jstex-toast" data-ref="toast" hidden></span>
    </div>
    <h3 class="jstex-mono jstex-details__id">${escapeHtml(item.id)}</h3>
    <div class="jstex-muted">${escapeHtml(item.collection ?? '')} · ${escapeHtml(formatItemDate(item))}</div>
    <div class="jstex-details__actions">
      ${self ? copyBtn(self, S.copySelf) : ''}${copyBtn(item.id, S.copyId)}${self ? copyBtn(pythonItemSnippet(self), S.copyPython) : ''}
    </div>
    <p class="jstex-hint">${escapeHtml(S.pythonHint)}</p>
    ${sec(
      'properties',
      S.properties,
      props.length,
      props
        .map((k) => {
          const v = formatValue(item.properties[k]);
          return `<tr><td class="jstex-mono">${escapeHtml(k)}</td><td class="jstex-val">${escapeHtml(v)}</td><td>${copyBtn(v)}</td></tr>`;
        })
        .join(''),
    )}
    ${sec('assets', S.assets, assets.length, assets.map(([k, a]) => assetRow(k, a)).join(''))}
    ${sec(
      'links',
      S.links,
      links.length,
      links
        .map(
          (l) =>
            `<tr><td class="jstex-mono">${escapeHtml(l.rel)}</td><td><div class="jstex-href"><span class="jstex-mono">${escapeHtml(l.href)}</span> ${copyBtn(l.href)}</div></td></tr>`,
        )
        .join(''),
    )}`;
}

export function mountDetails(el: HTMLElement, store: Store<ExplorerState>, actions: DetailsActions): () => void {
  // Open/closed state of the sections lives here, not in the DOM: render() rebuilds it.
  const open: Record<Section, boolean> = { properties: false, assets: true, links: true };
  el.innerHTML = '<section class="jstex-details" data-ref="root"></section>';
  const root = el.querySelector('[data-ref="root"]') as HTMLElement;

  const update = (state: ExplorerState, prev: ExplorerState | null) => {
    if (prev && prev.activeId === state.activeId && prev.items === state.items) return;
    const index = state.items.findIndex((i) => i.id === state.activeId);
    root.innerHTML =
      index === -1
        ? `<p class="jstex-muted">${escapeHtml(S.detailsEmpty)}</p>`
        : renderItem(state.items[index], index, state.items.length, open);
  };

  root.addEventListener(
    'toggle',
    (e) => {
      const d = e.target as HTMLDetailsElement;
      const name = d.dataset?.section as Section | undefined;
      if (name) open[name] = d.open;
    },
    true,
  );
  root.addEventListener('click', async (e) => {
    const target = e.target as HTMLElement;
    const nav = target.closest<HTMLButtonElement>('button[data-nav]');
    if (nav) {
      const { items, activeId } = store.get();
      const id = neighbour(items, activeId, Number(nav.dataset.nav) as 1 | -1);
      if (id) actions.activate(id);
      return;
    }
    const copy = target.closest<HTMLButtonElement>('button[data-copy]');
    if (copy) {
      const ok = await copyText(copy.dataset.copy ?? '');
      const toast = root.querySelector<HTMLElement>('[data-ref="toast"]');
      if (toast) {
        toast.textContent = ok ? S.copied : S.copyFailed;
        toast.hidden = false;
        setTimeout(() => (toast.hidden = true), 1200);
      }
    }
  });

  update(store.get(), null);
  return store.subscribe(update);
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `jlpm vitest run && npx tsc -p js/tsconfig.json`
Expected: all PASS, no tsc output.

- [ ] **Step 5: Commit**

```bash
jlpm prettier --write "js/**/*.ts"
git add js/ui/details.ts js/__tests__/details.test.ts
git commit -m "feat(js): item details with copy targets and prev/next"
```

---

### Task 15: Map view, widget assembly (layout A), styles, and e2e against a fake STAC API

**Files:**
- Create: `js/ui/map.ts`, `js/ui/footprint-popup.ts`, `ui-tests/fake_stac.py`, `ui-tests/tests/explorer.spec.ts`, `ui-tests/tests/area.geojson`
- Modify: `js/widget.ts` (replace the Task 2 stub), `js/styles.css` (replace the stub), `ui-tests/playwright.config.js`
- Test: `js/__tests__/map.test.ts`, `js/__tests__/footprint-popup.test.ts`, `ui-tests/tests/explorer.spec.ts`

**Interfaces:**
- Consumes: everything from Tasks 7–14 (the panel from Task 12).
- Produces: `mountMap(el, store, actions) -> () => void`, `polygonFromDrawDetail(detail) -> AoiGeometry | null`; `createFootprintPopup(wrap, onPick) -> { show(pixel, items, activeId), close(), isOpen() }`, `popupHtml(items, activeId)`, `popupPosition(pixel, size, container)`; the finished anywidget `render`.

- [ ] **Step 1: Write the failing unit test** (draw-event parsing is the only pure part of the map view):

`js/__tests__/map.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { polygonFromDrawDetail } from '../ui/map';

const box: GeoJSON.Polygon = { type: 'Polygon', coordinates: [[[10, 45], [11, 45], [11, 46], [10, 46], [10, 45]]] };

describe('polygonFromDrawDetail', () => {
  it('reads the last polygon of a FeatureCollection', () => {
    const fc = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} },
        { type: 'Feature', geometry: box, properties: {} },
      ],
    };
    expect(polygonFromDrawDetail(fc)).toEqual(box);
  });

  it('accepts arrays of features or JSON strings', () => {
    expect(polygonFromDrawDetail([JSON.stringify({ type: 'Feature', geometry: box })])).toEqual(box);
    expect(polygonFromDrawDetail(['not json'])).toBeNull();
  });

  it('returns null for the empty update fired by discardDrawing()', () => {
    expect(polygonFromDrawDetail({ type: 'FeatureCollection', features: [] })).toBeNull();
    expect(polygonFromDrawDetail(null)).toBeNull();
  });
});
```

Run: `jlpm vitest run js/__tests__/map.test.ts` → FAIL (`Failed to resolve import "../ui/map"`).

- [ ] **Step 1b: Overlapping-footprints popup (test first)** — same behaviour as STEX's footprint popup (user decision 2026-09-30): a click on stacked footprints lists every item under the point; picking one opens its details. Thumbnails are deliberately left for a later stage. `js/__tests__/footprint-popup.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createFootprintPopup, popupHtml, popupPosition } from '../ui/footprint-popup';
import { item } from './helpers';

describe('footprint popup', () => {
  it('lists every overlapping item and marks the active one', () => {
    const html = popupHtml([item('a'), item('b')], 'b');
    const div = document.createElement('div');
    div.innerHTML = html;
    expect(div.querySelector('strong')!.textContent).toBe('2 overlapping items');
    expect([...div.querySelectorAll<HTMLElement>('[data-id]')].map((b) => b.dataset.id)).toEqual(['a', 'b']);
    expect(div.querySelector('[data-id="b"]')!.classList.contains('jstex-active')).toBe(true);
    expect(div.textContent).toContain('☁ 4.1%');
  });

  it('positions below the click, flips above near the bottom, stays inside', () => {
    const size = { width: 300, height: 150 };
    const box = { width: 800, height: 450 };
    expect(popupPosition([400, 100], size, box)).toEqual({ left: 250, top: 112 });
    expect(popupPosition([400, 400], size, box)).toEqual({ left: 250, top: 238 });
    expect(popupPosition([10, 10], size, box).left).toBe(8);
    expect(popupPosition([790, 10], size, box).left).toBe(492);
  });

  it('picking a row activates it and closes; Escape and outside clicks close', async () => {
    const wrap = document.createElement('div');
    document.body.appendChild(wrap);
    const onPick = vi.fn();
    const popup = createFootprintPopup(wrap, onPick);
    popup.show([100, 100], [item('a'), item('b')], null);
    (wrap.querySelector('[data-id="b"]') as HTMLElement).click();
    expect(onPick).toHaveBeenCalledWith('b');
    expect(popup.isOpen()).toBe(false);

    popup.show([100, 100], [item('a'), item('b')], null);
    await new Promise((r) => setTimeout(r, 0));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(popup.isOpen()).toBe(false);

    popup.show([100, 100], [item('a'), item('b')], null);
    await new Promise((r) => setTimeout(r, 0));
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(popup.isOpen()).toBe(false);
  });
});
```

Run `jlpm vitest run js/__tests__/footprint-popup.test.ts` → FAIL (`Failed to resolve import "../ui/footprint-popup"`). Then create `js/ui/footprint-popup.ts` (a plain DOM element positioned inside the map wrapper — not an OL overlay, which renders inside eox-map's shadow DOM where the widget CSS does not apply):

```ts
/**
 * List of items whose footprints overlap a clicked map point — same behaviour
 * as STEX's footprint popup. A plain DOM element absolutely positioned in the
 * map wrapper (not an OL overlay: that renders inside eox-map's shadow DOM).
 */
import { cloudCover, escapeHtml, formatItemDate, shortId } from '../format';
import { S } from '../strings';
import type { StacItem } from '../types';

export function popupHtml(items: StacItem[], activeId: string | null): string {
  const rows = items
    .map((item) => {
      const cc = cloudCover(item);
      const meta = [formatItemDate(item), item.collection, cc === undefined ? '' : `☁ ${cc.toFixed(1)}%`]
        .filter(Boolean)
        .map((x) => escapeHtml(x))
        .join(' · ');
      return `<li><button type="button" class="jstex-fp__item${item.id === activeId ? ' jstex-active' : ''}" data-id="${escapeHtml(item.id)}">
        <span class="jstex-mono" title="${escapeHtml(item.id)}">${escapeHtml(shortId(item.id, 44))}</span>
        <span class="jstex-muted">${meta}</span></button></li>`;
    })
    .join('');
  return `<div class="jstex-fp__head"><strong>${escapeHtml(S.overlapping(items.length))}</strong>
      <button type="button" class="jstex-icon" data-close aria-label="${escapeHtml(S.close)}" title="${escapeHtml(S.close)}">✕</button></div>
    <ul class="jstex-fp__list">${rows}</ul>`;
}

/** Below the click if it fits, else above; always inside the container with an 8 px margin. */
export function popupPosition(
  pixel: [number, number],
  size: { width: number; height: number },
  container: { width: number; height: number },
): { left: number; top: number } {
  const m = 8;
  const left = Math.max(m, Math.min(pixel[0] - size.width / 2, container.width - size.width - m));
  let top = pixel[1] + 12;
  if (top + size.height > container.height - m) top = pixel[1] - size.height - 12;
  return { left, top: Math.max(m, top) };
}

export interface FootprintPopup {
  show(pixel: [number, number], items: StacItem[], activeId: string | null): void;
  close(): void;
  isOpen(): boolean;
}

export function createFootprintPopup(wrap: HTMLElement, onPick: (id: string) => void): FootprintPopup {
  let el: HTMLElement | null = null;
  const onOutside = (e: Event) => {
    if (el && !el.contains(e.target as Node)) close();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };
  function close(): void {
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
    el?.remove();
    el = null;
  }
  function show(pixel: [number, number], items: StacItem[], activeId: string | null): void {
    close();
    el = document.createElement('div');
    el.className = 'jstex-fp';
    el.setAttribute('role', 'dialog');
    el.innerHTML = popupHtml(items, activeId);
    wrap.appendChild(el);
    const pos = popupPosition(
      pixel,
      { width: el.offsetWidth, height: el.offsetHeight },
      { width: wrap.clientWidth, height: wrap.clientHeight },
    );
    el.style.left = `${pos.left}px`;
    el.style.top = `${pos.top}px`;
    el.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('[data-close]')) return close();
      const row = target.closest<HTMLElement>('[data-id]');
      if (row) {
        onPick(row.dataset.id!);
        close();
      }
    });
    // Registered after this click finished, so the opening click does not close it.
    setTimeout(() => {
      document.addEventListener('pointerdown', onOutside, true);
      document.addEventListener('keydown', onKey, true);
    }, 0);
  }
  return { show, close, isOpen: () => el !== null };
}
```

Run it again → PASS.

- [ ] **Step 2: Implement the map view.** Notes: drawtools is bound to *this* view's `eox-map` element (`draw.for = map`), never a selector, so several explorers coexist; the AOI is rendered from state by the `aoi` layer and the drawn sketch is discarded; footprints use a near-transparent fill so stacked identical footprints do not turn opaque (STEX gotcha) while clicks inside polygons still hit.

`js/ui/map.ts`:

```ts
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
  on(event: 'singleclick', cb: (evt: { pixel: [number, number] }) => void): void;
  forEachFeatureAtPixel(pixel: [number, number], cb: (f: OlFeature) => void): void;
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
}

const FOOTPRINT_STYLE = {
  'stroke-color': '#2a7de1',
  'stroke-width': 1.5,
  // Near-transparent fill: keeps click hit-detection inside the polygon without
  // stacked identical footprints piling up into an opaque blue (STEX gotcha).
  'fill-color': 'rgba(42,125,225,0.004)',
};
const HIGHLIGHT_STYLE = { 'stroke-color': '#ff8225', 'stroke-width': 2.5, 'fill-color': 'rgba(255,130,37,0.2)' };
const AOI_STYLE = { 'stroke-color': '#0b7285', 'stroke-width': 2, 'stroke-line-dash': [6, 4], 'fill-color': 'rgba(11,114,133,0.06)' };

function vectorLayer(id: string, features: GeoJSON.Feature[], style: Record<string, unknown>): Record<string, unknown> {
  const fc: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features };
  return {
    type: 'Vector',
    properties: { id },
    source: { type: 'Vector', format: 'GeoJSON', url: 'data:,' + encodeURIComponent(JSON.stringify(fc)) },
    style,
  };
}

/** Polygon from a drawupdate detail (FeatureCollection in 'geojson' format, or feature array). */
export function polygonFromDrawDetail(detail: unknown): AoiGeometry | null {
  const d = detail as { type?: string; features?: GeoJSON.Feature[] } | unknown[] | null;
  const features: unknown[] = Array.isArray(d) ? d : d && d.type === 'FeatureCollection' ? (d.features ?? []) : [];
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

export function mountMap(el: HTMLElement, store: Store<ExplorerState>, actions: MapActions): () => void {
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
    vectorLayer('highlight', [], HIGHLIGHT_STYLE),
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
  draw.addEventListener('drawupdate', (e) => {
    const geometry = polygonFromDrawDetail((e as CustomEvent).detail);
    if (!geometry) return; // includes the empty update fired by discardDrawing()
    actions.setAoi(geometry); // one AOI: replaces the previous one, ends drawing
    draw.discardDrawing(); // the 'aoi' layer renders the AOI from state
  });

  const renderAoi = (s: ExplorerState) => {
    const features = s.query.aois
      .filter((a) => a.selected)
      .map((a) => ({ type: 'Feature' as const, geometry: a.geometry, properties: {} }));
    map.addOrUpdateLayer(vectorLayer('aoi', features, AOI_STYLE));
  };
  const renderFootprints = (s: ExplorerState) => {
    const features = itemFeatures(s.items);
    map.addOrUpdateLayer(vectorLayer('footprints', features, FOOTPRINT_STYLE));
    const box = unionBbox(features.map((f) => geometryBbox(f.geometry)));
    if (box) map.zoomExtent = bboxTo3857(box, 0.1);
  };
  const zoomToAoi = (s: ExplorerState) => {
    const aoi = s.query.aois.find((a) => a.selected);
    const box = aoi ? geometryBbox(aoi.geometry) : null;
    if (box) map.zoomExtent = bboxTo3857(box, 0.15);
  };
  const setDrawMode = (s: ExplorerState) => {
    tip.hidden = !s.drawMode;
    tip.textContent = s.drawMode === 'Box' ? S.drawBoxHint : s.drawMode === 'Polygon' ? S.drawPolygonHint : '';
    if (!s.drawMode) {
      draw.stopDrawing();
      return;
    }
    if (draw.type !== s.drawMode) draw.type = s.drawMode;
    draw.startDrawing();
  };
  const renderHighlight = (s: ExplorerState) => {
    const active = s.items.filter((i) => i.id === s.activeId);
    map.addOrUpdateLayer(vectorLayer('highlight', itemFeatures(active), HIGHLIGHT_STYLE));
  };

  const popup = createFootprintPopup(wrap, (id) => actions.activate(id));

  const unsubscribe = store.subscribe((s, prev) => {
    if (s.items !== prev.items || (s.drawMode && !prev.drawMode)) popup.close();
    if (s.query.aois !== prev.query.aois) renderAoi(s);
    if (s.items !== prev.items) renderFootprints(s);
    if (s.items !== prev.items || s.activeId !== prev.activeId) renderHighlight(s);
    if (s.drawMode !== prev.drawMode) setDrawMode(s);
    if (s.zoomToAoi !== prev.zoomToAoi) zoomToAoi(s);
    if (s.dark !== prev.dark || s.basemap !== prev.basemap) map.addOrUpdateLayer(basemapLayer(s.basemap, s.dark));
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
    ol.on('singleclick', (evt) => {
      const s = store.get();
      if (s.drawMode) return;
      const known = new Set(s.items.map((i) => i.id));
      const hits = new Set<string>();
      ol.forEachFeatureAtPixel(evt.pixel, (f) => {
        const id = f.get('id');
        if (typeof id === 'string' && known.has(id)) hits.add(id);
      });
      if (hits.size === 0) popup.close();
      else if (hits.size === 1) {
        popup.close();
        actions.activate([...hits][0]);
      } else {
        // Same as STEX: list every item under the click, in result order.
        popup.show(evt.pixel, s.items.filter((i) => hits.has(i.id)), s.activeId);
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
```

- [ ] **Step 3: Assemble the widget** (layout A: panel | map in `.jstex-body`, then results and details; filterable fields reload whenever the collection selection changes, also when Python sets `ex.query`) — replace `js/widget.ts`:

`js/widget.ts`:

```ts
/**
 * anywidget entry point. One render() = one independent view with its own
 * store; nothing is module-global, so several explorers (or several views of
 * one explorer) coexist in a notebook.
 *
 * Layout A: search panel | map (same height, drag-resizable together), then
 * results and item details below. Below ~760 px the panel stacks above the map.
 */
import './define-guard'; // must stay first: see define-guard.ts
import '@eox/map';
import '@eox/drawtools';
import type { RenderProps } from '@anywidget/types';
import { createActions } from './actions';
import { CommBackend } from './backend';
import { applyPage, bindModel, stateFromModel } from './model-sync';
import { createStore } from './store';
import { S } from './strings';
import { isDark, watchTheme } from './theme';
import type { MinimalModel } from './types';
import { mountDetails } from './ui/details';
import { mountMap } from './ui/map';
import { mountPanel } from './ui/panel';
import { mountResults } from './ui/results';
import './styles.css';

function render({ model, el }: RenderProps): () => void {
  const m = model as unknown as MinimalModel;

  const root = document.createElement('div');
  root.className = 'jstex';
  root.innerHTML = `
    <div class="jstex-body" data-ref="body">
      <div class="jstex-body__panel" data-slot="panel"></div>
      <div class="jstex-body__map" data-slot="map"></div>
    </div>
    <div data-slot="results"></div>
    <div data-slot="details"></div>`;
  el.appendChild(root);
  const slot = (name: string) => root.querySelector(`[data-slot="${name}"]`) as HTMLElement;
  const body = root.querySelector('[data-ref="body"]') as HTMLElement;

  const store = createStore({ ...stateFromModel(m), dark: isDark() });
  const backend = new CommBackend(m, { onPage: (msg) => applyPage(store, msg) });
  const actions = createActions(m, store, backend, S);

  const applyLayout = () => {
    const s = store.get();
    root.dataset.theme = s.dark ? 'dark' : 'light';
    body.style.setProperty('--jstex-h', `${s.mapHeight}px`);
    body.classList.toggle('jstex-body--collapsed', s.panelCollapsed);
  };
  applyLayout();
  const stopTheme = watchTheme(() => store.set({ dark: isDark() }));
  const unsubscribe = store.subscribe((s, prev) => {
    if (s.dark !== prev.dark || s.mapHeight !== prev.mapHeight || s.panelCollapsed !== prev.panelCollapsed) applyLayout();
    // Filterable fields follow the collection selection (also when Python sets ex.query).
    if (s.query.collections !== prev.query.collections) void actions.loadFields();
  });

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && store.get().drawMode) actions.setDrawMode(null);
  };
  root.addEventListener('keydown', onKey);

  const cleanups = [
    bindModel(m, store),
    mountPanel(slot('panel'), store, actions),
    mountMap(slot('map'), store, actions),
    mountResults(slot('results'), store, actions),
    mountDetails(slot('details'), store, actions),
  ];

  backend
    .listCollections()
    .then((collections) => store.set({ collections, collectionsLoading: false, collectionsError: '' }))
    .catch((err: Error) => {
      if (err.message !== 'disposed') store.set({ collectionsLoading: false, collectionsError: err.message });
    });
  if (store.get().query.collections.length) void actions.loadFields();
  backend.sync(); // a re-rendered view gets the kernel's current results

  return () => {
    root.removeEventListener('keydown', onKey);
    stopTheme();
    unsubscribe();
    cleanups.forEach((fn) => fn());
    backend.dispose();
    root.remove();
  };
}

export default { render };
```

- [ ] **Step 4: Styles** — replace `js/styles.css`:

`js/styles.css`:

```css
/* All jstex styles are scoped under .jstex. Colours come from JupyterLab's
   --jp-* variables, with fallbacks for VS Code / Colab / plain HTML. */
.jstex {
  --jstex-accent: #ff8225;
  --jstex-fg: var(--jp-ui-font-color1, #1f2328);
  --jstex-muted: var(--jp-ui-font-color2, #59636e);
  --jstex-bg: var(--jp-layout-color1, #ffffff);
  --jstex-bg2: var(--jp-layout-color2, #f6f8fa);
  --jstex-border: var(--jp-border-color2, #d1d9e0);
  /* --jp-*-color1 are mid-tones that read on both light and dark backgrounds
     (the color3 tints are light in both themes, so text on them vanishes in dark). */
  --jstex-error: var(--jp-error-color1, #d1242f);
  --jstex-warn: var(--jp-warn-color1, #d97706);
  --jstex-font: var(--jp-ui-font-family, system-ui, -apple-system, 'Segoe UI', sans-serif);
  --jstex-mono: var(--jp-code-font-family, ui-monospace, SFMono-Regular, Menlo, monospace);
  --jstex-size: var(--jp-ui-font-size1, 13px);
  --jstex-control-h: 30px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  color: var(--jstex-fg);
  background: var(--jstex-bg);
  font-family: var(--jstex-font);
  font-size: var(--jstex-size);
}
/* data-theme is set by widget.ts from the host theme (JupyterLab, VS Code,
   Colab, OS). Inside JupyterLab the --jp-* values win; these are fallbacks. */
.jstex[data-theme='dark'] {
  --jstex-fg: var(--jp-ui-font-color1, #e6edf3);
  --jstex-muted: var(--jp-ui-font-color2, #9198a1);
  --jstex-bg: var(--jp-layout-color1, #0d1117);
  --jstex-bg2: var(--jp-layout-color2, #151b23);
  --jstex-border: var(--jp-border-color2, #3d444d);
  color-scheme: dark;
}
.jstex [hidden] { display: none !important; }
.jstex button {
  font: inherit;
  color: inherit;
  background: var(--jstex-bg2);
  border: 1px solid var(--jstex-border);
  border-radius: 4px;
  padding: 3px 10px;
  cursor: pointer;
}
.jstex button:disabled { opacity: 0.5; cursor: default; }
.jstex button[aria-pressed='true'] { border-color: var(--jstex-accent); color: var(--jstex-accent); }
.jstex .jstex-primary { background: var(--jstex-accent); border-color: var(--jstex-accent); color: #fff; font-weight: 600; }
.jstex input[type='date'], .jstex input[type='search'] {
  font: inherit; color: inherit; background: var(--jstex-bg);
  border: 1px solid var(--jstex-border); border-radius: 4px; padding: 2px 6px;
}
.jstex .jstex-muted { color: var(--jstex-muted); }
.jstex .jstex-mono { font-family: var(--jstex-mono); }
.jstex .jstex-num { text-align: right; font-variant-numeric: tabular-nums; }

/* ── layout A: search panel | map (same height), results + details below ── */
.jstex { container-type: inline-size; }
.jstex .jstex-svg { width: 16px; height: 16px; flex: none; }
.jstex .jstex-muted { color: var(--jstex-muted); }
.jstex .jstex-small { font-size: 0.9em; }
.jstex .jstex-row { display: flex; align-items: center; gap: 6px; min-width: 0; }
.jstex .jstex-wrap { flex-wrap: wrap; }
.jstex .jstex-between { justify-content: space-between; }
.jstex .jstex-grow { flex: 1 1 0; min-width: 0; }
.jstex .jstex-body {
  display: grid; grid-template-columns: 300px minmax(0, 1fr); gap: 12px;
  height: var(--jstex-h, 600px); min-height: 320px; resize: vertical; overflow: hidden;
}
.jstex .jstex-body--collapsed { grid-template-columns: 44px minmax(0, 1fr); }
.jstex .jstex-body__panel { min-height: 0; display: flex; }
.jstex .jstex-body__map { min-height: 0; }
.jstex .jstex-body__map > .jstex-map-wrap { height: 100%; }

/* controls */
.jstex .jstex-control {
  display: inline-flex; align-items: center; gap: 6px; box-sizing: border-box;
  height: var(--jstex-control-h); padding: 0 10px; border-radius: 4px; min-width: 0;
}
.jstex input.jstex-control, .jstex select.jstex-control {
  padding: 0 6px; font: inherit; color: inherit; background: var(--jstex-bg); border: 1px solid var(--jstex-border);
}
.jstex .jstex-control[aria-pressed='true'] { border-color: var(--jstex-accent); color: var(--jstex-accent); }
.jstex .jstex-primary { justify-content: center; }
.jstex .jstex-primary.jstex-busy { opacity: 0.7; cursor: progress; }
.jstex .jstex-invalid { border-color: var(--jstex-error) !important; }
.jstex .jstex-icon {
  display: inline-flex; align-items: center; justify-content: center; flex: none;
  width: 28px; height: 28px; padding: 0; background: transparent; border-color: transparent; color: var(--jstex-muted);
}
.jstex .jstex-icon:hover { background: var(--jstex-bg2); border-color: var(--jstex-border); color: var(--jstex-fg); }
.jstex .jstex-icon.jstex-primary { color: #fff; background: var(--jstex-accent); border-color: var(--jstex-accent); }
.jstex .jstex-link {
  display: inline-flex; align-items: center; gap: 4px; padding: 2px 4px; border: 0; background: transparent; color: var(--jstex-accent); font-weight: 600;
}
.jstex .jstex-link:disabled { color: var(--jstex-muted); }
.jstex .jstex-hint { font-size: 0.92em; color: var(--jstex-muted); }
.jstex .jstex-hint--warn { color: var(--jstex-warn); }
.jstex .jstex-hint--err { color: var(--jstex-error); }
.jstex .jstex-hint--icon { display: flex; gap: 6px; align-items: center; }
.jstex .jstex-badge {
  background: var(--jstex-accent); color: #fff; border-radius: 9px; padding: 0 7px; font-size: 0.85em; font-weight: 700; line-height: 18px;
}
.jstex .jstex-chip {
  display: inline-flex; align-items: center; gap: 2px; max-width: 100%; height: 28px;
  padding-left: 10px; border: 1px solid var(--jstex-border); border-radius: 14px; background: var(--jstex-bg2); align-self: flex-start;
}
.jstex .jstex-chip__text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-variant-numeric: tabular-nums; }
.jstex .jstex-chip .jstex-icon { border-radius: 50%; width: 24px; height: 24px; }
.jstex .jstex-empty { padding: 8px; }

/* panel */
.jstex .jstex-panel {
  position: relative; flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px;
  border: 1px solid var(--jstex-border); border-radius: 6px; padding: 8px; background: var(--jstex-bg);
}
.jstex .jstex-panel__scroll { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 8px; padding-right: 2px; }
.jstex .jstex-panel__foot { display: flex; flex-direction: column; gap: 4px; border-top: 1px solid var(--jstex-border); padding-top: 8px; }
.jstex .jstex-panel__foot .jstex-primary { height: 32px; }
.jstex .jstex-panel__collapse {
  position: absolute; right: -13px; top: 50%; transform: translateY(-50%); z-index: 3;
  width: 14px; height: 44px; padding: 0; display: flex; align-items: center; justify-content: center;
  border: 1px solid var(--jstex-border); border-left: 0; border-radius: 0 6px 6px 0; background: var(--jstex-bg); color: var(--jstex-muted);
}
.jstex .jstex-panel__collapse .jstex-svg { width: 12px; height: 12px; }
.jstex .jstex-rail {
  flex: 1; display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 8px 0;
  border: 1px solid var(--jstex-border); border-radius: 6px; background: var(--jstex-bg2);
}
.jstex .jstex-rail .jstex-icon { position: relative; width: 32px; height: 32px; color: var(--jstex-fg); }
.jstex .jstex-rail sup:not(:empty) {
  position: absolute; right: -4px; top: -4px; min-width: 14px; line-height: 14px; border-radius: 7px; padding: 0 3px;
  background: var(--jstex-accent); color: #fff; font-size: 9px; font-weight: 700;
}
.jstex .jstex-rail .jstex-primary { margin-top: auto; color: #fff; }

/* sections */
.jstex .jstex-section { border: 1px solid var(--jstex-border); border-radius: 6px; flex: none; }
.jstex .jstex-section__head {
  width: 100%; display: flex; align-items: center; gap: 6px; padding: 6px 8px; border: 0; border-radius: 6px 6px 0 0;
  background: var(--jstex-bg2); font-weight: 600; text-align: left; cursor: pointer;
}
.jstex .jstex-section--closed .jstex-section__head { border-radius: 6px; }
.jstex .jstex-section__caret .jstex-svg { width: 12px; height: 12px; transition: transform 0.12s; transform: rotate(90deg); }
.jstex .jstex-section--closed .jstex-section__caret .jstex-svg { transform: none; }
.jstex .jstex-section__title { white-space: nowrap; }
.jstex .jstex-section__title .jstex-muted { font-weight: 400; }
.jstex .jstex-section__sum { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 400; color: var(--jstex-muted); }
.jstex .jstex-section__head .jstex-badge { margin-left: auto; }
.jstex .jstex-section__body { padding: 8px; display: flex; flex-direction: column; gap: 6px; border-top: 1px solid var(--jstex-border); }

/* collections */
.jstex .jstex-search-box {
  display: flex; align-items: center; gap: 6px; height: var(--jstex-control-h); padding: 0 8px;
  border: 1px solid var(--jstex-border); border-radius: 4px; background: var(--jstex-bg); color: var(--jstex-muted);
}
.jstex .jstex-search-box input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; font: inherit; color: var(--jstex-fg); }
.jstex .jstex-switch { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; color: var(--jstex-muted); }
.jstex .jstex-switch input { position: absolute; opacity: 0; width: 1px; height: 1px; }
.jstex .jstex-switch__track { position: relative; width: 26px; height: 14px; border-radius: 7px; background: var(--jstex-border); }
.jstex .jstex-switch__track::after {
  content: ''; position: absolute; left: 2px; top: 2px; width: 10px; height: 10px; border-radius: 50%; background: #fff; transition: left 0.12s;
}
.jstex .jstex-switch input:checked + .jstex-switch__track { background: var(--jstex-accent); }
.jstex .jstex-switch input:checked + .jstex-switch__track::after { left: 14px; }
.jstex .jstex-switch input:focus-visible + .jstex-switch__track { outline: 2px solid var(--jstex-accent); outline-offset: 1px; }
.jstex .jstex-coll-list { max-height: 220px; overflow: auto; border: 1px solid var(--jstex-border); border-radius: 4px; }
.jstex .jstex-coll { display: flex; align-items: flex-start; gap: 4px; padding: 4px 4px 4px 8px; border-bottom: 1px solid var(--jstex-border); }
.jstex .jstex-coll:last-child { border-bottom: 0; }
.jstex .jstex-coll--sel { background: color-mix(in srgb, var(--jstex-accent) 12%, transparent); }
.jstex .jstex-coll__main { flex: 1; min-width: 0; display: flex; gap: 8px; align-items: flex-start; cursor: pointer; padding: 2px 0; }
.jstex .jstex-coll__main input { margin: 2px 0 0; accent-color: var(--jstex-accent); flex: none; }
.jstex .jstex-coll__text { min-width: 0; display: flex; flex-direction: column; }
.jstex .jstex-coll__text .jstex-mono { font-size: 0.85em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.jstex .jstex-coll__info[aria-expanded='true'] { color: var(--jstex-accent); }
.jstex .jstex-coll__about {
  padding: 6px 8px 6px 30px; font-size: 0.9em; color: var(--jstex-muted);
  background: var(--jstex-bg2); border-bottom: 1px solid var(--jstex-border);
}
.jstex .jstex-coll__about p { margin: 0 0 4px; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }

/* filters */
.jstex .jstex-filter-rows { display: flex; flex-direction: column; gap: 6px; }
.jstex .jstex-filter { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(52px, 0.6fr) minmax(0, 1fr) auto; gap: 4px; align-items: center; }
.jstex .jstex-filter [data-err] { grid-column: 1 / -1; }

/* errors */
.jstex .jstex-error { display: flex; gap: 6px; align-items: center; background: var(--jstex-bg2); border-left: 3px solid var(--jstex-error); border-radius: 4px; padding: 4px 6px; }
.jstex .jstex-error span { flex: 1; }

/* drawing hint over the map */
.jstex .jstex-draw-tip {
  position: absolute; left: 50%; top: 10px; transform: translateX(-50%); z-index: 4; pointer-events: none;
  background: rgba(31, 35, 40, 0.85); color: #fff; border-radius: 14px; padding: 4px 12px; font-size: 0.92em; white-space: nowrap;
}

/* narrow cells: panel above the map; no rail (sections fold instead) */
@container (max-width: 760px) {
  .jstex .jstex-body, .jstex .jstex-body--collapsed { grid-template-columns: minmax(0, 1fr); height: auto; resize: none; overflow: visible; }
  .jstex .jstex-panel__scroll { overflow: visible; }
  .jstex .jstex-panel__collapse, .jstex .jstex-rail { display: none !important; }
  .jstex .jstex-body--collapsed .jstex-panel[hidden] { display: flex !important; }
  .jstex .jstex-body__map { height: var(--jstex-h, 600px); resize: vertical; overflow: hidden; }
}

/* map (the .jstex-body around panel + map is the resizable part) */
.jstex .jstex-map-wrap { position: relative; overflow: hidden; min-height: 200px; border: 1px solid var(--jstex-border); border-radius: 4px; }
.jstex .jstex-map { display: block; width: 100%; height: 100%; }

/* tables */
.jstex .jstex-table { width: 100%; border-collapse: collapse; }
.jstex .jstex-table th, .jstex .jstex-table td { padding: 3px 6px; border-bottom: 1px solid var(--jstex-border); text-align: left; vertical-align: top; }
.jstex .jstex-results__head { display: flex; gap: 8px; align-items: baseline; margin-bottom: 4px; }
.jstex .jstex-results__scroll { max-height: 250px; overflow: auto; border: 1px solid var(--jstex-border); border-radius: 4px; }
.jstex .jstex-results__scroll thead th { position: sticky; top: 0; background: var(--jstex-bg2); z-index: 1; }
.jstex .jstex-results__scroll tbody tr { cursor: pointer; }
.jstex .jstex-results__scroll tbody tr:hover { background: var(--jstex-bg2); }
.jstex .jstex-results__scroll tr.jstex-active { box-shadow: inset 3px 0 0 var(--jstex-accent); background: var(--jstex-bg2); }
.jstex .jstex-empty { padding: 8px; }

/* details */
.jstex .jstex-details__nav { display: flex; gap: 8px; align-items: center; }
.jstex .jstex-details__id { margin: 6px 0 2px; font-size: 1.05em; word-break: break-all; }
.jstex .jstex-details__actions { display: flex; flex-wrap: wrap; gap: 6px; margin: 6px 0; }
.jstex .jstex-hint { color: var(--jstex-muted); margin: 4px 0 8px; }
.jstex .jstex-sec { margin: 6px 0; }
.jstex .jstex-sec summary { cursor: pointer; font-weight: 600; padding: 2px 0; }
.jstex .jstex-kv td:first-child { white-space: nowrap; }
.jstex .jstex-val, .jstex .jstex-href .jstex-mono { word-break: break-all; }
.jstex .jstex-href { display: flex; gap: 6px; align-items: baseline; }
.jstex .jstex-copy { padding: 0 6px; font-size: 0.9em; }
.jstex .jstex-toast { color: var(--jstex-accent); }

/* footprint popup (overlapping items), same role as STEX's .stex-footprint-popup */
.jstex .jstex-fp {
  position: absolute; z-index: 20; width: min(380px, calc(100% - 16px));
  background: var(--jstex-bg); border: 1px solid var(--jstex-border); border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
}
.jstex .jstex-fp__head { display: flex; align-items: center; justify-content: space-between; padding: 6px 8px; border-bottom: 1px solid var(--jstex-border); }
.jstex .jstex-fp__list { list-style: none; margin: 0; padding: 4px; max-height: 220px; overflow: auto; }
.jstex .jstex-fp__item {
  display: flex; flex-direction: column; align-items: flex-start; gap: 2px; width: 100%;
  text-align: left; border: 0; background: transparent; padding: 4px 6px;
}
.jstex .jstex-fp__item:hover { background: var(--jstex-bg2); }
.jstex .jstex-fp__item.jstex-active { box-shadow: inset 3px 0 0 var(--jstex-accent); }
```

- [ ] **Step 5: Unit tests, typecheck, build**

Run: `jlpm vitest run && npx tsc -p js/tsconfig.json && jlpm build:widget && ls jstex/static`
Expected: all vitest PASS, no tsc output, `jstex/static` contains only `widget.js` and `widget.css`.

- [ ] **Step 6: Fake STAC API for e2e** — `ui-tests/fake_stac.py`: three collections with description / license / extent, queryables with a number, an enum and an integer field, three items with identical footprints (so the overlapping-items popup is testable), and `/__last_search` exposing the last request body:

```python
"""Tiny deterministic STAC API for the Galata e2e tests (stdlib only).

GET  /v1/collections                      -> three collections (with description / license / extent)
GET  /v1/collections/<id>/queryables      -> number, enum and integer fields
POST /v1/search                           -> three items with IDENTICAL footprints
GET  /v1/collections/<c>/items/<id>       -> one item
GET  /__last_search                       -> the last POST /v1/search body (for assertions)
"""

from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = 8765
BASE = f"http://127.0.0.1:{PORT}/v1/"
COLLECTION = "sentinel-2-l2a"
GEOMETRY = {"type": "Polygon", "coordinates": [[[10, 45], [11, 45], [11, 46], [10, 46], [10, 45]]]}
IDS = ["S2A_T32TPS_20240712", "S2B_T32TPS_20240717", "S2A_T32TPS_20240722"]
last_search: dict = {}
COLLECTIONS = [
    {
        "id": COLLECTION,
        "title": "Sentinel-2 L2A",
        "description": "Surface reflectance, 10-60 m.",
        "license": "other",
        "extent": {"temporal": {"interval": [["2015-06-27T10:25:31Z", None]]}},
    },
    {"id": "sentinel-2-l1c", "title": "Sentinel-2 L1C", "description": "Top-of-atmosphere reflectance."},
    {"id": "sentinel-1-grd", "title": "Sentinel-1 GRD", "description": "SAR ground range detected."},
]
QUERYABLES = {
    "properties": {
        "eo:cloud_cover": {"title": "Cloud cover", "type": "number", "minimum": 0, "maximum": 100},
        "platform": {"title": "Platform", "type": "string", "enum": ["sentinel-2a", "sentinel-2b"]},
        "sat:relative_orbit": {"title": "Relative orbit", "type": "integer"},
        "datetime": {"type": "string"},
        "geometry": {"type": "object"},
    }
}


def item(i: str) -> dict:
    return {
        "type": "Feature",
        "stac_version": "1.0.0",
        "id": i,
        "collection": COLLECTION,
        "geometry": GEOMETRY,
        "bbox": [10, 45, 11, 46],
        "properties": {"datetime": f"{i[-8:-4]}-{i[-4:-2]}-{i[-2:]}T10:30:00Z", "eo:cloud_cover": 12.5},
        "assets": {"B04": {"href": f"s3://eodata/{i}/B04.jp2", "type": "image/jp2", "title": "Red"}},
        "links": [{"rel": "self", "href": f"{BASE}collections/{COLLECTION}/items/{i}"}],
    }


class Handler(BaseHTTPRequestHandler):
    def _json(self, body: object, status: int = 200) -> None:
        raw = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self) -> None:  # noqa: N802
        path = self.path.split("?")[0]
        if path in ("/v1", "/v1/"):
            self._json({"type": "Catalog", "id": "fake", "links": []})
        elif path == "/v1/collections":
            self._json({"collections": COLLECTIONS, "links": []})
        elif path.endswith("/queryables"):
            self._json({"type": "object", **QUERYABLES})
        elif path.startswith(f"/v1/collections/{COLLECTION}/items/"):
            self._json(item(path.rsplit("/", 1)[1]))
        elif path == "/__last_search":
            self._json(last_search)
        else:
            self._json({"detail": "not found"}, 404)

    def do_POST(self) -> None:  # noqa: N802
        global last_search
        length = int(self.headers.get("Content-Length", 0))
        last_search = json.loads(self.rfile.read(length) or b"{}")
        if self.path.split("?")[0] == "/v1/search":
            self._json({"type": "FeatureCollection", "features": [item(i) for i in IDS], "links": [], "numberMatched": 3})
        else:
            self._json({"detail": "not found"}, 404)

    def log_message(self, *args: object) -> None:
        pass


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
```

Create the upload fixture `ui-tests/tests/area.geojson`:

```json
{"type":"FeatureCollection","features":[{"type":"Feature","properties":{},"geometry":{"type":"Polygon","coordinates":[[[10.2,45.2],[10.8,45.2],[10.8,45.8],[10.2,45.8],[10.2,45.2]]]}}]}
```

Replace `ui-tests/playwright.config.js`:

`ui-tests/playwright.config.js`:

```js
/**
 * Configuration for Playwright using default from @jupyterlab/galata.
 * A fake STAC API (fake_stac.py) runs next to JupyterLab so e2e runs are deterministic.
 */
const baseConfig = require('@jupyterlab/galata/lib/playwright-config');

module.exports = {
  ...baseConfig,
  webServer: [
    {
      command: 'python fake_stac.py',
      url: 'http://127.0.0.1:8765/v1/',
      reuseExistingServer: !process.env.CI
    },
    {
      command: 'jlpm start',
      url: 'http://localhost:8888/lab',
      timeout: 120 * 1000,
      reuseExistingServer: !process.env.CI
    }
  ]
};
```

- [ ] **Step 7: Write the e2e tests** — `ui-tests/tests/explorer.spec.ts`:

```ts
import { expect, test } from '@jupyterlab/galata';
import type { Locator, Page } from '@playwright/test';

const STAC = 'http://127.0.0.1:8765/v1/';
const SELF = (id: string) => `${STAC}collections/sentinel-2-l2a/items/${id}`;

async function explorerCell(page: Page, variable = 'ex'): Promise<Locator> {
  await page.notebook.setCell(0, 'code', `import jstex\n${variable} = jstex.Explorer(stac_url="${STAC}")\n${variable}`);
  await page.notebook.runCell(0);
  const w = page.locator('.jp-OutputArea-output .jstex').first();
  await expect(w.locator('eox-map canvas').first()).toBeAttached({ timeout: 30000 });
  return w;
}

async function searchAll(w: Locator): Promise<void> {
  await w.locator('input[value="sentinel-2-l2a"]').check();
  await w.locator('.jstex-panel [data-ref="search"]').click();
  await expect(w.locator('tr[data-id]')).toHaveCount(3);
}

async function lastSearchBody(): Promise<Record<string, unknown>> {
  return (await fetch('http://127.0.0.1:8765/__last_search')).json();
}

test.describe('jstex Explorer', () => {
  test.beforeEach(async ({ page }) => {
    await page.notebook.createNew();
  });

  test('search, list selection, details and Python accessor agree', async ({ page }) => {
    const w = await explorerCell(page);
    await expect(w.locator('[data-ref="authText"]')).toHaveText('Not signed in — restricted collections are hidden.');
    await expect(w.locator('.jstex-panel [data-ref="search"]')).toBeDisabled();
    await searchAll(w);
    await expect(w.locator('[data-ref="count"]')).toHaveText('3 loaded · 0 selected · 3 matched');
    expect(Object.keys(await lastSearchBody()).sort()).toEqual(['collections', 'limit']);

    await w.locator('tr[data-id="S2B_T32TPS_20240717"] td').nth(1).click();
    await expect(w.locator('.jstex-details__id')).toHaveText('S2B_T32TPS_20240717');
    await expect(w.locator(`button[data-copy="${SELF('S2B_T32TPS_20240717')}"]`).first()).toBeVisible();
    await w.locator('tr[data-id="S2A_T32TPS_20240722"] input').check();

    await page.notebook.addCell('code', 'print(ex.selected_item.get_self_href(), [i.id for i in ex.selected_items])');
    await page.notebook.runCell(1);
    await expect(page.locator('.jp-Cell').nth(1).locator('.jp-OutputArea-output')).toContainText(
      `${SELF('S2B_T32TPS_20240717')} ['S2A_T32TPS_20240722']`
    );
  });

  test('clicking stacked footprints lists them in a popup, like STEX', async ({ page }) => {
    const w = await explorerCell(page);
    await searchAll(w);
    await page.waitForTimeout(1000); // zoom-to-results
    const box = (await w.locator('eox-map').boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(w.locator('.jstex-fp [data-id]')).toHaveCount(3);
    await w.locator('.jstex-fp [data-id="S2B_T32TPS_20240717"]').click();
    await expect(w.locator('.jstex-details__id')).toHaveText('S2B_T32TPS_20240717');
    await expect(w.locator('.jstex-fp')).toHaveCount(0);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(w.locator('.jstex-fp .jstex-active')).toHaveAttribute('data-id', 'S2B_T32TPS_20240717');
    await page.keyboard.press('Escape');
    await expect(w.locator('.jstex-fp')).toHaveCount(0);
  });

  test('drawing a box sets the one area of interest and the search sends intersects', async ({ page }) => {
    const w = await explorerCell(page);
    await w.locator('input[value="sentinel-2-l2a"]').check();
    const box = (await w.locator('eox-map').boundingBox())!;
    await w.locator('[data-draw="Box"]').click();
    await expect(w.locator('.jstex-draw-tip')).toBeVisible();
    await page.mouse.click(box.x + 100, box.y + 80);
    await page.mouse.click(box.x + 300, box.y + 220);
    await expect(w.locator('[data-ref="chipText"]')).toContainText('km²');
    await expect(w.locator('.jstex-draw-tip')).toBeHidden();
    await w.locator('.jstex-panel [data-ref="search"]').click();
    await expect(w.locator('tr[data-id]')).toHaveCount(3);
    expect(((await lastSearchBody()).intersects as { type: string }).type).toBe('Polygon');
    await w.locator('[data-ref="remove"]').click();
    await expect(w.locator('[data-ref="chip"]')).toBeHidden();
  });

  test('collection search, info, open-ended date, filter and GeoJSON upload reach the POST body', async ({ page }) => {
    const w = await explorerCell(page);
    await w.locator('[data-ref="collSearch"]').fill('sentinel-2');
    await expect(w.locator('.jstex-coll')).toHaveCount(2);
    await w.locator('input[value="sentinel-2-l2a"]').check();
    await w.locator('input[value="sentinel-2-l1c"]').check();
    await w.locator('[data-info="sentinel-2-l2a"]').click();
    await expect(w.locator('.jstex-coll__about')).toContainText('2015-06-27 → ongoing');
    await w.locator('[data-ref="from"]').fill('2024-07-01');
    await w.locator('[data-ref="from"]').dispatchEvent('change');
    await expect(w.locator('[data-panel-section="filters"] [data-ref="hint"]')).toHaveText('Fields shared by all 2 collections.');
    await w.locator('[data-panel-section="filters"] [data-ref="add"]').click();
    const row = w.locator('[data-row]').first();
    await row.locator('[data-f="op"]').selectOption('<=');
    await row.locator('[data-f="value"]').fill('abc');
    await expect(row.locator('[data-err]')).toHaveText('Enter a number.');
    await expect(w.locator('.jstex-panel [data-ref="search"]')).toBeDisabled();
    await row.locator('[data-f="value"]').fill('20');
    await w.locator('[data-ref="file"]').setInputFiles('tests/area.geojson');
    await expect(w.locator('[data-ref="chipText"]')).toHaveText('Polygon · 3,120 km²');
    await w.locator('.jstex-panel [data-ref="search"]').click();
    await expect(w.locator('tr[data-id]')).toHaveCount(3);
    const body = await lastSearchBody();
    expect(body.collections).toEqual(['sentinel-2-l2a', 'sentinel-2-l1c']);
    expect(body.datetime).toBe('2024-07-01T00:00:00Z/2099-12-31T23:59:59Z');
    expect(body.filter).toEqual({ op: '<=', args: [{ property: 'eo:cloud_cover' }, 20] });
    expect((body.intersects as { type: string }).type).toBe('Polygon');
  });

  test('the panel collapses to a rail and back', async ({ page }) => {
    const w = await explorerCell(page);
    await w.locator('input[value="sentinel-2-l2a"]').check();
    await w.locator('[data-ref="collapse"]').click();
    await expect(w.locator('.jstex-rail')).toBeVisible();
    await expect(w.locator('[data-rail="collections"]')).toHaveAttribute('title', 'Collections: sentinel-2-l2a');
    await w.locator('[data-rail="filters"]').click();
    await expect(w.locator('.jstex-panel')).toBeVisible();
  });

  test('follows the JupyterLab light/dark theme, including the basemap', async ({ page }) => {
    const w = await explorerCell(page);
    const basemapUrl = () =>
      w.locator('eox-map').evaluate(
        (el: any) =>
          el.map
            .getLayers()
            .getArray()
            .find((l: any) => l.get('id') === 'basemap')
            .getSource()
            .getUrls()[0] as string
      );
    await expect(w).toHaveAttribute('data-theme', 'light');
    expect(await basemapUrl()).toContain('voyager');
    await page.theme.setDarkTheme();
    await expect(w).toHaveAttribute('data-theme', 'dark');
    expect(await basemapUrl()).toContain('alidade_smooth_dark');
    await page.theme.setLightTheme();
    await expect(w).toHaveAttribute('data-theme', 'light');
  });

  test('two explorers in one notebook are independent', async ({ page }) => {
    const w1 = await explorerCell(page, 'ex1');
    await page.notebook.addCell('code', `ex2 = jstex.Explorer(stac_url="${STAC}")\nex2`);
    await page.notebook.runCell(1);
    const w2 = page.locator('.jp-OutputArea-output .jstex').nth(1);
    await expect(w2.locator('eox-map canvas').first()).toBeAttached({ timeout: 30000 });
    await searchAll(w1);
    await expect(w2.locator('input[value="sentinel-2-l2a"]')).not.toBeChecked();
    await expect(w2.locator('tr[data-id]')).toHaveCount(0);
  });
});
```

- [ ] **Step 8: Run the e2e suite**

```bash
pip install -e ".[dev,test]" && jupyter labextension develop . --overwrite
cd ui-tests && jlpm playwright test && cd ..
```

Expected: `spike.spec.ts` (2) and `explorer.spec.ts` (7) PASS. The same flows were exercised against a real JupyterLab 4.6.4 while writing this plan (map renders in two explorers, search → 3 rows, row click → details, a click on the stacked footprints opens "3 overlapping items" and picking one opens its details, collection search → ⓘ info → open-ended date → filter `<=` 20 → GeoJSON upload → POST body with both collections, `2024-07-01T00:00:00Z/2099-12-31T23:59:59Z`, the CQL2 filter and `intersects`; polygon and box drawing; panel collapse to the rail; theme switch swaps the basemap, `ex.selected_item.get_self_href()` matches). If a test flakes on map clicks, raise the `waitForTimeout` after `searchAll` — the zoom-to-results animation must finish before clicking the centre.

**Stale-kernel gotcha:** after rebuilding the bundle, restart kernels that still hold explorers created with the old bundle; reopening such a notebook logs `[anywidget] Failed to initialize model`. Galata starts fresh kernels, so CI is unaffected.

- [ ] **Step 9: Commit**

```bash
jlpm prettier --write "js/**/*.ts" "ui-tests/tests/*.ts"
git add js/ ui-tests/
git commit -m "feat: map view, widget assembly, styles; Galata e2e against a fake STAC API"
```

---

### Task 16: Visual review gate — compare with the approved layout, user sign-off

The user approved layout A on 2026-09-30 from mockups. This task checks the real widget against the design and gets the user's sign-off before the i18n and release tasks.

**Files:**
- Create: `ui-tests/tests/design.spec.ts` (screenshots only; skipped unless `JSTEX_DESIGN_SHOTS=1`)
- Modify: `.gitignore` (add `ui-tests/design-review/`)

**Interfaces:**
- Consumes: the finished widget (Task 15), `ui-tests/fake_stac.py` and `ui-tests/tests/area.geojson` (Task 15).
- Produces: `ui-tests/design-review/*.png` for review. Nothing is shipped.

- [ ] **Step 1: Screenshot spec** — `ui-tests/tests/design.spec.ts`:

```ts
import { expect, test } from '@jupyterlab/galata';

/**
 * Design-review screenshots (not an assertion suite). Run with
 *   JSTEX_DESIGN_SHOTS=1 jlpm playwright test tests/design.spec.ts
 * Output: ui-tests/design-review/<width>-<theme>-<state>.png (git-ignored).
 */
const STAC = 'http://127.0.0.1:8765/v1/';
const WIDTHS = [1400, 1100, 800];

test.skip(!process.env.JSTEX_DESIGN_SHOTS, 'set JSTEX_DESIGN_SHOTS=1 to capture design-review screenshots');

for (const width of WIDTHS) {
  test(`search panel and widget at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1600 });
    await page.notebook.createNew();
    await page.notebook.setCell(0, 'code', `import jstex\nex = jstex.Explorer(stac_url="${STAC}")\nex`);
    await page.notebook.runCell(0);
    const w = page.locator('.jp-OutputArea-output .jstex').first();
    await expect(w.locator('eox-map canvas').first()).toBeAttached({ timeout: 30000 });
    const shot = async (state: string) => {
      for (const theme of ['light', 'dark'] as const) {
        if (theme === 'dark') await page.theme.setDarkTheme();
        else await page.theme.setLightTheme();
        await w.screenshot({ path: `design-review/${width}-${theme}-${state}.png` });
      }
      await page.theme.setLightTheme();
    };
    await shot('1-empty');
    await w.locator('[data-ref="collSearch"]').fill('sentinel-2');
    await w.locator('input[value="sentinel-2-l2a"]').check();
    await w.locator('input[value="sentinel-2-l1c"]').check();
    await w.locator('[data-info="sentinel-2-l2a"]').click();
    await w.locator('[data-ref="from"]').fill('2024-07-01');
    await w.locator('[data-ref="from"]').dispatchEvent('change');
    await w.locator('[data-panel-section="filters"] [data-ref="add"]').click();
    await w.locator('[data-row] [data-f="value"]').first().fill('x');
    await shot('2-editing-with-error');
    await w.locator('[data-row] [data-f="value"]').first().fill('20');
    await w.locator('[data-ref="file"]').setInputFiles('tests/area.geojson');
    await w.locator('.jstex-panel [data-ref="search"]').click();
    await expect(w.locator('tr[data-id]')).toHaveCount(3);
    await w.locator('tr[data-id="S2B_T32TPS_20240717"] td').nth(1).click();
    await shot('3-results');
    if (width > 900) {
      await w.locator('[data-ref="collapse"]').click();
      await shot('4-collapsed');
    }
  });
}
```

- [ ] **Step 2: Capture**

```bash
echo "ui-tests/design-review/" >> .gitignore
cd ui-tests && JSTEX_DESIGN_SHOTS=1 jlpm playwright test tests/design.spec.ts; cd ..
ls ui-tests/design-review/
```

Expected: PNGs for 1400, 1100 and 800 px, light and dark, in these states: empty, editing with a filter error, results with details, and collapsed (wide widths only).

- [ ] **Step 3: Check against the design, then STOP for the user.**
  - **Layout at 1400 and 1100 px:** a 300 px panel beside the map, the same height as the map, with the sections scrolling inside the panel and Search pinned at the bottom.
  - **Layout at 800 px:** the panel is stacked above the map and there is no rail.
  - **Sections:** closed sections show their summaries; the filter error shows inline and Search is disabled with its reason shown.
  - **Readability:** the sign-in line and the warning are readable in dark.
  - **Popup:** the footprint popup is still usable at every width.

  Show the user the screenshots. Iterate on `js/styles.css` and the panel views as they ask, re-running Step 2 each time. **Do not continue to Task 17 until the user approves.** While this plan was written, the same flows were checked live in JupyterLab 4.6.4 at widget widths of about 1100 and 390 px, in light and dark, including the collapsed rail.

- [ ] **Step 4: Commit** (after approval, together with any styling changes)

```bash
jlpm prettier --write "js/**/*.ts" "ui-tests/tests/*.ts"
git add .gitignore ui-tests/tests/design.spec.ts js/
git commit -m "test(ui): design-review screenshots; layout A signed off"
```

---

### Task 17: JupyterLab i18n plumbing — labextension plugin, `jupyterlab.locale` entry point, `.pot`

Follows the JupyterLab "Internationalization and Localization" guide for extension authors (gettext domain `jstex`, `jupyterlab-translate`). Verified while writing this plan: extraction finds every widget string; `compile -l de_DE` produces `jstex.json`; with `jupyterlab-language-pack-de-DE` installed and the locale set to German, JupyterLab 4.6.4 served the shipped `jstex` domain and the widget's Search button read "Suchen" while untranslated strings stayed English.

**Files:**
- Modify: `src/index.ts` (replace the template's "hello" plugin), `pyproject.toml`, `package.json` (script)
- Create: `src/__tests__/i18n-plugin.test.ts`, `ui-tests/tests/i18n.spec.ts`, `jstex/locale/jstex.pot` (generated, committed)

**Interfaces:**
- Consumes: `I18N_KEY` / `TranslationBundle` contract from `js/i18n.ts` (Task 8).
- Produces: plugin `@jstex/labextension:i18n`; exported `I18N_KEY`, `publishTranslations(translator | null)`; the `jupyterlab.locale` entry point `jstex = "jstex"`.

- [ ] **Step 1: Write the failing unit test** — `src/__tests__/i18n-plugin.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import plugin, { I18N_KEY, publishTranslations } from '../index';
import { I18N_KEY as WIDGET_KEY } from '../../js/i18n';

afterEach(() => {
  delete (globalThis as Record<symbol, unknown>)[I18N_KEY];
});

describe('labextension i18n plugin', () => {
  it('uses the same global key as the widget', () => {
    expect(I18N_KEY).toBe(WIDGET_KEY);
  });

  it('publishes the "jstex" bundle and language code', () => {
    const bundle = { __: (s: string) => `fr:${s}` };
    const translator = { languageCode: 'fr-FR', load: vi.fn(() => bundle) };
    publishTranslations(translator as never);
    expect(translator.load).toHaveBeenCalledWith('jstex');
    expect((globalThis as Record<symbol, unknown>)[I18N_KEY]).toEqual({ languageCode: 'fr-FR', bundle });
  });

  it('does nothing without a translator (ITranslator is optional)', () => {
    publishTranslations(null);
    expect((globalThis as Record<symbol, unknown>)[I18N_KEY]).toBeUndefined();
    expect(plugin.autoStart).toBe(true);
    expect(plugin.id).toBe('@jstex/labextension:i18n');
  });
});
```

Run: `jlpm vitest run src/__tests__/i18n-plugin.test.ts` → FAIL (`publishTranslations` is not exported by the template's `src/index.ts`).

- [ ] **Step 2: Implement the plugin** — replace `src/index.ts` (the template's `request.ts` and "hello" route stay for stage 3):

```ts
/**
 * jstex labextension.
 *
 * Stage 1: shares JupyterLab's translation bundle for the "jstex" gettext
 * domain with the jstex widget (which is not a plugin and cannot request
 * ITranslator). The widget reads it from Symbol.for('jstex.i18n') — see
 * js/i18n.ts — and falls back to English when it is absent.
 */
import type { JupyterFrontEnd, JupyterFrontEndPlugin } from '@jupyterlab/application';
import { ITranslator } from '@jupyterlab/translation';

/** Same key as js/i18n.ts (separate build). */
export const I18N_KEY = Symbol.for('jstex.i18n');

export function publishTranslations(translator: ITranslator | null): void {
  if (!translator) {
    return;
  }
  (globalThis as Record<symbol, unknown>)[I18N_KEY] = {
    languageCode: translator.languageCode,
    bundle: translator.load('jstex')
  };
}

const plugin: JupyterFrontEndPlugin<void> = {
  id: '@jstex/labextension:i18n',
  description: 'Shares the jstex translation bundle with the jstex widget.',
  autoStart: true,
  optional: [ITranslator],
  activate: (_app: JupyterFrontEnd, translator: ITranslator | null) => {
    publishTranslations(translator);
  }
};

export default plugin;
```

Run: `jlpm vitest run && jlpm build:lib` → PASS, no tsc errors. (`vite.config.ts` from Task 2 already includes `src/__tests__/**`.)

- [ ] **Step 3: Register the translation entry point.** In `pyproject.toml` insert this table **immediately before** `[tool.hatch.version]` — not right after `dependencies`, which would capture the template's `dynamic = [...]` key and break the build ("Field `project.version` can only be resolved dynamically…"; hit while writing this plan):

```toml
# Translations shipped in jstex/locale/<ll_CC>/LC_MESSAGES/jstex.json (JupyterLab standard).
[project.entry-points."jupyterlab.locale"]
jstex = "jstex"
```

The entry-point name, the JSON file name and the gettext domain must all be `jstex`.

- [ ] **Step 4: Extraction script and template.** In `package.json` `scripts` add `"i18n:extract": "jupyterlab-translate extract . jstex"`. Then:

```bash
pip install -e ".[dev,test]"
jlpm i18n:extract
grep -c '^msgid' jstex/locale/jstex.pot     # one per string in js/strings.ts, plus the header
grep -A1 'msgid "Search"' jstex/locale/jstex.pot
```

- [ ] **Step 5: e2e — the plugin is active in a real JupyterLab** — `ui-tests/tests/i18n.spec.ts`:

```ts
import { expect, test } from '@jupyterlab/galata';

test('labextension shares the jstex translation bundle with the widget', async ({ page }) => {
  const shared = await page.evaluate(() => {
    const g = (globalThis as any)[Symbol.for('jstex.i18n')];
    return g ? { lang: String(g.languageCode), search: g.bundle.__('Search') as string } : null;
  });
  expect(shared).not.toBeNull();
  expect(shared!.search).toBe('Search'); // English UI: gettext returns the msgid
});
```

Run: `pip install -e . && jupyter labextension develop . --overwrite && cd ui-tests && jlpm playwright test tests/i18n.spec.ts; cd ..` → PASS.

- [ ] **Step 6 (manual, optional): prove a real translation end to end.** In a throwaway copy (do not commit a partial translation):

```bash
pip install jupyterlab-language-pack-de-DE        # shipped translations are only served for installed language packs
pybabel init -i jstex/locale/jstex.pot -d jstex/locale -l de_DE -D jstex
# edit jstex/locale/de_DE/LC_MESSAGES/jstex.po: msgid "Search" -> msgstr "Suchen"
jupyterlab-translate compile . jstex -l de_DE     # -l is required; without it nothing is compiled
curl -s http://localhost:8888/lab/api/translations/de_DE | python -c "import sys,json; print(json.load(sys.stdin)['data']['jstex']['Search'])"
```

Switch JupyterLab to German (Settings → Language), run `jstex.Explorer()`: the button reads "Suchen". Delete `jstex/locale/de_DE` afterwards.

- [ ] **Step 7: Commit**

```bash
jlpm prettier
git add src/ pyproject.toml package.json jstex/locale/jstex.pot ui-tests/tests/i18n.spec.ts
git commit -m "feat(i18n): share the jstex gettext bundle with the widget; jupyterlab.locale entry point; .pot"
```

---

### Task 18: Hub prerequisites, docs, private release workflow, v0.1.0 milestone

**Files:**
- Create: `deploy/z2jh-values.example.yaml`, `.github/workflows/release.yml`
- Modify: `README.md` (replace template text), `DEVELOPMENT.md` (extend Task 2 file), `CHANGELOG.md`, `package.json` (`"version": "0.1.0"`), `jstex/locale/jstex.pot` (re-extracted)

**Interfaces:**
- Consumes: env var names from `jstex/config.py` and `jstex/auth.py`; hub endpoint/scope from spec §3.
- Produces: a tagged, locally built `dist/jstex-0.1.0-py3-none-any.whl`; docs that let a hub admin enable token access.

- [ ] **Step 1: Hub configuration example** — `deploy/z2jh-values.example.yaml`:

```yaml
# Zero to JupyterHub (chart >= 4.4, JupyterHub 6, OAuthenticator >= 17.2) settings jstex needs.
# Merge into your values.yaml. Only the keys below matter to jstex.
hub:
  config:
    JupyterHub:
      authenticator_class: generic-oauth
    Authenticator:
      # REQUIRED. z2jh does not enable this by default (its crypt key IS auto-generated).
      enable_auth_state: true
      # Refresh the upstream access token at most every 45 s when the user (or the
      # user's server, via jstex) talks to the hub. The default 300 s lets tokens
      # expire while still being handed out.
      auth_refresh_age: 45
      refresh_pre_spawn: true
    GenericOAuthenticator:
      client_id: jupyterhub
      # client_secret: set via a Kubernetes secret, not here
      oauth_callback_url: https://hub.example.org/hub/oauth_callback
      authorize_url: https://idp.example.org/realms/REALM/protocol/openid-connect/auth
      token_url: https://idp.example.org/realms/REALM/protocol/openid-connect/token
      userdata_url: https://idp.example.org/realms/REALM/protocol/openid-connect/userinfo
      username_claim: preferred_username
      # No offline_access: jstex does not need a long-lived refresh token.
      scope: [openid, profile, email]
      # Must stay false: when true, OAuthenticator never detects an expired token
      # and never refreshes it.
      userdata_from_id_token: false
  # Let each user's server read its own user's auth_state (needs a server restart
  # after changing). jstex reads GET /hub/api/users/{name} — /hub/api/user returns
  # auth_state: null (jupyterhub/jupyterhub#5103).
  loadRoles:
    user:
      scopes: [self, "admin:auth_state!user"]
    server:
      scopes: ["users:activity!user", "access:servers!server", "admin:auth_state!user"]

singleuser:
  extraEnv:
    JSTEX_STAC_URL: https://stac.example.org/v1/
    # Optional:
    # JSTEX_STEX_URL: https://stex.example.org/           # enables Explorer.query_url() share links
    # Basemaps default to the STEX providers (Carto Voyager / Stadia Alidade Smooth Dark).
    # Both need an API key or a registered domain, otherwise they serve watermark tiles:
    JSTEX_BASEMAP_LIGHT_KEY: "<carto key, or leave empty if the hub domain is registered>"
    JSTEX_BASEMAP_DARK_KEY: "<stadia key, or leave empty if the hub domain is registered>"
    # Optional overrides (same meaning as STEX's basemap* settings):
    # JSTEX_BASEMAP_LIGHT_URL / _KEY_PARAM / _ATTRIBUTION
    # JSTEX_BASEMAP_DARK_URL  / _KEY_PARAM / _ATTRIBUTION
```

- [ ] **Step 2: README.md** — replace the template README with:

````markdown
# jstex — STAC explorer for JupyterLab

Find EO products on a map inside a notebook and use them in code. `jstex` is the
light, notebook-native sibling of STEX: a 2D map, collection/date/AOI search,
a results list and item details — and every result is a `pystac` object in
Python. Restricted collections work with the JupyterHub user's own login.

## Features

- `jstex.Explorer()` widget with a STEX-like search panel beside the map:
  collection search (title/id, "only selected", ⓘ info), UTC dates (either end
  optional), one area of interest (draw polygon or box, or upload GeoJSON),
  attribute filters built from the collections' queryables, and a panel that
  folds to an icon rail.
- Results table ↔ map footprints (a click on overlapping footprints lists
  them, as in STEX) and item details with Prev/Next.
- Copy buttons for the item self link, id, every property value, asset hrefs
  (incl. S3 alternates) and links, plus a ready-to-run Python snippet.
- In Python: `ex.results` (`pystac.ItemCollection`), `ex.selected_items`,
  `ex.selected_item`, `ex.search(wait=True)`, `ex.query_url()`.
- `jstex.item(href)` opens any item with the user's token.
- Follows the light/dark theme of JupyterLab (also VS Code and Colab), including the basemap.
- Translatable UI following the JupyterLab i18n standard (gettext domain `jstex`); English ships today.
- Date ranges may be open-ended (only From or only To).
- Uses the JupyterHub user's OIDC access token for every STAC request, so
  restricted collections appear automatically.

## Quick start

```python
import jstex
ex = jstex.Explorer()   # pick a collection, draw a box, Search
ex                      # (display it)

item = ex.selected_item            # the item shown in Item details
item.assets["B04"].href            # use it in your code
```

## Installation (hub image)

jstex is a private package: no PyPI. CI attaches the wheel to each GitHub
Release. Install it in the single-user image with a read-only token passed as a
build secret:

```dockerfile
# syntax=docker/dockerfile:1
FROM quay.io/jupyter/scipy-notebook:latest
ARG JSTEX_VERSION=0.1.0
RUN --mount=type=secret,id=gh_token,uid=1000 \
    TOKEN="$(cat /run/secrets/gh_token)" && \
    ASSET_URL="$(curl -fsSL -H "Authorization: Bearer $TOKEN" \
      https://api.github.com/repos/alek-cesarz/jstex/releases/tags/v${JSTEX_VERSION} \
      | python -c 'import json,sys; print(next(a["url"] for a in json.load(sys.stdin)["assets"] if a["name"].endswith(".whl")))')" && \
    curl -fsSL -H "Authorization: Bearer $TOKEN" -H "Accept: application/octet-stream" \
      -o /tmp/jstex-${JSTEX_VERSION}-py3-none-any.whl "$ASSET_URL" && \
    pip install --no-cache-dir /tmp/jstex-${JSTEX_VERSION}-py3-none-any.whl && \
    rm /tmp/jstex-*.whl
```

Build with `docker build --secret id=gh_token,env=GH_TOKEN .`

## Configuration

| Env var (single-user server) | Default | Meaning |
|---|---|---|
| `JSTEX_STAC_URL` | `https://stac.opensearch.dataspace.copernicus.eu/v1/` | STAC API |
| `JSTEX_STEX_URL` | unset | STEX base URL for `query_url()` share links |
| `JSTEX_BASEMAP_LIGHT_URL` / `_KEY` / `_KEY_PARAM` / `_ATTRIBUTION` | Carto Voyager (`key`) | Light-theme basemap (same as STEX) |
| `JSTEX_BASEMAP_DARK_URL` / `_KEY` / `_KEY_PARAM` / `_ATTRIBUTION` | Stadia Alidade Smooth Dark (`api_key`) | Dark-theme basemap (same as STEX) |
| `JSTEX_ACCESS_TOKEN` | unset | Token for local development outside a hub |

### JupyterHub prerequisites

jstex reads the user's access token from the hub's `auth_state`. The hub must
enable `auth_state` and grant `admin:auth_state!user` to the `user` and
`server` roles — see [`deploy/z2jh-values.example.yaml`](deploy/z2jh-values.example.yaml).
Without it jstex searches anonymously and says "Not signed in — restricted
collections are hidden." under the search bar.

## Translations

The UI uses JupyterLab's translation system (domain `jstex`). v0.1 ships
English only; see DEVELOPMENT.md → "Adding a translation". A translation is
shown when the matching official JupyterLab language pack (e.g.
`jupyterlab-language-pack-de-DE`) is installed and selected.

## Limitations (v0.1)

- While another cell is running, the widget waits for the kernel.
- One area of interest at a time; no "Load more" yet (planned for v0.2).
````

- [ ] **Step 3: DEVELOPMENT.md** — replace the file's first line (`# Developing jstex`) with the block below; the Task 2 "Decisions" section stays after it:

````markdown
# Developing jstex

## Setup

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev,test]"
jupyter labextension develop . --overwrite
jlpm build:widget          # after every change under js/
```

## Commands

| Command | What |
|---|---|
| `pytest -q tests` | Python unit tests (backend, auth, codec, widget protocol) |
| `jlpm vitest run` | Front-end unit tests (jsdom) |
| `npx tsc -p js/tsconfig.json` | Typecheck the widget |
| `ruff check jstex tests && ruff format jstex tests` | Python lint/format |
| `jlpm lint` | Template lint for the labextension + prettier |
| `cd ui-tests && jlpm playwright test` | Galata e2e (starts `fake_stac.py` + JupyterLab) |
| `python -m build` | Wheel with the prebuilt labextension and widget bundle |

## Architecture

- **Python owns all traffic and secrets.** `jstex/stac.py` (pystac-client
  `StacApiIO`) talks to STAC; `jstex/auth.py` reads the token from the hub.
  The browser never sees a token.
- **The widget is a view.** `js/widget.ts` mounts the search panel
  (`js/ui/panel.ts` + one module per section), map, results and details on a
  per-render store (`js/store.ts`); views only call `Actions` (`js/actions.ts`).
  Python pushes results as `{"type":"page"}` messages; small state
  (query, selection, status) is synced traitlets (`js/model-sync.ts`).
- **Protocol** (see `jstex/widget.py`): JS → Py `collections` / `search` /
  `cancel` / `sync` / `queryables` / `aoi_upload`; Py → JS `reply` / `page`.
- **Copied from STEX:** `js/antimeridian.ts` (+ tests) — provenance header
  names the STEX commit. The `?q=` codec in `jstex/query.py` is tested against
  golden strings produced by STEX's own encoder (`tests/fixtures/`).

## Gotchas

- The bundle must be one file (anywidget loads it from a blob URL):
  `inlineDynamicImports`, and @eox/ui icon fonts are dropped (their
  `@font-face` falls back to jsdelivr).
- `js/define-guard.ts` must stay the first import of `js/widget.ts` (each new
  `Explorer()` re-evaluates the bundle; @eox modules define custom elements at
  load).
- After rebuilding the bundle, restart kernels that hold old explorers,
  otherwise reopening the notebook logs `[anywidget] Failed to initialize model`.
- The default basemaps (Carto / Stadia, as in STEX) need an API key or a
  registered domain; without one they serve watermark tiles. Set
  `JSTEX_BASEMAP_{LIGHT,DARK}_KEY` on the hub.
- Open-ended dates are sent closed (1900-01-01 / 2099-12-31): the CDSE
  firewall rejects `../end` intervals.
- ESLint (template config) ignores `js/`; the widget is checked by
  `tsc -p js/tsconfig.json` and prettier. Keep new widget code in `js/`.
- Token expiry: jstex retries a 401 once after re-reading the hub; the hub
  refreshes the upstream token at most every `auth_refresh_age` seconds.

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
````

- [ ] **Step 4: CHANGELOG.md** — replace the template content with:

```markdown
# Changelog

All notable changes to this project are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] - YYYY-MM-DD

### Added

- **Explorer widget** (`jstex.Explorer()`): STEX-like search panel — collection search with info, UTC date range (open-ended allowed), one area of interest (polygon, box or GeoJSON upload), queryables-driven attribute filters (CQL2-JSON), collapsible to a rail; STAC search, results table synchronised with map footprints (a click on overlapping footprints lists them in a popup, as in STEX), item details with Prev/Next and copy buttons for self link, id, property values, asset hrefs (incl. alternates) and links.
- **Python access to results**: `results`, `selected_items`, `selected_item` as `pystac` objects; `search(wait=True)`; `query_url()` producing STEX-compatible `?q=` links; `jstex.item(href)`.
- **JupyterHub token support**: the user's OIDC access token (hub `auth_state`) is sent with every STAC request, so restricted collections work; anonymous fallback with a visible badge.
- **Light and dark mode** following the JupyterLab (VS Code, Colab) theme, with light/dark basemaps.
- **Translation-ready UI** using the JupyterLab i18n standard (gettext domain `jstex`, `jupyterlab.locale` entry point); English only in this release.
- **Deployment config** via `JSTEX_*` environment variables (STAC URL, STEX URL, basemaps as in STEX) and a z2jh example.
```

Replace `YYYY-MM-DD` with the actual release date when you tag (Step 7) — it is a date to fill at release time, not a placeholder to leave.

- [ ] **Step 5: Release workflow** — `.github/workflows/release.yml`:

```yaml
name: Release

on:
  push:
    tags: ['v*']

permissions:
  contents: write

jobs:
  wheel:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: jupyterlab/maintainer-tools/.github/actions/base-setup@v1
      - name: Build wheel
        run: |
          set -eux
          python -m pip install -U "jupyterlab>=4.6,<5" build
          python -m build
      - name: Check the wheel version matches the tag
        run: test -f "dist/jstex-${GITHUB_REF_NAME#v}-py3-none-any.whl"
      - name: Create GitHub Release with the wheel
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          VERSION="${GITHUB_REF_NAME#v}"
          awk -v v="$VERSION" '$0 ~ "^## \\[" v "\\]" {p=1; next} /^## \[/ {p=0} p' CHANGELOG.md > notes.md
          gh release create "$GITHUB_REF_NAME" dist/* --title "jstex $GITHUB_REF_NAME" --notes-file notes.md
```

- [ ] **Step 6: Full verification**

```bash
sed -i 's/"version": "[^"]*"/"version": "0.1.0"/' package.json
ruff check jstex tests && ruff format --check jstex tests
pytest -q tests jstex/tests
jlpm lint:check && jlpm vitest run && npx tsc -p js/tsconfig.json
jlpm i18n:extract && git status --short jstex/locale   # commit an updated .pot if strings changed
jlpm build:prod && python -m build
ls dist/   # expect jstex-0.1.0-py3-none-any.whl and jstex-0.1.0.tar.gz
unzip -l dist/jstex-0.1.0-py3-none-any.whl | grep -E "static/widget.js|labextension/package.json|locale/jstex.pot"
unzip -p dist/jstex-0.1.0-py3-none-any.whl 'jstex-0.1.0.dist-info/entry_points.txt'   # must list [jupyterlab.locale] jstex = jstex
cd ui-tests && jlpm playwright test && cd ..
```

Expected: everything passes; the wheel contains `jstex/static/widget.js`, the labextension, `jstex/locale/jstex.pot`, and the `jupyterlab.locale` entry point. Report any failure verbatim instead of continuing.

- [ ] **Step 7: Milestone commit and tag (local only)**

```bash
git add -A
git commit -m "MILESTONE: jstex v0.1.0 — stage 1 barebones widget

Docs (README, DEVELOPMENT, CHANGELOG), z2jh example, private release workflow,
version 0.1.0."
git tag -a v0.1.0 -m "jstex v0.1.0 (stage 1)"
```

- [ ] **Step 8: Stop and hand over to the user.** Ask for confirmation before pushing (`git push -u origin main feat/stage-1 --tags`), and ask before merging `feat/stage-1` into `main` (user rules). Give the user a merge summary: purpose, key commits, tests run (with counts), risks — especially the Task 2 decisions, the ~4.3 MB bundle sent per `Explorer()`, and the untested hub settings (§11) to validate on the target hub.

---

## Follow-ups for the stage 2 plan (recorded, not in scope here)

- Bundle size (~4.3 MB sent to the browser for each `Explorer()`): serve `widget.js` from the jstex server extension and point `_esm` at that URL, or trim `@eox/map`'s globe/advanced dependencies.
- Load more (`StacBackend.next_page` already exists and is tested), grouped properties, `Explorer(q=…)`, `jstex.s3`, geocoding search (STEX has one; needs a server-side proxy).
- Thumbnails in the footprint popup (user: "later"). Only public thumbnails can load in the browser (the token stays in Python), so show them when they load and hide failures.
- Translate kernel-side error messages (send error codes to JS and translate there).
