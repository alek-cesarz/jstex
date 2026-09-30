"""Deployment configuration: explicit kwargs -> JSTEX_* env vars -> defaults."""

from __future__ import annotations

import os
from dataclasses import dataclass, field

DEFAULT_STAC_URL = "https://stac.opensearch.dataspace.copernicus.eu/v1/"

# Basemap default: OpenFreeMap Positron, a vector (MapLibre) style that needs
# no key, in both themes. A deployment can set any other style URL or an XYZ
# raster tile template (with an API key) per theme via JSTEX_BASEMAP_*.
DEFAULT_BASEMAP_URL = "https://tiles.openfreemap.org/styles/positron"
DEFAULT_BASEMAP_KEY_PARAM = "key"
DEFAULT_BASEMAP_ATTRIBUTION = (
    '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> '
    '<a href="https://www.openmaptiles.org/" target="_blank">&copy; OpenMapTiles</a> '
    'Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>'
)


@dataclass(frozen=True)
class Basemap:
    """A basemap: an XYZ raster tile template (``{z}/{x}/{y}``; ``{r}`` becomes
    ``@2x``) or, for any other URL, a MapLibre/Mapbox style JSON (vector)."""

    url: str
    key: str = field(default="", repr=False)
    key_param: str = DEFAULT_BASEMAP_KEY_PARAM
    attribution: str = ""

    @property
    def kind(self) -> str:
        return "xyz" if "{z}" in self.url else "style"

    def tile_url(self, retina: bool = True) -> str:
        """The URL to load, with the API key (if any) as a query parameter."""
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


def _basemap(theme: str) -> Basemap:
    env = os.environ.get
    prefix = f"JSTEX_BASEMAP_{theme}_"
    return Basemap(
        url=env(prefix + "URL") or DEFAULT_BASEMAP_URL,
        key=env(prefix + "KEY") or "",
        key_param=env(prefix + "KEY_PARAM") or DEFAULT_BASEMAP_KEY_PARAM,
        attribution=env(prefix + "ATTRIBUTION") or DEFAULT_BASEMAP_ATTRIBUTION,
    )


def load_config(*, stac_url: str | None = None, stex_url: str | None = None) -> Config:
    env = os.environ.get
    return Config(
        stac_url=_with_slash(stac_url or env("JSTEX_STAC_URL") or DEFAULT_STAC_URL),
        stex_url=stex_url or env("JSTEX_STEX_URL") or None,
        basemap_light=_basemap("LIGHT"),
        basemap_dark=_basemap("DARK"),
    )
