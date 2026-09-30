"""Deployment configuration: explicit kwargs -> JSTEX_* env vars -> defaults."""

from __future__ import annotations

import os
from dataclasses import dataclass, field

DEFAULT_STAC_URL = "https://stac.opensearch.dataspace.copernicus.eu/v1/"

# Basemaps: same providers and defaults as STEX (src/lib/config.ts). Both need
# an API key or a registered domain; set them per deployment.
DEFAULT_BASEMAP_LIGHT_URL = (
    "https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
)
DEFAULT_BASEMAP_LIGHT_KEY_PARAM = "key"
DEFAULT_BASEMAP_LIGHT_ATTRIBUTION = (
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors '
    '&copy; <a href="https://carto.com/attributions">CARTO</a>'
)
DEFAULT_BASEMAP_DARK_URL = (
    "https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png"
)
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
            "LIGHT",
            DEFAULT_BASEMAP_LIGHT_URL,
            DEFAULT_BASEMAP_LIGHT_KEY_PARAM,
            DEFAULT_BASEMAP_LIGHT_ATTRIBUTION,
        ),
        basemap_dark=_basemap(
            "DARK",
            DEFAULT_BASEMAP_DARK_URL,
            DEFAULT_BASEMAP_DARK_KEY_PARAM,
            DEFAULT_BASEMAP_DARK_ATTRIBUTION,
        ),
    )
