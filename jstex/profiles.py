"""Profiles: ready-made connection settings, merged from the jstex registry
(GitHub → disk cache → packaged copy) and a profile's `eo-services.json`
discovery document. See spec 2026-10-02 §3.
"""

from __future__ import annotations

import json
import os
import time
import warnings
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import requests

from .errors import JstexError

REGISTRY_URL = (
    "https://raw.githubusercontent.com/alek-cesarz/jstex/main/jstex/data/profiles.json"
)
PACKAGED_REGISTRY = Path(__file__).parent / "data" / "profiles.json"
CACHE_TTL_S = 24 * 3600
FETCH_TIMEOUT_S = 3.0


class JstexProfileError(JstexError):
    """A profile is unknown or unusable."""


@dataclass(frozen=True)
class Registry:
    profiles: dict[str, dict]
    source: str  # "github" | "cache" | "packaged"


_registry: Registry | None = None
_warned: set[str] = set()


def reset() -> None:
    """Forget the per-process registry and discovery state (tests)."""
    global _registry
    _registry = None
    _warned.clear()


def _warn_once(key: str, message: str) -> None:
    if key not in _warned:
        _warned.add(key)
        warnings.warn(message, UserWarning, stacklevel=3)


def cache_dir() -> Path:
    base = os.environ.get("XDG_CACHE_HOME") or str(Path.home() / ".cache")
    return Path(base) / "jstex"


def offline() -> bool:
    return os.environ.get("JSTEX_PROFILES_URL") == "builtin"


def registry_url() -> str:
    url = os.environ.get("JSTEX_PROFILES_URL")
    return url if url and url != "builtin" else REGISTRY_URL


def _urls(node: Any) -> list[str]:
    if isinstance(node, dict):
        return [u for v in node.values() for u in _urls(v)]
    if isinstance(node, list):
        return [u for v in node for u in _urls(v)]
    if isinstance(node, str) and node.startswith(("http://", "https://")):
        return [node]
    return []


def valid_profiles(doc: Any, origin: str) -> dict[str, dict]:
    """Profiles of a registry document whose URLs are all https."""
    out: dict[str, dict] = {}
    raw = doc.get("profiles") if isinstance(doc, dict) else None
    for name, profile in (raw or {}).items():
        bad = [u for u in _urls(profile) if not u.startswith("https://")]
        if not isinstance(profile, dict) or bad:
            _warn_once(
                f"profile:{origin}:{name}",
                f"jstex: profile {name!r} from {origin} skipped (needs an object with https URLs only).",
            )
            continue
        out[name] = profile
    return out


def _read_cache(path: Path) -> dict | None:
    try:
        data = json.loads(path.read_text())
        return data if isinstance(data, dict) and "doc" in data else None
    except (OSError, ValueError):
        return None


def _write_cache(path: Path, url: str, doc: dict) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps({"fetched_at": time.time(), "url": url, "doc": doc}))
        tmp.replace(path)
    except OSError:
        pass  # a read-only home must not break jstex


def fetch_json(url: str) -> dict | None:
    """GET a JSON object, or None on any failure (timeout, HTTP error, HTML)."""
    try:
        resp = requests.get(url, timeout=FETCH_TIMEOUT_S)
        if not resp.ok:
            return None
        data = resp.json()
        return data if isinstance(data, dict) else None
    except (requests.RequestException, ValueError):
        return None


def load_registry() -> Registry:
    global _registry
    if _registry is not None:
        return _registry
    packaged = json.loads(PACKAGED_REGISTRY.read_text())
    if offline():
        _registry = Registry(valid_profiles(packaged, "packaged"), "packaged")
        return _registry
    url = registry_url()
    path = cache_dir() / "profiles.json"
    cached = _read_cache(path)
    if (
        cached
        and cached.get("url") == url
        and time.time() - cached.get("fetched_at", 0) < CACHE_TTL_S
    ):
        _registry = Registry(valid_profiles(cached["doc"], "cache"), "cache")
        return _registry
    doc = fetch_json(url)
    if doc is not None and isinstance(doc.get("profiles"), dict):
        _write_cache(path, url, doc)
        _registry = Registry(valid_profiles(doc, url), "github")
    elif cached and cached.get("url") == url:
        _warn_once(
            "registry-stale",
            f"jstex: profile registry {url} unreachable; using the cached copy.",
        )
        _registry = Registry(valid_profiles(cached["doc"], "cache"), "cache")
    else:
        _warn_once(
            "registry-packaged",
            f"jstex: profile registry {url} unreachable; using the packaged copy.",
        )
        _registry = Registry(valid_profiles(packaged, "packaged"), "packaged")
    return _registry
