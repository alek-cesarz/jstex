# Changelog

All notable changes to this project are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- **Profiles**: ready-made settings for CDSE (`cdse-opensearch` default, `cdse`), CREODIAS and CODE-DE, merged from the jstex profile registry on GitHub, the platform's `eo-services.json` discovery document, `/etc/jstex/config.toml` and `~/.config/jstex/config.toml`, `JSTEX_*` variables and arguments; own profiles for private catalogues; `jstex.show_config()` and `jstex.list_profiles()`; `Explorer(profile=…)`.
- **Sign in without JupyterHub**: device-code login (PKCE) and, where the platform allows it, password login — from the widget's **Sign in** button or `jstex.login()`; stored sessions are reused by later kernels; `jstex.logout()`, `jstex.whoami()`, `jstex.access_token()`.
- **S3 access** (`pip install "jupyterlab-jstex[s3]"`): S3 keys created and renewed automatically and shared by your kernels; `jstex.s3.client()`, `location()`, `session()`, `storage_options()`, `gdal_env()`, `write_aws_profile()`; "Copy boto3 snippet" per S3 asset in Item details.
- **Example notebooks**: downloading data (S3, HTTPS, complete product), Sentinel-2 NDVI with GDAL, xarray NDVI time series.

### Changed

- The JupyterHub token is used only for the profile's own identity service; the user's token is sent only to the profile's STAC, identity and keys-manager hosts.
- The status line shows how you are signed in (`hub`, `token`, `session`, `device login`, `password`); the source previously called `env` is now `token`.

### Fixed

- **Map controls**: zoom and credits buttons are styled even when the map is created after the widget (they could appear unstyled).

## [0.1.0] - 2026-09-30

### Added

- **License and distribution**: GPL-3.0-or-later; published on PyPI as `jupyterlab-jstex` (`pip install jupyterlab-jstex`).
- **Packaging**: distributed as `jupyterlab-jstex` (wheel and JupyterLab extension); the Python import stays `import jstex`. The extension icon is STEX's logo.
- **Explorer widget** (`jstex.Explorer()`): STEX-like search panel — collection search with info, UTC date and time range (calendar with 24-hour time picker as in STEX, or typed; open-ended allowed; From after To flagged), one area of interest (polygon, box or GeoJSON upload), queryables-driven attribute filters (CQL2-JSON), collapsible to a rail and resizable by dragging the divider; the map can be hidden to work with just the panel and results; STAC search, results table synchronised with map footprints (a click on overlapping footprints lists them in a popup, as in STEX), item details (sections folded by default) with Prev/Next and copy buttons for self link, id, property values, asset hrefs (incl. alternates) and links.
- **Python access to results**: `results`, `selected_items`, `selected_item` as `pystac` objects; `search(wait=True)`; `query_url()` giving a clickable STAC `GET /search` link (area sent as its bbox when the URL would exceed 2,000 characters); `stex_url()` giving a STEX link (`?q=`); `jstex.item(href)`.
- **JupyterHub token support**: the user's OIDC access token (hub `auth_state`) is sent with every STAC request, so restricted collections work; anonymous fallback with a visible badge.
- **Light and dark mode** following the JupyterLab (VS Code, Colab) theme, with light/dark basemaps.
- **Translation-ready UI** using the JupyterLab i18n standard (gettext domain `jstex`, `jupyterlab.locale` entry point); English only in this release.
- **Basemap**: OpenFreeMap Positron (vector, no API key) in both themes, with map credits shown; each theme can be switched to another XYZ tile template or vector style, with an API key (`JSTEX_BASEMAP_{LIGHT,DARK}_*`). Zoom and credits controls match the widget's style.
- **Deployment config** via `JSTEX_*` environment variables (STAC URL, STEX URL, basemaps) and a z2jh example.
