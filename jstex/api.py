"""Small public helpers used by snippets the widget copies to the clipboard."""

from __future__ import annotations

import pystac

from .config import ConfigView, _files, load_config
from .profiles import load_registry
from .stac import StacBackend


def item(href: str, *, stac_url: str | None = None) -> pystac.Item:
    """Open a STAC item by URL, sending the user's token (restricted collections work)."""
    return StacBackend(load_config(stac_url=stac_url).stac_url).read_item(href)


def show_config(profile: str | None = None, **overrides) -> ConfigView:
    """The effective settings for `profile` and where each value came from."""
    return ConfigView(load_config(profile=profile, **overrides))


def list_profiles() -> list[dict[str, str]]:
    """Ready-made profiles (registry) and own profiles (config files)."""
    reg = load_registry()
    out = [
        {
            "name": n,
            "description": (p.get("platform") or {}).get("description", ""),
            "source": reg.source,
        }
        for n, p in sorted(reg.profiles.items())
    ]
    for label, data in _files():
        for n in sorted(data.get("profiles") or {}):
            if n not in reg.profiles:
                out.append({"name": n, "description": "", "source": label})
    return out
