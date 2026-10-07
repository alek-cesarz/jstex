"""Effective configuration: profile → /etc and user config.toml → JSTEX_* env
→ Python arguments (spec 2026-10-02 §3)."""

from __future__ import annotations

import html
import json
import os
import sys
import warnings
import weakref
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

if sys.version_info >= (3, 11):
    import tomllib
else:  # pragma: no cover - exercised on 3.10 only
    import tomli as tomllib

from . import profiles
from .errors import JstexError, JstexWarning

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


DEFAULT_STAC_URL = "https://stac.opensearch.dataspace.copernicus.eu/v1/"
DEFAULT_PROFILE = "cdse-opensearch"
SYSTEM_CONFIG = Path("/etc/jstex/config.toml")

FIELDS = (
    "stac_url",
    "stex_url",
    "issuer",
    "login_client_id",
    "password_client_id",
    "password_login",
    "offline_access",
    "s3_endpoint",
    "s3_region",
    "s3_keys_url",
    "s3_bucket",
)
BOOL_FIELDS = {"password_login", "offline_access"}
ENV_VARS = {f: f"JSTEX_{f.upper()}" for f in FIELDS} | {"issuer": "JSTEX_OIDC_ISSUER"}

_warned: set[str] = set()


@dataclass(frozen=True)
class Config:
    stac_url: str
    stex_url: str | None
    basemap_light: Basemap
    basemap_dark: Basemap
    profile: str = "none"
    issuer: str | None = None
    login_client_id: str | None = None
    password_client_id: str | None = None
    password_login: bool = False
    offline_access: bool = False
    s3_endpoint: str | None = None
    s3_region: str = "default"
    s3_keys_url: str | None = None
    s3_bucket: str | None = None
    sources: Mapping[str, str] = field(default_factory=dict, compare=False, repr=False)


def user_config_path() -> Path:
    base = os.environ.get("XDG_CONFIG_HOME") or str(Path.home() / ".config")
    return Path(base) / "jstex" / "config.toml"


def _read_toml(path: Path) -> dict:
    try:
        return tomllib.loads(path.read_text())
    except FileNotFoundError:
        return {}
    except (OSError, tomllib.TOMLDecodeError) as err:
        if str(path) not in _warned:
            _warned.add(str(path))
            warnings.warn(f"jstex: ignoring {path}: {err}", JstexWarning, stacklevel=3)
        return {}


def _as_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _with_slash(url: str) -> str:
    return url if url.endswith("/") else url + "/"


def _basemap(theme: str, base: Mapping[str, Any] | None) -> Basemap:
    env = os.environ.get
    prefix = f"JSTEX_BASEMAP_{theme.upper()}_"
    base = base or {}
    return Basemap(
        url=env(prefix + "URL") or base.get("url") or DEFAULT_BASEMAP_URL,
        key=env(prefix + "KEY") or base.get("key") or "",
        key_param=env(prefix + "KEY_PARAM")
        or base.get("key_param")
        or DEFAULT_BASEMAP_KEY_PARAM,
        attribution=env(prefix + "ATTRIBUTION")
        or base.get("attribution")
        or DEFAULT_BASEMAP_ATTRIBUTION,
    )


def _files() -> list[tuple[str, dict]]:
    return [
        (str(SYSTEM_CONFIG), _read_toml(SYSTEM_CONFIG)),
        (str(user_config_path()), _read_toml(user_config_path())),
    ]


# Kernel-wide profile state: the default set by jstex.use_profile(), and the
# profiles of the explorers created in this kernel (for whoami()'s hint).
_kernel_profile: str | None = None
_explorer_profiles: weakref.WeakKeyDictionary[Any, str] = weakref.WeakKeyDictionary()


def set_kernel_profile(name: str | None) -> None:
    global _kernel_profile
    _kernel_profile = name


def register_explorer(explorer: Any, profile: str) -> None:
    _explorer_profiles[explorer] = profile


def profiles_in_use() -> set[str]:
    """Profiles of this kernel's explorers that are still open."""
    return {
        name
        for explorer, name in list(_explorer_profiles.items())
        if getattr(explorer, "comm", None) is not None
    }


def reset_kernel_state() -> None:
    set_kernel_profile(None)
    _explorer_profiles.clear()


def _selected_profile(argument: str | None, files: list[tuple[str, dict]]) -> str:
    if argument:
        return argument
    if _kernel_profile:
        return _kernel_profile
    if os.environ.get("JSTEX_PROFILE"):
        return os.environ["JSTEX_PROFILE"]
    for _, data in reversed(files):  # user file before system file
        if isinstance(data.get("profile"), str):
            return data["profile"]
    return DEFAULT_PROFILE


# Sources that mean "came with the ready-made profile" (registry or discovery).
_PROFILE_SOURCES = {"github", "cache", "packaged", "discovery", "discovery-cache"}


def _origin(url: str) -> tuple[str, str, int | None]:
    parts = urlsplit(str(url))
    return parts.scheme, (parts.hostname or "").lower(), parts.port


def _keep_identity_with_its_catalogue(
    name: str,
    values: dict[str, Any],
    sources: dict[str, str],
    baseline_stac: str | None,
) -> None:
    """A STAC override on another host does not inherit the profile's identity
    service, so the user's token never follows it there (spec §3.6). Setting
    `issuer` at the same time (config file, env or argument) keeps it."""
    stac = values.get("stac_url")
    if not (baseline_stac and stac and values.get("issuer")):
        return
    if _origin(stac) == _origin(baseline_stac):
        return
    if sources.get("issuer") in _PROFILE_SOURCES:
        values.pop("issuer", None)
        sources.pop("issuer", None)
        if f"identity:{name}:{stac}" in _warned:
            return
        _warned.add(f"identity:{name}:{stac}")
        warnings.warn(
            f"jstex: stac_url {stac} is not profile {name!r}'s catalogue, so its "
            "identity service is not used and searches are anonymous. Set issuer "
            "(JSTEX_OIDC_ISSUER or issuer=) to sign in there.",
            JstexWarning,
            stacklevel=4,
        )


def load_config(
    *,
    profile: str | None = None,
    stac_url: str | None = None,
    stex_url: str | None = None,
    **overrides: Any,
) -> Config:
    unknown = set(overrides) - set(FIELDS)
    if unknown:
        raise TypeError(f"Unknown jstex setting(s): {', '.join(sorted(unknown))}")
    files = _files()
    name = _selected_profile(profile, files)
    values: dict[str, Any] = {}
    sources: dict[str, str] = {}

    def put(data: Mapping[str, Any], source: str | Mapping[str, str]) -> None:
        for key, value in data.items():
            if value is None or (key not in FIELDS and key != "basemap"):
                continue
            values[key] = value
            sources[key] = source if isinstance(source, str) else source.get(key, "?")

    own = {label: (data.get("profiles") or {}).get(name) for label, data in files}
    baseline_stac: str | None = None  # the ready-made profile's own STAC API
    if name != "none":
        registry = profiles.load_registry()
        if name in registry.profiles:
            resolved = profiles.resolve(name)
            put(resolved.values, resolved.sources)
            baseline_stac = resolved.values.get("stac_url")
        elif not any(isinstance(p, dict) for p in own.values()):
            profiles.resolve(name)  # raises JstexProfileError listing the profiles
        else:
            for p in own.values():  # own profile with its own discovery root
                if isinstance(p, dict) and isinstance(p.get("discovery"), str):
                    doc, source = profiles.fetch_discovery(p["discovery"])
                    if doc:
                        put(
                            profiles.flatten(doc, profiles.DISCOVERY_PATHS),
                            source or "discovery",
                        )
    for label, p in own.items():
        if isinstance(p, dict):
            put(p, label)
    put({f: os.environ.get(var) or None for f, var in ENV_VARS.items()}, "env")
    put({"stac_url": stac_url, "stex_url": stex_url, **overrides}, "argument")

    _keep_identity_with_its_catalogue(name, values, sources, baseline_stac)
    if not values.get("stac_url"):
        raise JstexError(
            f"Profile {name!r} has no STAC URL; set stac_url (config.toml, JSTEX_STAC_URL or stac_url=)."
        )
    for key in BOOL_FIELDS:
        if key in values:
            values[key] = _as_bool(values[key])
    basemap = values.pop("basemap", None) or {}
    return Config(
        stac_url=_with_slash(str(values.pop("stac_url"))),
        stex_url=values.pop("stex_url", None),
        basemap_light=_basemap("light", basemap.get("light")),
        basemap_dark=_basemap("dark", basemap.get("dark")),
        profile=name,
        issuer=str(values.pop("issuer")).rstrip("/") if values.get("issuer") else None,
        **values,
        sources=sources,
    )


def save_login_client_id(profile: str, client_id: str) -> Path:
    """Record a device-login client id for `profile` in the user config file.

    Appends a new `[profiles."<profile>"]` table; never rewrites an existing
    table (the user's own edits and comments stay intact).
    """
    path = user_config_path()
    existing = _read_toml(path)
    table = (existing.get("profiles") or {}).get(profile)
    if isinstance(table, dict):
        if table.get("login_client_id") == client_id:
            return path
        raise JstexError(
            f"{path} already has a [profiles.{profile}] table; edit it and set login_client_id = {json.dumps(client_id)}."
        )
    path.parent.mkdir(parents=True, exist_ok=True)
    block = f"\n[profiles.{json.dumps(profile)}]\nlogin_client_id = {json.dumps(client_id)}\n"
    with path.open("a", encoding="utf-8") as fh:
        fh.write(block)
    return path


class ConfigView:
    """Notebook-friendly view of the effective configuration and its sources."""

    def __init__(self, config: Config):
        self.config = config

    def rows(self) -> list[tuple[str, str, str]]:
        cfg = self.config
        out = [("profile", cfg.profile, "selected")]
        for name in FIELDS:
            value = getattr(cfg, name)
            out.append(
                (
                    name,
                    "" if value is None else str(value),
                    cfg.sources.get(name, "default"),
                )
            )
        out.append(("registry", profiles.load_registry().source, ""))
        return out

    def __repr__(self) -> str:
        width = max(len(r[0]) for r in self.rows())
        return "\n".join(
            f"{n:<{width}}  {v}  ({s})" if s else f"{n:<{width}}  {v}"
            for n, v, s in self.rows()
        )

    def _repr_html_(self) -> str:
        cells = "".join(
            f"<tr><td><code>{html.escape(n)}</code></td><td>{html.escape(v)}</td><td>{html.escape(s)}</td></tr>"
            for n, v, s in self.rows()
        )
        return f"<table><tr><th>setting</th><th>value</th><th>source</th></tr>{cells}</table>"
