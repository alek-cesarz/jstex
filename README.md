# jstex — STAC explorer for JupyterLab

Find Earth-observation products on a map inside a notebook, then use them in
code. `jstex` is the light, notebook-native sibling of
STEX, the web EO Data Explorer. It offers collection search,
dates, one area of interest, attribute filters, a results table synchronised
with footprints on the map, and item details. Every result is also a `pystac`
object in Python.

On a JupyterHub, jstex searches with the signed-in user's own token, so
restricted collections just work.

![jstex Explorer in a notebook cell (dark theme): search panel, map with the area of interest and the highlighted footprint, results table and item details](docs/images/explorer-dark.png)

## Features

- **Search panel beside the map** (STEX-like, folds to an icon rail):
  - **Collections:** search by title or id, "only selected", ⓘ for the
    description, time extent and license.
  - **Dates (UTC):** either end may be left open.
  - **Area of interest:** one area. Draw a polygon or a box, or upload
    GeoJSON; invalid geometries are repaired before searching.
  - **Attribute filters:** built from the collections' queryables (`=`, `!=`,
    `<`, `<=`, `>`, `>=`, `IN`), checked by field type before sending.
- **Results ↔ map.** Clicking a row highlights its footprint. Clicking a
  footprint opens that item; where footprints overlap, a popup lists them, as
  in STEX.
- **Item details** with Prev/Next and copy buttons for:
  - the self link and id;
  - every property value;
  - asset hrefs, including alternates such as S3;
  - links;
  - a ready-to-run Python snippet.
- **Python access** to results, selection and the current query (see below).
- **Restricted collections** via the user's JupyterHub OIDC token, with an
  anonymous fallback and a visible "Not signed in" hint.
- **Light and dark mode** follow JupyterLab (also VS Code and Colab),
  including the basemap.
- **Links to the search**: `ex.query_url()` gives a clickable STAC
  `GET /search` URL; `ex.stex_url()` opens the same query in STEX.
- **Translatable** following the JupyterLab i18n standard; English ships
  today.

## Quick start

```python
import jstex

ex = jstex.Explorer()   # pick a collection, draw a box, click Search
ex
```

Then, in the next cell:

```python
item = ex.selected_item            # the item shown in Item details
item.assets["B04"].href            # use it in your code
```

## Using results in Python

| Member                                      | What it gives                                                                                                                                                                               |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `jstex.Explorer(stac_url=None, height=600)` | The widget. `stac_url` overrides `JSTEX_STAC_URL`; `height` is the panel/map height in px.                                                                                                  |
| `ex.results`                                | All loaded items as a `pystac.ItemCollection`                                                                                                                                               |
| `ex.selected_items`                         | The checked result rows, as `pystac.Item`s                                                                                                                                                  |
| `ex.selected_item`                          | The item shown in Item details (`None` if none)                                                                                                                                             |
| `ex.query`                                  | The current query as a dict. Assign to it to change the panel from Python.                                                                                                                  |
| `ex.search(wait=False)`                     | Run the current query. `wait=True` blocks until `ex.results` is filled.                                                                                                                     |
| `ex.cancel()`                               | Drop the running search; previous results stay                                                                                                                                              |
| `ex.query_url()`                            | Clickable STAC `GET /search` URL for the query (returns the results as JSON; carries no token). A complex area is sent as its bbox, with a warning, to keep the URL under 2,000 characters. |
| `ex.stex_url()`                             | Clickable STEX link that opens the query (needs `JSTEX_STEX_URL`)                                                                                                                           |
| `jstex.item(href)`                          | Open any STAC item URL with the user's token (what "Copy Python" pastes)                                                                                                                    |

Search from code, and the widget shows the same results:

```python
ex.query = {
    **ex.query,
    "collections": ["sentinel-2-l2a"],
    "datetime": {"from": "2024-07-01T00:00:00Z", "to": "2024-07-31T23:59:59Z"},
    "filters": [{"field": "eo:cloud_cover", "op": "<=", "value": 20}],
}
ex.search(wait=True)

for item in ex.results:
    print(item.id, item.datetime, item.properties.get("eo:cloud_cover"))
```

## Installation (hub image)

jstex is a private package: it is not on PyPI. CI attaches the wheel to each
GitHub Release. Install it in the single-user image, passing a read-only
token as a build secret:

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

Requirements: JupyterLab 4, Python ≥ 3.10 with `anywidget` 0.11 (installed
as a dependency).

## Configuration

Set these environment variables on the single-user server (e.g.
`singleuser.extraEnv` in Zero to JupyterHub):

| Env var                                                            | Default                                               | Meaning                                   |
| ------------------------------------------------------------------ | ----------------------------------------------------- | ----------------------------------------- |
| `JSTEX_STAC_URL`                                                   | `https://stac.opensearch.dataspace.copernicus.eu/v1/` | STAC API                                  |
| `JSTEX_STEX_URL`                                                   | unset                                                 | STEX base URL for `stex_url()` links      |
| `JSTEX_BASEMAP_LIGHT_URL` / `_KEY` / `_KEY_PARAM` / `_ATTRIBUTION` | Carto Voyager (key param `key`)                       | Light-theme basemap (same as STEX)        |
| `JSTEX_BASEMAP_DARK_URL` / `_KEY` / `_KEY_PARAM` / `_ATTRIBUTION`  | Stadia Alidade Smooth Dark (key param `api_key`)      | Dark-theme basemap (same as STEX)         |
| `JSTEX_ACCESS_TOKEN`                                               | unset                                                 | Token for local development outside a hub |

Both default basemaps need an API key or a registered domain; without one
they serve watermarked tiles.

### JupyterHub prerequisites

jstex reads the user's access token from the hub's `auth_state`. The hub must:

- enable `auth_state`;
- grant `admin:auth_state!user` so the user's server can read it.

See [`deploy/z2jh-values.example.yaml`](deploy/z2jh-values.example.yaml).
Without this, jstex searches anonymously and shows "Not signed in —
restricted collections are hidden." under the Search button.

## Translations

The UI uses JupyterLab's translation system (gettext domain `jstex`). v0.1
ships English only. A translation is shown when the matching official
JupyterLab language pack (e.g. `jupyterlab-language-pack-de-DE`) is installed
and selected. To add a language, see
[DEVELOPMENT.md → Translations](DEVELOPMENT.md#translations-i18n).

## Limitations (v0.1)

- While another cell is running, the widget waits for the kernel.
- There is one area of interest at a time.
- There is no "Load more" yet (planned for v0.2); a search loads one page
  (50 items).
- No downloads, visualisation or processing — use STEX for those.

## Documentation

- [Architecture](docs/architecture.md) — how the kernel, widget and
  JupyterLab extension fit together.
- [DEVELOPMENT.md](DEVELOPMENT.md) — setup, commands, gotchas.
- [CONTRIBUTING.md](CONTRIBUTING.md) — development install and releasing.
- [CHANGELOG.md](CHANGELOG.md)

## License

Private; no license is granted.
