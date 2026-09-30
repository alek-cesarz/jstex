"""Small public helpers used by snippets the widget copies to the clipboard."""

from __future__ import annotations

import pystac

from .config import load_config
from .stac import StacBackend


def item(href: str, *, stac_url: str | None = None) -> pystac.Item:
    """Open a STAC item by URL, sending the user's token (restricted collections work)."""
    return StacBackend(load_config(stac_url=stac_url).stac_url).read_item(href)
