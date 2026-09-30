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

| Env var (single-user server)                                       | Default                                               | Meaning                                     |
| ------------------------------------------------------------------ | ----------------------------------------------------- | ------------------------------------------- |
| `JSTEX_STAC_URL`                                                   | `https://stac.opensearch.dataspace.copernicus.eu/v1/` | STAC API                                    |
| `JSTEX_STEX_URL`                                                   | unset                                                 | STEX base URL for `query_url()` share links |
| `JSTEX_BASEMAP_LIGHT_URL` / `_KEY` / `_KEY_PARAM` / `_ATTRIBUTION` | Carto Voyager (`key`)                                 | Light-theme basemap (same as STEX)          |
| `JSTEX_BASEMAP_DARK_URL` / `_KEY` / `_KEY_PARAM` / `_ATTRIBUTION`  | Stadia Alidade Smooth Dark (`api_key`)                | Dark-theme basemap (same as STEX)           |
| `JSTEX_ACCESS_TOKEN`                                               | unset                                                 | Token for local development outside a hub   |

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
