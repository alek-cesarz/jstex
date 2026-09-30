# Changelog

All notable changes to this project are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] - 2026-09-30

### Added

- **Packaging**: distributed as `jupyterlab-jstex` (wheel and JupyterLab extension); the Python import stays `import jstex`. The extension icon is STEX's logo.
- **Explorer widget** (`jstex.Explorer()`): STEX-like search panel — collection search with info, UTC date and time range (calendar with 24-hour time picker as in STEX, or typed; open-ended allowed; From after To flagged), one area of interest (polygon, box or GeoJSON upload), queryables-driven attribute filters (CQL2-JSON), collapsible to a rail and resizable by dragging the divider; the map can be hidden to work with just the panel and results; STAC search, results table synchronised with map footprints (a click on overlapping footprints lists them in a popup, as in STEX), item details (sections folded by default) with Prev/Next and copy buttons for self link, id, property values, asset hrefs (incl. alternates) and links.
- **Python access to results**: `results`, `selected_items`, `selected_item` as `pystac` objects; `search(wait=True)`; `query_url()` giving a clickable STAC `GET /search` link (area sent as its bbox when the URL would exceed 2,000 characters); `stex_url()` giving a STEX link (`?q=`); `jstex.item(href)`.
- **JupyterHub token support**: the user's OIDC access token (hub `auth_state`) is sent with every STAC request, so restricted collections work; anonymous fallback with a visible badge.
- **Light and dark mode** following the JupyterLab (VS Code, Colab) theme, with light/dark basemaps.
- **Translation-ready UI** using the JupyterLab i18n standard (gettext domain `jstex`, `jupyterlab.locale` entry point); English only in this release.
- **Basemap**: OpenFreeMap Positron (vector, no API key) in both themes, with map credits shown; each theme can be switched to another XYZ tile template or vector style, with an API key (`JSTEX_BASEMAP_{LIGHT,DARK}_*`). Zoom and credits controls match the widget's style.
- **Deployment config** via `JSTEX_*` environment variables (STAC URL, STEX URL, basemaps) and a z2jh example.
