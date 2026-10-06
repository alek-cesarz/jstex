# jstex v0.2 base — Profiles, Login and S3 Keys Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ready-made, overridable profiles (CDSE, CREODIAS, CODE-DE) merged from a GitHub registry, `eo-services.json` discovery and manual config; a token chain with jstex's own device-code and password login; S3 key management on top; and sample notebooks.

**Architecture:** `jstex/profiles.py` loads the registry (network → cache → packaged) and discovery documents and flattens them to fields with sources; `jstex/config.py` layers config files, env vars and arguments on top. `jstex/auth.py` resolves a per-issuer token (manual → hub → stored session) using `jstex/oidc.py` and `jstex/sessions.py`; `jstex/login.py` adds device-code and password login. The widget gets a sign-in area (`js/ui/signin.ts`) driven by new comm messages. `jstex/s3.py` ports STEX's key policy and exposes boto3/fsspec/GDAL helpers.

**Tech Stack:** Python 3.10+ (requests, pystac-client, anywidget, traitlets, `tomllib`/`tomli`; optional boto3 + filelock), TypeScript widget (Vite, vitest), Galata e2e, pytest + responses.

**Spec:** `docs/superpowers/specs/2026-10-02-jstex-profiles-auth-design.md`, extending `docs/superpowers/specs/2026-09-29-jstex-jupyterlab-design.md` (§6, §13).

**Repository and branch:** code lives in `~/code/jstex` (repo `alek-cesarz/jstex`). Start after PR #1 (`feat/stage-1`) is merged: `git -C ~/code/jstex worktree add .worktrees/v0.2-profiles -b feat/v0.2-profiles main`. If PR #1 is not merged yet, branch from `feat/stage-1` instead. Dev venv: `/home/eouser/code/jstex/.venv` (`pip install -e ".[dev,test,s3]"` once Task 12 adds the extra; `jupyter labextension develop . --overwrite`). Commands below run from the worktree root with that venv on `PATH`.

**Out of scope here (other v0.2 base items, separate plans):** Load more, popup thumbnails, geocoding, bundle size, deferred minors.

## Global Constraints

- Python `>=3.10`; new core dependency `tomli>=2; python_version < "3.11"`; new extra `s3 = ["boto3>=1.34", "filelock>=3.12"]`; test extra gains `jsonschema>=4.20`, `moto[s3]>=5`. No eosdk dependency.
- The term is **profile**. Default profile: **`cdse-opensearch`**. `profile = "none"` loads no ready-made profile.
- Registry: `jstex/data/profiles.json` (package data), default URL `https://raw.githubusercontent.com/alek-cesarz/jstex/main/jstex/data/profiles.json`; env `JSTEX_PROFILES_URL` (other URL, or `builtin` = no network at all: packaged registry, no discovery).
- Merge per field, later wins: GitHub profile → discovery (`<root>/.well-known/eo-services.json`, except `pinned` paths) → `/etc/jstex/config.toml` → `~/.config/jstex/config.toml` → `JSTEX_*` env → Python arguments.
- Every URL in a registry profile or discovery document must be `https://`; invalid ones are skipped with one warning. Manual config may use `http://` (local development).
- Fetch timeout 3 s; disk cache under `$XDG_CACHE_HOME/jstex` (default `~/.cache/jstex`), reused for 24 h and as fallback.
- Token chain per issuer: manual token → JupyterHub (only if JWT `iss` equals the profile issuer; profiles without an issuer keep v0.1 behaviour) → stored session → device code → password → anonymous. Device and password run only on user action.
- Sessions: `$XDG_DATA_HOME/jstex/sessions.json` (default `~/.local/share/jstex/sessions.json`), file 0600, directory 0700, atomic writes, keyed by issuer; refresh tokens only.
- Device login: RFC 8628 + PKCE S256, honour `interval`/`slow_down`, give up after `expires_in` or 300 s. The device client id is never taken from discovery's `services.auth.client_id`.
- Password: sent once to the token endpoint; never stored, logged, put in a trait, store or exception text.
- Token is attached only to requests whose origin equals the effective `stac_url`, `issuer` or `s3_keys_url` origin. The S3 gateway never sees the token.
- S3 keys: 8 h `expiration_date`; renew when < 1 h remains and delete the superseded key; on `InvalidAccessKeyId` from a non-fresh key drop, create once, retry; propagation wait budget 10 s; key-cap refusal negative-cached 30 s; cache `$XDG_CONFIG_HOME/jstex/s3-credentials.json` (0600) keyed by `s3_keys_url` + token `sub`, guarded by a `filelock`.
- UI strings only in `js/strings.ts` as literal `trans.__()` calls; run `jlpm i18n:extract` when strings change.
- Commits: no `Co-Authored-By` trailers. Format: `ruff format` / `ruff check` for Python, `npx prettier --write "js/**/*.ts"` for widget code (never `jlpm prettier` repo-wide).
- Local wheel builds: `jlpm build:prod && python -m build --wheel`; before local Galata runs `jlpm build` again (DEVELOPMENT.md gotchas).

## Review Focus

- **Registry or discovery answers HTML or hangs** (captive portal, proxy, outage): the widget must still render within a few seconds using the cached or packaged profile, with one warning — Task 2 pins "discovery returns 200 text/html → ignored, stale cache used".
- **Hub user selects a profile of a different identity service** (hub logs in to CDSE, user picks `codede`): the hub token must not be sent, and Sign in must be offered — Task 4 pins the issuer mismatch.
- **Two kernels refresh the same stored session at once** (Keycloak rotates refresh tokens, the slower kernel gets `invalid_grant`): the session the faster kernel just stored must survive — Task 4 pins "on invalid_grant re-read the store; if the refresh token changed, retry with it".
- **Opaque or exp-less access tokens** (non-JWT tokens from a custom IdP, password/device responses): expiry must come from `expires_in`, not the JWT — Task 6 pins a non-JWT access token.
- **A cached S3 key expired while the kernel was idle** overnight: the next `jstex.s3.client()` must renew before use, not fail on the first request — Task 11 pins an expired cache entry.
- **A broken `config.toml`** (syntax error): one warning, file ignored, jstex keeps working — Task 3 pins it.

## File Map

| File | Responsibility | Task |
|---|---|---|
| `jstex/data/profiles.json`, `jstex/data/profiles.schema.json` | Ready-made profiles (eo-services shape + `jstex` block) and their JSON Schema | 1 |
| `jstex/profiles.py` | Registry loading/caching/validation, discovery fetch, per-field flattening with sources | 1, 2 |
| `jstex/config.py` | Effective `Config`: profile selection, TOML files, env, kwargs; `ConfigView`; saving a login client id | 3 |
| `jstex/oidc.py` | Issuer metadata, token endpoint calls, unverified JWT claims | 4 |
| `jstex/sessions.py` | Stored sessions (refresh tokens) per issuer | 4 |
| `jstex/auth.py` | Token chain steps 1–3, per-issuer cache, complete/logout/whoami | 4 |
| `jstex/stac.py` | Token scoping to the profile's origins | 5 |
| `jstex/login.py` | Device-code and password login, client-id resolution | 6, 7 |
| `jstex/api.py`, `jstex/__init__.py` | `item`, `config`, `profiles`, `login`, `logout`, `whoami` | 3, 6, 7 |
| `jstex/widget.py` | `profile=`; traits `profile_name`, `auth_user`, `login_methods`; login messages | 5, 8 |
| `js/types.ts`, `js/model-sync.ts`, `js/backend.ts`, `js/actions.ts`, `js/ui/signin.ts`, `js/ui/panel.ts`, `js/strings.ts`, `js/styles.css` | Sign-in UI and protocol | 5, 9 |
| `ui-tests/fake_stac.py`, `ui-tests/tests/signin.spec.ts` | Fake OIDC provider, restricted collection, e2e sign-in | 10 |
| `jstex/s3.py` | Key policy (Task 11) and user helpers (Task 12) | 11, 12 |
| `js/snippets.ts`, `js/ui/details.ts` | "Copy boto3 snippet" per asset | 13 |
| `examples/*.ipynb`, `examples/requirements.txt`, `scripts/check_notebooks.py` | Sample notebooks and their CI check | 14 |
| `README.md`, `DEVELOPMENT.md`, `CHANGELOG.md`, `docs/architecture.md`, `deploy/z2jh-values.example.yaml` | Docs | 15 |

---
### Task 1: Profile registry (data, schema, loading, caching)

**Files:**
- Create: `jstex/data/profiles.json`, `jstex/data/profiles.schema.json`, `jstex/profiles.py`, `tests/test_profiles.py`
- Modify: `tests/conftest.py` (isolate XDG dirs, offline registry, new env vars), `pyproject.toml` (test extra `jsonschema>=4.20`)

**Interfaces:**
- Produces:
  - `jstex.profiles.REGISTRY_URL: str`, `PACKAGED_REGISTRY: Path`, `CACHE_TTL_S = 86400`, `FETCH_TIMEOUT_S = 3.0`
  - `jstex.profiles.cache_dir() -> Path` (`$XDG_CACHE_HOME/jstex` or `~/.cache/jstex`)
  - `jstex.profiles.offline() -> bool` (`JSTEX_PROFILES_URL == "builtin"`)
  - `@dataclass(frozen=True) class Registry: profiles: dict[str, dict]; source: str` — source in `"github" | "cache" | "packaged"`
  - `jstex.profiles.load_registry() -> Registry` (memoised per process; `reset()` clears it)
  - `jstex.profiles.valid_profiles(doc: Any, origin: str) -> dict[str, dict]` (drops profiles with non-https URLs, warns once each)
  - `class JstexProfileError(JstexError)`

- [ ] **Step 1: Test isolation in `tests/conftest.py`**

Replace the autouse fixture so every test runs offline with private XDG dirs and no stray env vars:

```python
import pytest

from jstex import auth

JSTEX_ENV = (
    "JUPYTERHUB_API_URL",
    "JUPYTERHUB_API_TOKEN",
    "JUPYTERHUB_USER",
    "JSTEX_ACCESS_TOKEN",
    "JSTEX_STAC_URL",
    "JSTEX_STEX_URL",
    "JSTEX_PROFILE",
    "JSTEX_PROFILES_URL",
    "JSTEX_OIDC_ISSUER",
    "JSTEX_LOGIN_CLIENT_ID",
    "JSTEX_PASSWORD_CLIENT_ID",
    "JSTEX_PASSWORD_LOGIN",
    "JSTEX_OFFLINE_ACCESS",
    "JSTEX_S3_ENDPOINT",
    "JSTEX_S3_REGION",
    "JSTEX_S3_KEYS_URL",
    "JSTEX_S3_BUCKET",
    *(
        f"JSTEX_BASEMAP_{t}_{k}"
        for t in ("LIGHT", "DARK")
        for k in ("URL", "KEY", "KEY_PARAM", "ATTRIBUTION")
    ),
)


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch, tmp_path):
    for var in JSTEX_ENV:
        monkeypatch.delenv(var, raising=False)
    for xdg in ("XDG_CACHE_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME"):
        monkeypatch.setenv(xdg, str(tmp_path / xdg.lower()))
    # Tests never touch the network for profiles unless they opt in.
    monkeypatch.setenv("JSTEX_PROFILES_URL", "builtin")
    from jstex import profiles

    profiles.reset()
    auth.reset_cache()
    yield
    profiles.reset()
    auth.reset_cache()
```

Keep `make_jwt` and `hub_env` as they are. (`jstex.profiles` does not exist yet; the next step's test run is the RED.)

- [ ] **Step 2: Write the failing tests** — `tests/test_profiles.py`:

```python
import json
import time

import pytest
import responses

from jstex import profiles
from jstex.profiles import PACKAGED_REGISTRY, REGISTRY_URL, load_registry, valid_profiles


def test_packaged_registry_matches_schema():
    import jsonschema

    schema = json.loads((PACKAGED_REGISTRY.parent / "profiles.schema.json").read_text())
    jsonschema.validate(json.loads(PACKAGED_REGISTRY.read_text()), schema)


def test_ready_made_profiles_are_packaged():
    reg = load_registry()
    assert reg.source == "packaged"
    assert {"cdse-opensearch", "cdse", "creodias", "codede"} <= set(reg.profiles)
    cdse_os = reg.profiles["cdse-opensearch"]
    assert cdse_os["services"]["catalogue"]["stac"]["url"] == (
        "https://stac.opensearch.dataspace.copernicus.eu/v1"
    )
    assert "services.catalogue.stac.url" in cdse_os["pinned"]


def test_non_https_profile_is_dropped_with_a_warning():
    doc = {
        "version": "1.0",
        "profiles": {
            "ok": {"services": {"catalogue": {"stac": {"url": "https://s/v1"}}}},
            "bad": {"services": {"catalogue": {"stac": {"url": "http://s/v1"}}}},
        },
    }
    with pytest.warns(UserWarning, match="bad"):
        assert set(valid_profiles(doc, "test")) == {"ok"}


@responses.activate
def test_network_registry_is_fetched_and_cached(monkeypatch):
    monkeypatch.setenv("JSTEX_PROFILES_URL", REGISTRY_URL)
    doc = {"version": "1.0", "profiles": {"x": {"services": {}}}}
    responses.get(REGISTRY_URL, json=doc)
    assert load_registry().source == "github"
    profiles.reset()
    assert load_registry().source == "cache"  # fresh cache: no second request
    assert len(responses.calls) == 1


@responses.activate
def test_stale_cache_is_used_when_the_network_fails(monkeypatch):
    monkeypatch.setenv("JSTEX_PROFILES_URL", REGISTRY_URL)
    responses.get(REGISTRY_URL, json={"version": "1.0", "profiles": {"x": {}}})
    load_registry()
    cache = profiles.cache_dir() / "profiles.json"
    data = json.loads(cache.read_text())
    data["fetched_at"] = time.time() - 2 * 86400
    cache.write_text(json.dumps(data))
    responses.replace(responses.GET, REGISTRY_URL, body="<html>proxy</html>", status=200)
    profiles.reset()
    reg = load_registry()
    assert reg.source == "cache" and "x" in reg.profiles


@responses.activate
def test_packaged_copy_when_nothing_else_works(monkeypatch):
    monkeypatch.setenv("JSTEX_PROFILES_URL", REGISTRY_URL)
    responses.get(REGISTRY_URL, status=503)
    reg = load_registry()
    assert reg.source == "packaged" and "cdse-opensearch" in reg.profiles
```

- [ ] **Step 3: Run to verify they fail**

Run: `pytest tests/test_profiles.py -q`
Expected: collection error `ModuleNotFoundError: No module named 'jstex.profiles'`.

- [ ] **Step 4: Packaged registry** — `jstex/data/profiles.json`:

```json
{
  "version": "1.0",
  "profiles": {
    "cdse-opensearch": {
      "discovery": "https://discover.dataspace.copernicus.eu",
      "pinned": ["services.catalogue.stac.url"],
      "platform": { "name": "cdse", "description": "Copernicus Data Space Ecosystem (OpenSearch STAC catalogue)" },
      "services": {
        "catalogue": { "stac": { "url": "https://stac.opensearch.dataspace.copernicus.eu/v1" } },
        "data_access": {
          "s3": {
            "endpoint": "https://eodata.dataspace.copernicus.eu",
            "region": "default",
            "credentials": { "url": "https://s3-keys-manager.cloudferro.com/api/user" }
          }
        },
        "auth": {
          "issuer": "https://identity.dataspace.copernicus.eu/auth/realms/CDSE",
          "client_id": "cdse-public"
        }
      },
      "jstex": { "password_login": true, "s3_bucket": "eodata" }
    },
    "cdse": {
      "discovery": "https://discover.dataspace.copernicus.eu",
      "platform": { "name": "cdse", "description": "Copernicus Data Space Ecosystem (asset-level STAC catalogue)" },
      "services": {
        "catalogue": { "stac": { "url": "https://stac.dataspace.copernicus.eu/v1" } },
        "data_access": {
          "s3": {
            "endpoint": "https://eodata.dataspace.copernicus.eu",
            "region": "default",
            "credentials": { "url": "https://s3-keys-manager.cloudferro.com/api/user" }
          }
        },
        "auth": {
          "issuer": "https://identity.dataspace.copernicus.eu/auth/realms/CDSE",
          "client_id": "cdse-public"
        }
      },
      "jstex": { "password_login": true, "s3_bucket": "eodata" }
    },
    "creodias": {
      "platform": { "name": "creodias", "description": "CREODIAS" },
      "services": {
        "catalogue": { "stac": { "url": "https://stac.creodias.eu/v1" } },
        "auth": { "issuer": "https://identity.cloudferro.com/auth/realms/Creodias-new" }
      },
      "jstex": { "password_login": false }
    },
    "codede": {
      "platform": { "name": "codede", "description": "CODE-DE" },
      "services": {
        "catalogue": { "stac": { "url": "https://stac.code-de.org/v1" } },
        "auth": {
          "issuer": "https://identity.cloudferro.com/auth/realms/CODE-DE3",
          "client_id": "code-de3-public"
        }
      },
      "jstex": { "password_login": false }
    }
  }
}
```

(`login_client_id` and the CREODIAS/CODE-DE S3 blocks are added when the prerequisites in spec §10 arrive; Task 7 sets `password_login` for CREODIAS/CODE-DE after probing.)

- [ ] **Step 5: Schema** — `jstex/data/profiles.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "jstex profile registry",
  "type": "object",
  "required": ["version", "profiles"],
  "properties": {
    "version": { "type": "string", "pattern": "^1\\." },
    "profiles": { "type": "object", "additionalProperties": { "$ref": "#/$defs/profile" } }
  },
  "$defs": {
    "https": { "type": "string", "pattern": "^https://" },
    "profile": {
      "type": "object",
      "properties": {
        "discovery": { "$ref": "#/$defs/https" },
        "pinned": { "type": "array", "items": { "type": "string" } },
        "platform": {
          "type": "object",
          "properties": { "name": { "type": "string" }, "description": { "type": "string" } }
        },
        "services": {
          "type": "object",
          "properties": {
            "catalogue": {
              "type": "object",
              "properties": { "stac": { "type": "object", "properties": { "url": { "$ref": "#/$defs/https" } } } }
            },
            "data_access": {
              "type": "object",
              "properties": {
                "s3": {
                  "type": "object",
                  "properties": {
                    "endpoint": { "$ref": "#/$defs/https" },
                    "region": { "type": "string" },
                    "credentials": { "type": "object", "properties": { "url": { "$ref": "#/$defs/https" } } }
                  }
                }
              }
            },
            "auth": {
              "type": "object",
              "properties": {
                "issuer": { "$ref": "#/$defs/https" },
                "client_id": { "type": "string" },
                "device_client_id": { "type": "string" }
              }
            }
          }
        },
        "jstex": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "login_client_id": { "type": "string" },
            "password_login": { "type": "boolean" },
            "offline_access": { "type": "boolean" },
            "s3_bucket": { "type": "string" },
            "stex_url": { "anyOf": [{ "$ref": "#/$defs/https" }, { "type": "null" }] },
            "basemap": { "type": "object" }
          }
        }
      }
    }
  }
}
```

- [ ] **Step 6: Implement** — `jstex/profiles.py` (registry part; Task 2 appends discovery):

```python
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
    if cached and cached.get("url") == url and time.time() - cached.get("fetched_at", 0) < CACHE_TTL_S:
        _registry = Registry(valid_profiles(cached["doc"], "cache"), "cache")
        return _registry
    doc = fetch_json(url)
    if doc is not None and isinstance(doc.get("profiles"), dict):
        _write_cache(path, url, doc)
        _registry = Registry(valid_profiles(doc, url), "github")
    elif cached and cached.get("url") == url:
        _warn_once("registry-stale", f"jstex: profile registry {url} unreachable; using the cached copy.")
        _registry = Registry(valid_profiles(cached["doc"], "cache"), "cache")
    else:
        _warn_once("registry-packaged", f"jstex: profile registry {url} unreachable; using the packaged copy.")
        _registry = Registry(valid_profiles(packaged, "packaged"), "packaged")
    return _registry
```

Add `"jsonschema>=4.20",` to `[project.optional-dependencies] test` in `pyproject.toml`, then `pip install -e ".[dev,test]"`.

- [ ] **Step 7: Run to verify they pass**

Run: `pytest tests/test_profiles.py -q && pytest -q tests`
Expected: `6 passed`; whole suite green (existing tests are unaffected: nothing uses profiles yet).

- [ ] **Step 8: Commit**

```bash
ruff format jstex tests && ruff check jstex tests
git add jstex/data jstex/profiles.py tests/conftest.py tests/test_profiles.py pyproject.toml
git commit -m "feat(profiles): profile registry with GitHub, cache and packaged sources"
```

---
### Task 2: Discovery documents and profile resolution

**Files:**
- Modify: `jstex/profiles.py` (append)
- Test: `tests/test_profiles.py` (append)

**Interfaces:**
- Consumes: `load_registry()`, `fetch_json()`, `cache_dir()`, `offline()`, `_read_cache()`, `_write_cache()`, `_warn_once()` (Task 1).
- Produces:
  - `DISCOVERY_PATHS: dict[str, str]` and `PROFILE_PATHS: dict[str, str]` — flat field → dotted path
  - `fetch_discovery(root: str) -> tuple[dict | None, str | None]` — `(document, source)`, source `"discovery" | "discovery-cache"`
  - `flatten(doc: dict, paths: dict[str, str], skip: Iterable[str] = ()) -> dict[str, Any]`
  - `@dataclass(frozen=True) class ResolvedProfile: name: str; description: str; values: dict[str, Any]; sources: dict[str, str]; discovery: str | None`
  - `resolve(name: str) -> ResolvedProfile` — raises `JstexProfileError` listing available names

- [ ] **Step 1: Write the failing tests** (append to `tests/test_profiles.py`):

```python
from jstex.profiles import JstexProfileError, flatten, resolve

DISCOVERY = "https://discover.dataspace.copernicus.eu/.well-known/eo-services.json"
CDSE_DOC = {
    "version": "1.0",
    "platform": {"name": "cdse"},
    "services": {
        "catalogue": {"stac": {"url": "https://stac.dataspace.copernicus.eu/v1"}},
        "data_access": {
            "s3": {
                "endpoint": "https://eodata.example.eu",
                "credentials": {"url": "https://keys.example.eu/api/user"},
            }
        },
        "auth": {
            "issuer": "https://identity.dataspace.copernicus.eu/auth/realms/CDSE",
            "client_id": "cdse-public",
            "device_client_id": "dev-client",
        },
    },
}


def test_flatten_maps_dotted_paths_and_skips_pinned():
    doc = {"services": {"catalogue": {"stac": {"url": "https://a"}}, "auth": {"issuer": "https://i"}}}
    paths = {"stac_url": "services.catalogue.stac.url", "issuer": "services.auth.issuer"}
    assert flatten(doc, paths) == {"stac_url": "https://a", "issuer": "https://i"}
    assert flatten(doc, paths, skip=["services.catalogue.stac.url"]) == {"issuer": "https://i"}


def test_offline_resolution_uses_the_github_profile_only():
    p = resolve("cdse-opensearch")
    assert p.values["stac_url"] == "https://stac.opensearch.dataspace.copernicus.eu/v1"
    assert p.values["password_client_id"] == "cdse-public"
    assert p.sources["stac_url"] == "packaged" and p.discovery is None


@responses.activate
def test_discovery_overrides_profile_except_pinned(monkeypatch):
    monkeypatch.setenv("JSTEX_PROFILES_URL", REGISTRY_URL)
    responses.get(REGISTRY_URL, status=503)  # packaged registry
    responses.get(DISCOVERY, json=CDSE_DOC)
    pinned = resolve("cdse-opensearch")
    assert pinned.values["stac_url"] == "https://stac.opensearch.dataspace.copernicus.eu/v1"
    assert pinned.values["s3_endpoint"] == "https://eodata.example.eu"
    assert pinned.sources["s3_endpoint"] == "discovery"
    assert pinned.values["login_client_id"] == "dev-client"  # device_client_id
    assert pinned.values["password_client_id"] == "cdse-public"
    free = resolve("cdse")
    assert free.values["stac_url"] == "https://stac.dataspace.copernicus.eu/v1"
    # Same discovery root as above: served from the fresh disk cache this time.
    assert free.sources["stac_url"] == "discovery-cache"


@responses.activate
def test_discovery_client_id_never_becomes_the_device_client(monkeypatch):
    monkeypatch.setenv("JSTEX_PROFILES_URL", REGISTRY_URL)
    responses.get(REGISTRY_URL, status=503)
    doc = json.loads(json.dumps(CDSE_DOC))
    del doc["services"]["auth"]["device_client_id"]
    responses.get(DISCOVERY, json=doc)
    assert "login_client_id" not in resolve("cdse").values


@responses.activate
def test_html_discovery_is_ignored_and_stale_cache_used(monkeypatch):
    monkeypatch.setenv("JSTEX_PROFILES_URL", REGISTRY_URL)
    responses.get(REGISTRY_URL, status=503)
    responses.get(DISCOVERY, json=CDSE_DOC)
    resolve("cdse")
    cached = next((profiles.cache_dir() / "discovery").glob("*.json"))
    data = json.loads(cached.read_text())
    data["fetched_at"] = 0
    cached.write_text(json.dumps(data))
    responses.replace(responses.GET, DISCOVERY, body="<html>login</html>", status=200)
    profiles.reset()
    p = resolve("cdse")
    assert p.values["s3_endpoint"] == "https://eodata.example.eu"
    assert p.sources["s3_endpoint"] == "discovery-cache"


@responses.activate
def test_http_urls_in_discovery_are_rejected(monkeypatch):
    monkeypatch.setenv("JSTEX_PROFILES_URL", REGISTRY_URL)
    responses.get(REGISTRY_URL, status=503)
    doc = json.loads(json.dumps(CDSE_DOC))
    doc["services"]["catalogue"]["stac"]["url"] = "http://evil.example/v1"
    responses.get(DISCOVERY, json=doc)
    with pytest.warns(UserWarning, match="discovery"):
        p = resolve("cdse")
    assert p.values["stac_url"] == "https://stac.dataspace.copernicus.eu/v1"


def test_unknown_profile_lists_the_available_ones():
    with pytest.raises(JstexProfileError, match="cdse-opensearch"):
        resolve("nope")
```

- [ ] **Step 2: Run to verify they fail**

Run: `pytest tests/test_profiles.py -q`
Expected: `ImportError: cannot import name 'flatten' from 'jstex.profiles'`.

- [ ] **Step 3: Implement** (append to `jstex/profiles.py`; add `import hashlib` and `from collections.abc import Iterable` to the imports):

```python
# Flat field -> dotted path. Discovery never supplies jstex-only fields, and
# its `services.auth.client_id` is the password client, never the device one.
DISCOVERY_PATHS: dict[str, str] = {
    "stac_url": "services.catalogue.stac.url",
    "issuer": "services.auth.issuer",
    "password_client_id": "services.auth.client_id",
    "login_client_id": "services.auth.device_client_id",
    "s3_endpoint": "services.data_access.s3.endpoint",
    "s3_region": "services.data_access.s3.region",
    "s3_keys_url": "services.data_access.s3.credentials.url",
}
PROFILE_PATHS: dict[str, str] = {
    **DISCOVERY_PATHS,
    "login_client_id": "jstex.login_client_id",
    "password_login": "jstex.password_login",
    "offline_access": "jstex.offline_access",
    "s3_bucket": "jstex.s3_bucket",
    "stex_url": "jstex.stex_url",
    "basemap": "jstex.basemap",
}


@dataclass(frozen=True)
class ResolvedProfile:
    name: str
    description: str
    values: dict[str, Any]
    sources: dict[str, str]
    discovery: str | None  # "discovery" | "discovery-cache" | None


def _get(doc: Any, dotted: str) -> Any:
    node = doc
    for part in dotted.split("."):
        if not isinstance(node, dict) or part not in node:
            return None
        node = node[part]
    return node


def flatten(doc: dict, paths: dict[str, str], skip: Iterable[str] = ()) -> dict[str, Any]:
    skipped = set(skip)
    out: dict[str, Any] = {}
    for field_name, dotted in paths.items():
        if dotted in skipped:
            continue
        value = _get(doc, dotted)
        if value is not None:
            out[field_name] = value
    return out


def _discovery_ok(doc: dict | None, root: str) -> bool:
    if not doc or not isinstance(doc.get("services"), dict):
        return False
    if any(not u.startswith("https://") for u in _urls(doc)):
        _warn_once(f"discovery-http:{root}", f"jstex: discovery document of {root} ignored (non-https URLs).")
        return False
    return True


def fetch_discovery(root: str) -> tuple[dict | None, str | None]:
    if offline():
        return None, None
    url = f"{root.rstrip('/')}/.well-known/eo-services.json"
    path = cache_dir() / "discovery" / f"{hashlib.sha256(url.encode()).hexdigest()[:16]}.json"
    cached = _read_cache(path)
    if cached and time.time() - cached.get("fetched_at", 0) < CACHE_TTL_S and _discovery_ok(cached["doc"], root):
        return cached["doc"], "discovery-cache"
    doc = fetch_json(url)
    if _discovery_ok(doc, root):
        _write_cache(path, url, doc)
        return doc, "discovery"
    if cached and _discovery_ok(cached["doc"], root):
        _warn_once(f"discovery-stale:{root}", f"jstex: discovery {url} unreachable; using the cached copy.")
        return cached["doc"], "discovery-cache"
    return None, None


def _registry_label(source: str) -> str:
    return source  # "github" | "cache" | "packaged"


def resolve(name: str) -> ResolvedProfile:
    reg = load_registry()
    profile = reg.profiles.get(name)
    if profile is None:
        raise JstexProfileError(
            f"Unknown profile {name!r}. Available: {', '.join(sorted(reg.profiles))}, or 'none'."
        )
    values = flatten(profile, PROFILE_PATHS)
    sources = {k: _registry_label(reg.source) for k in values}
    discovery_source = None
    root = profile.get("discovery")
    if root:
        doc, discovery_source = fetch_discovery(root)
        if doc:
            found = flatten(doc, DISCOVERY_PATHS, skip=profile.get("pinned") or ())
            values.update(found)
            sources.update({k: discovery_source for k in found})
    description = (profile.get("platform") or {}).get("description", "")
    return ResolvedProfile(name, description, values, sources, discovery_source)
```

- [ ] **Step 4: Run to verify they pass**

Run: `pytest tests/test_profiles.py -q`
Expected: `13 passed`.

- [ ] **Step 5: Commit**

```bash
ruff format jstex tests && ruff check jstex tests
git add jstex/profiles.py tests/test_profiles.py
git commit -m "feat(profiles): eo-services discovery, pinned fields, per-field sources"
```

---
### Task 3: Effective configuration (files, env, arguments, `jstex.config()`)

**Files:**
- Modify: `jstex/config.py` (rewrite `Config`/`load_config`; keep `Basemap` and the basemap defaults), `jstex/api.py`, `jstex/__init__.py`, `pyproject.toml` (`tomli` for 3.10)
- Test: `tests/test_config.py` (append), `tests/test_api.py` (append)

**Interfaces:**
- Consumes: `profiles.load_registry()`, `profiles.resolve()`, `profiles.fetch_discovery()`, `profiles.flatten()`, `profiles.DISCOVERY_PATHS`, `profiles.JstexProfileError` (Tasks 1–2).
- Produces:
  - `DEFAULT_PROFILE = "cdse-opensearch"`, `SYSTEM_CONFIG: Path` (module attribute, monkeypatchable), `FIELDS: tuple[str, ...]`, `ENV_VARS: dict[str, str]`
  - `@dataclass(frozen=True) class Config` with fields `stac_url, stex_url, basemap_light, basemap_dark, profile="none", issuer=None, login_client_id=None, password_client_id=None, password_login=False, offline_access=False, s3_endpoint=None, s3_region="default", s3_keys_url=None, s3_bucket=None, sources={}` (`sources` excluded from comparison and repr)
  - `load_config(*, profile: str | None = None, stac_url: str | None = None, stex_url: str | None = None, **overrides) -> Config` (unknown keyword → `TypeError`)
  - `user_config_path() -> Path`
  - `save_login_client_id(profile: str, client_id: str) -> Path`
  - `class ConfigView` (`.config`, `.rows() -> list[tuple[str, str, str]]`, text `__repr__`, `_repr_html_`)
  - `jstex.config(profile=None, **overrides) -> ConfigView`, `jstex.list_profiles() -> list[dict[str, str]]` (named `list_profiles`, not `profiles`, because `jstex.profiles` is the submodule)

- [ ] **Step 1: Write the failing tests** (append to `tests/test_config.py`):

```python
import pytest

from jstex import config as config_mod
from jstex.config import ConfigView, save_login_client_id, user_config_path
from jstex.errors import JstexError
from jstex.profiles import JstexProfileError

CDSE_ISSUER = "https://identity.dataspace.copernicus.eu/auth/realms/CDSE"


def write_user_config(text: str):
    path = user_config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    return path


def test_default_profile_is_cdse_opensearch():
    cfg = load_config()
    assert cfg.profile == "cdse-opensearch"
    assert cfg.stac_url == DEFAULT_STAC_URL
    assert cfg.issuer == CDSE_ISSUER
    assert cfg.password_client_id == "cdse-public" and cfg.password_login is True
    assert cfg.s3_bucket == "eodata"
    assert cfg.sources["stac_url"] == "packaged"


def test_profile_from_env_and_unknown_profile(monkeypatch):
    monkeypatch.setenv("JSTEX_PROFILE", "codede")
    cfg = load_config()
    assert cfg.stac_url == "https://stac.code-de.org/v1/"
    assert cfg.issuer == "https://identity.cloudferro.com/auth/realms/CODE-DE3"
    with pytest.raises(JstexProfileError, match="Available"):
        load_config(profile="nope")


def test_own_profile_in_user_config_may_use_http():
    write_user_config(
        'profile = "lab"\n[profiles.lab]\nstac_url = "http://localhost:8080/v1"\ns3_bucket = "data"\n'
    )
    cfg = load_config()
    assert (cfg.profile, cfg.stac_url, cfg.s3_bucket) == ("lab", "http://localhost:8080/v1/", "data")
    assert cfg.issuer is None
    assert cfg.sources["stac_url"].endswith("config.toml")


def test_user_file_overrides_a_ready_made_profile_and_system_file(monkeypatch, tmp_path):
    system = tmp_path / "etc-config.toml"
    system.write_text('[profiles.cdse-opensearch]\nstex_url = "https://sys.example/"\ns3_bucket = "sys"\n')
    monkeypatch.setattr(config_mod, "SYSTEM_CONFIG", system)
    write_user_config('[profiles.cdse-opensearch]\nstex_url = "https://me.example/"\n')
    cfg = load_config()
    assert cfg.stex_url == "https://me.example/"
    assert cfg.s3_bucket == "sys"
    assert cfg.issuer == CDSE_ISSUER  # untouched fields still come from the profile


def test_env_beats_files_and_arguments_beat_env(monkeypatch):
    write_user_config('[profiles.cdse-opensearch]\ns3_bucket = "file"\n')
    monkeypatch.setenv("JSTEX_S3_BUCKET", "env")
    monkeypatch.setenv("JSTEX_PASSWORD_LOGIN", "0")
    assert load_config().s3_bucket == "env"
    assert load_config().password_login is False
    cfg = load_config(s3_bucket="arg")
    assert cfg.s3_bucket == "arg" and cfg.sources["s3_bucket"] == "argument"


def test_profile_none_needs_a_stac_url(monkeypatch):
    with pytest.raises(JstexError, match="stac_url"):
        load_config(profile="none")
    monkeypatch.setenv("JSTEX_STAC_URL", "https://stac.example.org/v1")
    cfg = load_config(profile="none")
    assert cfg.profile == "none" and cfg.issuer is None


def test_broken_config_file_is_ignored_with_one_warning():
    write_user_config("profile = \n")
    with pytest.warns(UserWarning, match="config.toml"):
        cfg = load_config()
    assert cfg.profile == "cdse-opensearch"


def test_unknown_override_is_a_type_error():
    with pytest.raises(TypeError, match="colour"):
        load_config(colour="red")


def test_save_login_client_id():
    path = save_login_client_id("cdse-opensearch", "dev-client")
    assert 'login_client_id = "dev-client"' in path.read_text()
    assert load_config().login_client_id == "dev-client"
    save_login_client_id("codede", "other")  # appends a new table
    assert load_config(profile="codede").login_client_id == "other"
    with pytest.raises(JstexError, match="edit"):
        save_login_client_id("codede", "third")  # table exists: never rewrite a user's file


def test_config_view_shows_values_and_sources():
    view = ConfigView(load_config(s3_bucket="x"))
    rows = {name: (value, source) for name, value, source in view.rows()}
    assert rows["s3_bucket"] == ("x", "argument")
    assert rows["stac_url"][1] == "packaged"
    assert "s3_bucket" in repr(view) and "<table" in view._repr_html_()
```

Append to `tests/test_api.py`:

```python
def test_public_config_helpers():
    import jstex

    assert jstex.config().config.profile == "cdse-opensearch"
    names = {p["name"] for p in jstex.list_profiles()}
    assert {"cdse-opensearch", "cdse", "creodias", "codede"} <= names
```

- [ ] **Step 2: Run to verify they fail**

Run: `pytest tests/test_config.py tests/test_api.py -q`
Expected: `ImportError: cannot import name 'ConfigView' from 'jstex.config'`.

- [ ] **Step 3: Implement** — replace everything in `jstex/config.py` below the basemap constants (`DEFAULT_BASEMAP_URL`, `DEFAULT_BASEMAP_KEY_PARAM`, `DEFAULT_BASEMAP_ATTRIBUTION`) and the `Basemap` class, which stay unchanged:

```python
# (module docstring) """Effective configuration: profile → /etc and user
# config.toml → JSTEX_* env → Python arguments (spec 2026-10-02 §3)."""

import html
import json
import os
import sys
import warnings
from collections.abc import Mapping
from pathlib import Path
from typing import Any

if sys.version_info >= (3, 11):
    import tomllib
else:  # pragma: no cover - exercised on 3.10 only
    import tomli as tomllib

from . import profiles
from .errors import JstexError

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
            warnings.warn(f"jstex: ignoring {path}: {err}", UserWarning, stacklevel=3)
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
        key_param=env(prefix + "KEY_PARAM") or base.get("key_param") or DEFAULT_BASEMAP_KEY_PARAM,
        attribution=env(prefix + "ATTRIBUTION") or base.get("attribution") or DEFAULT_BASEMAP_ATTRIBUTION,
    )


def _files() -> list[tuple[str, dict]]:
    return [
        (str(SYSTEM_CONFIG), _read_toml(SYSTEM_CONFIG)),
        (str(user_config_path()), _read_toml(user_config_path())),
    ]


def _selected_profile(argument: str | None, files: list[tuple[str, dict]]) -> str:
    if argument:
        return argument
    if os.environ.get("JSTEX_PROFILE"):
        return os.environ["JSTEX_PROFILE"]
    for _, data in reversed(files):  # user file before system file
        if isinstance(data.get("profile"), str):
            return data["profile"]
    return DEFAULT_PROFILE


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
    if name != "none":
        registry = profiles.load_registry()
        if name in registry.profiles:
            resolved = profiles.resolve(name)
            put(resolved.values, resolved.sources)
        elif not any(isinstance(p, dict) for p in own.values()):
            profiles.resolve(name)  # raises JstexProfileError listing the profiles
        else:
            for p in own.values():  # own profile with its own discovery root
                if isinstance(p, dict) and isinstance(p.get("discovery"), str):
                    doc, source = profiles.fetch_discovery(p["discovery"])
                    if doc:
                        put(profiles.flatten(doc, profiles.DISCOVERY_PATHS), source or "discovery")
    for label, p in own.items():
        if isinstance(p, dict):
            put(p, label)
    put({f: os.environ.get(var) or None for f, var in ENV_VARS.items()}, "env")
    put({"stac_url": stac_url, "stex_url": stex_url, **overrides}, "argument")

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
            out.append((name, "" if value is None else str(value), cfg.sources.get(name, "default")))
        out.append(("registry", profiles.load_registry().source, ""))
        return out

    def __repr__(self) -> str:
        width = max(len(r[0]) for r in self.rows())
        return "\n".join(f"{n:<{width}}  {v}  ({s})" if s else f"{n:<{width}}  {v}" for n, v, s in self.rows())

    def _repr_html_(self) -> str:
        cells = "".join(
            f"<tr><td><code>{html.escape(n)}</code></td><td>{html.escape(v)}</td><td>{html.escape(s)}</td></tr>"
            for n, v, s in self.rows()
        )
        return f"<table><tr><th>setting</th><th>value</th><th>source</th></tr>{cells}</table>"
```

Notes: keep the existing `from dataclasses import dataclass, field` import; delete the old `load_config` and the per-theme `DEFAULT_BASEMAP_*` usage of `_basemap(theme, url, key_param, attribution)` (replaced above).

`pyproject.toml`: add `"tomli>=2; python_version < '3.11'",` to `[project] dependencies`.

`jstex/api.py` — append:

```python
from .config import ConfigView, _files, load_config
from .profiles import load_registry


def config(profile: str | None = None, **overrides) -> ConfigView:
    """The effective settings for `profile` and where each value came from."""
    return ConfigView(load_config(profile=profile, **overrides))


def list_profiles() -> list[dict[str, str]]:
    """Ready-made profiles (registry) and own profiles (config files)."""
    reg = load_registry()
    out = [
        {"name": n, "description": (p.get("platform") or {}).get("description", ""), "source": reg.source}
        for n, p in sorted(reg.profiles.items())
    ]
    for label, data in _files():
        for n in sorted((data.get("profiles") or {})):
            if n not in reg.profiles:
                out.append({"name": n, "description": "", "source": label})
    return out
```

`jstex/__init__.py` — extend the lazy exports:

```python
__all__ = ["Explorer", "__version__", "config", "item", "list_profiles"]


def __getattr__(name: str) -> Any:
    if name == "Explorer":
        from .widget import Explorer

        return Explorer
    if name in ("item", "config", "list_profiles"):
        from . import api

        return getattr(api, name)
    raise AttributeError(f"module 'jstex' has no attribute {name!r}")
```

- [ ] **Step 4: Run to verify they pass**

Run: `pip install -e ".[dev,test]" -q && pytest -q tests`
Expected: all pass (the existing `test_defaults`, `test_env_overrides_default_and_gets_trailing_slash`, `test_kwargs_override_env`, `test_basemap_env` still pass unchanged).

- [ ] **Step 5: Commit**

```bash
ruff format jstex tests && ruff check jstex tests
git add jstex/config.py jstex/api.py jstex/__init__.py pyproject.toml tests/test_config.py tests/test_api.py
git commit -m "feat(config): profiles + config.toml + env + arguments, jstex.config() and list_profiles()"
```

---
### Task 4: OIDC helper, stored sessions and the per-issuer token chain

**Files:**
- Create: `jstex/oidc.py`, `jstex/sessions.py`, `tests/test_oidc_sessions.py`
- Modify: `jstex/auth.py` (rewrite), `tests/test_auth.py` (`"env"` → `"token"`, new tests)

**Interfaces:**
- Consumes: `Config` (Task 3: `issuer`, `offline_access`).
- Produces:
  - `jstex.oidc`: `class OidcError(JstexAuthError)` with `.error: str`, `.description: str`; `metadata(issuer: str) -> dict` (cached per process; `reset()` clears); `token_request(issuer: str, data: dict) -> dict`; `claims(token: str) -> dict` (unverified JWT payload, `{}` for non-JWT)
  - `jstex.sessions`: `@dataclass Session(client_id: str, refresh_token: str, refresh_expires_at: float | None, method: str)` (`refresh_token` excluded from repr); `class SessionStore(path: Path | None = None)` with `get(issuer) -> Session | None`, `put(issuer, session) -> None`, `drop(issuer) -> None`; `data_dir() -> Path`
  - `jstex.auth`: `Source = Literal["token","hub","session","device","password","anonymous"]`; `TokenInfo(token, source, expires_at, user="")`; `current(cfg: Config | None = None, force_refresh=False) -> TokenInfo`; `get_token(cfg=None, force_refresh=False) -> str | None`; `headers(cfg=None)`; `set_manual_token(cfg, token) -> TokenInfo`; `complete_login(cfg, *, access_token, expires_in, refresh_token, refresh_expires_in, client_id, method) -> TokenInfo`; `logout(cfg) -> None`; `whoami(cfg=None) -> dict`; `reset_cache()`; `_cache_until_override(value, cfg=None)`; `sessions() -> SessionStore` (module-level store, replaceable in tests via `auth._store = SessionStore(path)`)

- [ ] **Step 1: Write the failing tests** — `tests/test_oidc_sessions.py`:

```python
import json
import os
import stat

import pytest
import responses

from jstex import oidc
from jstex.sessions import Session, SessionStore
from tests.conftest import make_jwt

ISSUER = "https://id.example.org/realms/r"
WELL_KNOWN = ISSUER + "/.well-known/openid-configuration"
TOKEN = ISSUER + "/protocol/openid-connect/token"
META = {
    "issuer": ISSUER,
    "token_endpoint": TOKEN,
    "device_authorization_endpoint": ISSUER + "/protocol/openid-connect/auth/device",
    "revocation_endpoint": ISSUER + "/protocol/openid-connect/revoke",
}


@pytest.fixture(autouse=True)
def _reset_oidc():
    oidc.reset()
    yield
    oidc.reset()


@responses.activate
def test_metadata_is_cached_per_issuer():
    responses.get(WELL_KNOWN, json=META)
    assert oidc.metadata(ISSUER)["token_endpoint"] == TOKEN
    oidc.metadata(ISSUER + "/")
    assert len(responses.calls) == 1


@responses.activate
def test_token_error_is_typed():
    responses.get(WELL_KNOWN, json=META)
    responses.post(TOKEN, status=400, json={"error": "invalid_grant", "error_description": "Token is not active"})
    with pytest.raises(oidc.OidcError) as err:
        oidc.token_request(ISSUER, {"grant_type": "refresh_token", "refresh_token": "x", "client_id": "c"})
    assert err.value.error == "invalid_grant"
    assert "x" not in str(err.value)


def test_claims_of_jwt_and_opaque_tokens():
    assert oidc.claims(make_jwt(123.0))["sub"] == "u1"
    assert oidc.claims("opaque-token") == {}


def test_session_store_is_private_and_atomic(tmp_path):
    store = SessionStore(tmp_path / "s" / "sessions.json")
    store.put(ISSUER, Session("c", "R", None, "device"))
    path = tmp_path / "s" / "sessions.json"
    assert stat.S_IMODE(os.stat(path).st_mode) == 0o600
    assert stat.S_IMODE(os.stat(path.parent).st_mode) == 0o700
    assert store.get(ISSUER + "/").refresh_token == "R"  # trailing slash ignored
    assert "R" not in repr(store.get(ISSUER))
    assert json.loads(path.read_text())[ISSUER]["client_id"] == "c"
    store.drop(ISSUER)
    assert store.get(ISSUER) is None
```

Append to `tests/test_auth.py`. Also rename the source `"env"` to `"token"` in two existing assertions: `tests/test_auth.py::test_env_token_used_outside_hub` (`info.source == "token"`) and `tests/test_widget.py::test_collections_reply_and_auth_source` (`ex.auth_source == "token"`).

```python
from jstex import oidc
from jstex.config import load_config
from jstex.sessions import Session, SessionStore

CDSE = "https://identity.dataspace.copernicus.eu/auth/realms/CDSE"
CDSE_TOKEN = CDSE + "/protocol/openid-connect/token"


def jwt_for(issuer: str, exp: float, user: str = "alice") -> str:
    import base64

    def seg(obj):
        return base64.urlsafe_b64encode(json.dumps(obj).encode()).rstrip(b"=").decode()

    return f"{seg({'alg': 'none'})}.{seg({'exp': exp, 'iss': issuer, 'sub': 'u1', 'preferred_username': user})}.sig"


@pytest.fixture
def store(tmp_path):
    auth._store = SessionStore(tmp_path / "sessions.json")
    oidc.reset()
    yield auth._store
    auth._store = None


def mock_meta():
    """Call inside an active responses mock."""
    responses.get(CDSE + "/.well-known/openid-configuration", json={"issuer": CDSE, "token_endpoint": CDSE_TOKEN})


@responses.activate
def test_manual_token_beats_the_hub(hub_env, monkeypatch):
    monkeypatch.setenv("JSTEX_ACCESS_TOKEN", "MANUAL")
    responses.get(hub_env, json={"auth_state": {"access_token": jwt_for(CDSE, time.time() + 600)}})
    assert auth.current(load_config()).source == "token"
    assert len(responses.calls) == 0


@responses.activate
def test_hub_token_of_another_issuer_is_not_used(hub_env):
    responses.get(hub_env, json={"auth_state": {"access_token": jwt_for("https://other/realms/x", time.time() + 600)}})
    assert auth.current(load_config()).source == "anonymous"


@responses.activate
def test_hub_token_of_the_profile_issuer_is_used(hub_env):
    token = jwt_for(CDSE, time.time() + 600)
    responses.get(hub_env, json={"auth_state": {"access_token": token}})
    info = auth.current(load_config())
    assert (info.source, info.token, info.user) == ("hub", token, "alice")


@responses.activate
def test_stored_session_is_refreshed_and_rotated(store):
    mock_meta()
    store.put(CDSE, Session("dev", "R1", None, "device"))
    responses.post(
        CDSE_TOKEN,
        json={"access_token": jwt_for(CDSE, time.time() + 300), "expires_in": 300, "refresh_token": "R2"},
        match=[responses.matchers.urlencoded_params_matcher(
            {"grant_type": "refresh_token", "refresh_token": "R1", "client_id": "dev"}
        )],
    )
    info = auth.current(load_config())
    assert info.source == "session"
    assert store.get(CDSE).refresh_token == "R2"


@responses.activate
def test_invalid_grant_retries_with_a_token_another_kernel_stored(store):
    mock_meta()
    store.put(CDSE, Session("dev", "R1", None, "device"))
    bodies = []

    def token(request):
        bodies.append(request.body)
        if len(bodies) == 1:
            store.put(CDSE, Session("dev", "R2", None, "device"))  # the other kernel won the race
            return (400, {}, json.dumps({"error": "invalid_grant"}))
        return (200, {}, json.dumps({"access_token": "A", "expires_in": 300}))

    responses.add_callback(responses.POST, CDSE_TOKEN, callback=token)
    assert auth.current(load_config()).source == "session"
    assert "refresh_token=R2" in bodies[1]
    assert store.get(CDSE).refresh_token == "R2"


@responses.activate
def test_invalid_grant_without_a_newer_token_drops_the_session(store):
    mock_meta()
    store.put(CDSE, Session("dev", "R1", None, "device"))
    responses.post(CDSE_TOKEN, status=400, json={"error": "invalid_grant"})
    assert auth.current(load_config()).source == "anonymous"
    assert store.get(CDSE) is None


@responses.activate
def test_complete_login_logout_and_whoami(store):
    mock_meta()
    cfg = load_config()
    info = auth.complete_login(
        cfg, access_token=jwt_for(CDSE, time.time() + 300), expires_in=300, refresh_token="R",
        refresh_expires_in=1800, client_id="dev", method="device",
    )
    assert info.source == "device" and store.get(CDSE).method == "device"
    assert auth.whoami(cfg)["user"] == "alice"
    auth.logout(cfg)
    assert store.get(CDSE) is None
    assert auth.current(cfg).source == "anonymous"


def test_profiles_without_issuer_keep_the_v01_hub_behaviour(hub_env, monkeypatch):
    # profile 'none' has no issuer: the hub token is used as in v0.1
    monkeypatch.setenv("JSTEX_STAC_URL", "https://stac.example.org/v1")
    with responses.RequestsMock() as rsps:
        rsps.get(hub_env, json={"auth_state": {"access_token": jwt_for("https://any", time.time() + 600)}})
        assert auth.current(load_config(profile="none")).source == "hub"
```

(Add `import json` at the top of `tests/test_auth.py` if missing.)

- [ ] **Step 2: Run to verify they fail**

Run: `pytest tests/test_oidc_sessions.py tests/test_auth.py -q`
Expected: `ModuleNotFoundError: No module named 'jstex.oidc'`.

- [ ] **Step 3: Implement `jstex/oidc.py`**

```python
"""Minimal OIDC client helpers: issuer metadata and token-endpoint calls."""

from __future__ import annotations

import base64
import json
import threading

import requests

from .errors import JstexAuthError

TIMEOUT_S = 10
_meta: dict[str, dict] = {}
_lock = threading.Lock()


class OidcError(JstexAuthError):
    def __init__(self, error: str, description: str = ""):
        super().__init__(f"{error}: {description}" if description else error)
        self.error = error
        self.description = description


def reset() -> None:
    with _lock:
        _meta.clear()


def metadata(issuer: str) -> dict:
    key = issuer.rstrip("/")
    with _lock:
        if key in _meta:
            return _meta[key]
    try:
        resp = requests.get(f"{key}/.well-known/openid-configuration", timeout=TIMEOUT_S)
        resp.raise_for_status()
        data = resp.json()
    except (requests.RequestException, ValueError) as err:
        raise OidcError("discovery_failed", f"cannot read {key}/.well-known/openid-configuration") from err
    with _lock:
        _meta[key] = data
    return data


def token_request(issuer: str, data: dict) -> dict:
    endpoint = metadata(issuer)["token_endpoint"]
    try:
        resp = requests.post(endpoint, data=data, timeout=TIMEOUT_S)
    except requests.RequestException as err:
        raise OidcError("network_error", f"token endpoint unreachable ({type(err).__name__})") from err
    try:
        body = resp.json()
    except ValueError:
        body = {}
    if resp.status_code >= 400 or "error" in body:
        # Never echo the request (it may hold a password or refresh token).
        raise OidcError(str(body.get("error", f"http_{resp.status_code}")), str(body.get("error_description", "")))
    return body


def claims(token: str) -> dict:
    try:
        payload = token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        data = json.loads(base64.urlsafe_b64decode(payload))
        return data if isinstance(data, dict) else {}
    except (IndexError, ValueError):
        return {}
```

- [ ] **Step 4: Implement `jstex/sessions.py`**

```python
"""Stored login sessions: one refresh token per issuer (spec §4)."""

from __future__ import annotations

import json
import os
import tempfile
from dataclasses import asdict, dataclass, field
from pathlib import Path


def data_dir() -> Path:
    base = os.environ.get("XDG_DATA_HOME") or str(Path.home() / ".local" / "share")
    return Path(base) / "jstex"


@dataclass
class Session:
    client_id: str
    refresh_token: str = field(repr=False)
    refresh_expires_at: float | None
    method: str  # "device" | "password"


class SessionStore:
    def __init__(self, path: Path | None = None):
        self.path = path or data_dir() / "sessions.json"

    def _load(self) -> dict:
        try:
            data = json.loads(self.path.read_text())
            return data if isinstance(data, dict) else {}
        except (OSError, ValueError):
            return {}

    def _save(self, data: dict) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        os.chmod(self.path.parent, 0o700)
        fd, tmp = tempfile.mkstemp(dir=self.path.parent, suffix=".tmp")  # created 0600
        try:
            with os.fdopen(fd, "w") as fh:
                json.dump(data, fh)
            os.replace(tmp, self.path)
        except BaseException:
            Path(tmp).unlink(missing_ok=True)
            raise

    def get(self, issuer: str) -> Session | None:
        entry = self._load().get(issuer.rstrip("/"))
        try:
            return Session(**entry) if isinstance(entry, dict) else None
        except TypeError:
            return None

    def put(self, issuer: str, session: Session) -> None:
        data = self._load()
        data[issuer.rstrip("/")] = asdict(session)
        self._save(data)

    def drop(self, issuer: str) -> None:
        data = self._load()
        if data.pop(issuer.rstrip("/"), None) is not None:
            self._save(data)
```

- [ ] **Step 5: Rewrite `jstex/auth.py`** — keep `_from_hub()`, `_warn_once()`, `_jwt_exp()`, the constants and the hub warnings exactly as they are; replace the rest:

```python
"""Access-token chain per identity service (spec 2026-10-02 §4):
manual token -> JupyterHub auth_state (same issuer only) -> stored session
-> (device / password: jstex.login) -> anonymous.
Only access tokens leave this module; refresh tokens stay in the session store.
"""

# ... existing imports, constants, _warn_once, _jwt_exp, _from_hub stay ...
from typing import TYPE_CHECKING

from . import oidc
from .sessions import Session, SessionStore

if TYPE_CHECKING:
    from .config import Config

Source = Literal["token", "hub", "session", "device", "password", "anonymous"]


@dataclass(frozen=True)
class TokenInfo:
    token: str | None = field(repr=False)
    source: Source
    expires_at: float
    user: str = ""


_lock = threading.Lock()
_cached: dict[str | None, tuple[TokenInfo, float]] = {}
_manual: dict[str | None, str] = {}
_store: SessionStore | None = None


def sessions() -> SessionStore:
    global _store
    if _store is None:
        _store = SessionStore()
    return _store


def _issuer(cfg: Config | None) -> str | None:
    return cfg.issuer.rstrip("/") if cfg is not None and cfg.issuer else None


def _user(token: str | None) -> str:
    c = oidc.claims(token or "")
    return str(c.get("preferred_username") or c.get("email") or c.get("sub") or "")


def _info(token: str, source: Source, now: float, expires_in: float | None = None) -> tuple[TokenInfo, float]:
    exp = now + float(expires_in) if expires_in else (_jwt_exp(token) or now + 300)
    return TokenInfo(token, source, exp, _user(token)), max(exp - REFRESH_MARGIN_S, now + MIN_CACHE_S)


def _from_session(issuer: str, now: float) -> tuple[TokenInfo, float] | None:
    store = sessions()
    session = store.get(issuer)
    if session is None:
        return None
    for _ in range(2):  # second round: another kernel may have rotated the token
        try:
            body = oidc.token_request(
                issuer,
                {"grant_type": "refresh_token", "refresh_token": session.refresh_token, "client_id": session.client_id},
            )
        except oidc.OidcError as err:
            if err.error != "invalid_grant":
                _warn_once(f"refresh:{issuer}", f"jstex: session refresh failed ({err.error}); searching anonymously.")
                return None
            newer = store.get(issuer)
            if newer is not None and newer.refresh_token != session.refresh_token:
                session = newer
                continue
            store.drop(issuer)
            _warn_once(f"expired:{issuer}", "jstex: stored login expired; sign in again.")
            return None
        if body.get("refresh_token"):
            store.put(
                issuer,
                Session(
                    session.client_id,
                    body["refresh_token"],
                    now + float(body["refresh_expires_in"]) if body.get("refresh_expires_in") else None,
                    session.method,
                ),
            )
        return _info(body["access_token"], "session", now, body.get("expires_in"))
    return None


def _resolve(cfg: Config | None, now: float) -> tuple[TokenInfo, float]:
    issuer = _issuer(cfg)
    manual = _manual.get(issuer) or os.environ.get("JSTEX_ACCESS_TOKEN")
    if manual:
        return _info(manual, "token", now)
    hub = _from_hub()
    if hub and (issuer is None or str(oidc.claims(hub).get("iss", "")).rstrip("/") == issuer):
        return _info(hub, "hub", now)
    if issuer:
        found = _from_session(issuer, now)
        if found:
            return found
    return TokenInfo(None, "anonymous", now + ANON_CACHE_S), now + ANON_CACHE_S


def current(cfg: Config | None = None, force_refresh: bool = False) -> TokenInfo:
    key = _issuer(cfg)
    with _lock:
        now = time.time()
        hit = _cached.get(key)
        if not force_refresh and hit is not None and now < hit[1]:
            return hit[0]
        _cached[key] = _resolve(cfg, now)
        return _cached[key][0]


def get_token(cfg: Config | None = None, force_refresh: bool = False) -> str | None:
    return current(cfg, force_refresh).token


def headers(cfg: Config | None = None) -> dict[str, str]:
    token = get_token(cfg)
    return {"Authorization": f"Bearer {token}"} if token else {}


def set_manual_token(cfg: Config | None, token: str) -> TokenInfo:
    with _lock:
        _manual[_issuer(cfg)] = token
        _cached.pop(_issuer(cfg), None)
    return current(cfg)


def complete_login(
    cfg: Config,
    *,
    access_token: str,
    expires_in: float | None,
    refresh_token: str | None,
    refresh_expires_in: float | None,
    client_id: str,
    method: Source,
) -> TokenInfo:
    issuer = _issuer(cfg)
    now = time.time()
    if issuer and refresh_token:
        sessions().put(
            issuer,
            Session(client_id, refresh_token, now + float(refresh_expires_in) if refresh_expires_in else None, method),
        )
    with _lock:
        _cached[issuer] = _info(access_token, method, now, expires_in)
        return _cached[issuer][0]


def logout(cfg: Config) -> None:
    issuer = _issuer(cfg)
    if issuer:
        session = sessions().get(issuer)
        if session is not None:
            endpoint = None
            try:
                endpoint = oidc.metadata(issuer).get("revocation_endpoint")
            except oidc.OidcError:
                pass
            if endpoint:
                try:
                    requests.post(
                        endpoint,
                        data={"token": session.refresh_token, "client_id": session.client_id, "token_type_hint": "refresh_token"},
                        timeout=HUB_TIMEOUT_S,
                    )
                except requests.RequestException:
                    pass  # best effort; the local session is dropped anyway
            sessions().drop(issuer)
    with _lock:
        _manual.pop(issuer, None)
        _cached[issuer] = (TokenInfo(None, "anonymous", time.time() + ANON_CACHE_S), time.time() + ANON_CACHE_S)


def whoami(cfg: Config | None = None) -> dict:
    info = current(cfg)
    return {"source": info.source, "user": info.user, "expires_at": info.expires_at}


def reset_cache() -> None:
    with _lock:
        _cached.clear()
        _manual.clear()
        _warned.clear()


def _cache_until_override(value: float, cfg: Config | None = None) -> None:
    """Test hook: pretend the cache window for `cfg`'s issuer ended at `value`."""
    with _lock:
        key = _issuer(cfg)
        if key in _cached:
            _cached[key] = (_cached[key][0], value)
```

Note: `logout` caches "anonymous" for the issuer, so the hub/manual chain is not consulted again until the cache window ends; that is intended (the user asked to sign out).

- [ ] **Step 6: Run to verify they pass**

Run: `pytest -q tests`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
ruff format jstex tests && ruff check jstex tests
git add jstex/oidc.py jstex/sessions.py jstex/auth.py tests/test_oidc_sessions.py tests/test_auth.py tests/test_widget.py
git commit -m "feat(auth): per-issuer token chain with hub issuer check and stored sessions"
```

---
### Task 5: Wire profiles and the token chain into STAC, `Explorer` and `jstex.item`

**Files:**
- Modify: `jstex/stac.py`, `jstex/widget.py`, `jstex/api.py`, `js/types.ts`
- Test: `tests/test_stac.py`, `tests/test_widget.py`, `tests/test_api.py` (append)

**Interfaces:**
- Consumes: `load_config(profile=…)`, `Config` (Task 3); `auth.current(cfg, force_refresh)`, `auth.get_token(cfg)` (Task 4).
- Produces:
  - `StacBackend(url, *, retry=None, timeout=30, auth_config: Config | None = None)`; token attached only when the request origin is in `{url, auth_config.issuer, auth_config.s3_keys_url}` origins
  - `Explorer(*, profile: str | None = None, stac_url: str | None = None, height=600, backend=None, runner=None, **kwargs)`; new synced trait `profile_name = Unicode("")`; `Explorer.config -> Config` (read-only property)
  - `jstex.item(href, *, profile=None, stac_url=None) -> pystac.Item`
  - JS: `export type AuthSource = 'hub' | 'token' | 'session' | 'device' | 'password' | 'anonymous';`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_stac.py`:

```python
@responses.activate
def test_token_goes_to_the_profile_origins_only(monkeypatch):
    from jstex.config import load_config

    monkeypatch.setenv("JSTEX_ACCESS_TOKEN", "T")
    cfg = load_config(
        profile="none",
        stac_url=URL,
        issuer="https://id.test/realms/r",
        s3_keys_url="https://keys.test/api/user",
    )
    for href in ("https://id.test/a", "https://keys.test/a", "https://evil.example.org/a"):
        responses.get(href, json=item("a"))
    b = StacBackend(cfg.stac_url, auth_config=cfg)
    for href in ("https://id.test/a", "https://keys.test/a", "https://evil.example.org/a"):
        b.read_item(href)
    sent = [c.request.headers.get("Authorization") for c in responses.calls]
    assert sent == ["Bearer T", "Bearer T", None]
```

Append to `tests/test_widget.py`:

```python
def test_explorer_uses_the_selected_profile():
    ex = Explorer(profile="codede", backend=FakeBackend(), runner=sync_runner)
    assert ex.profile_name == "codede"
    assert ex.config.stac_url == "https://stac.code-de.org/v1/"


def test_explorer_default_profile_name():
    ex, _ = make(FakeBackend())
    assert ex.profile_name == "cdse-opensearch"
```

Append to `tests/test_api.py`:

```python
@responses.activate
def test_item_uses_the_profile_stac_host_for_the_token(monkeypatch):
    import jstex

    monkeypatch.setenv("JSTEX_ACCESS_TOKEN", "T")
    href = "https://stac.code-de.org/v1/collections/c/items/a"
    responses.get(href, json={
        "type": "Feature", "stac_version": "1.0.0", "id": "a", "geometry": None,
        "properties": {"datetime": "2024-01-01T00:00:00Z"}, "links": [], "assets": {},
    })
    jstex.item(href, profile="codede")
    assert responses.calls[0].request.headers["Authorization"] == "Bearer T"
```

(Add `import responses` to `tests/test_api.py` if missing.)

- [ ] **Step 2: Run to verify they fail**

Run: `pytest tests/test_stac.py tests/test_widget.py tests/test_api.py -q`
Expected: `TypeError: StacBackend.__init__() got an unexpected keyword argument 'auth_config'`, `TypeError ... unexpected keyword argument 'profile'`.

- [ ] **Step 3: Implement `jstex/stac.py`**

```python
# imports: add
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .config import Config


class StacBackend:
    def __init__(
        self,
        url: str,
        *,
        retry: Retry | None = None,
        timeout: float = 30,
        auth_config: Config | None = None,
    ):
        self.url = url
        self._auth_config = auth_config
        candidates = [url]
        if auth_config is not None:
            candidates += [auth_config.issuer, auth_config.s3_keys_url]
        self._origins = {_origin(u) for u in candidates if u}
        self.io = StacApiIO(
            request_modifier=self._add_auth,
            timeout=timeout,
            max_retries=retry or default_retry(),
        )
        self._queryables: dict[str, dict] = {}

    def _add_auth(self, request: Request) -> Request:
        # Only the profile's own services get the user's token: item self links
        # and rel=next hrefs are server data and may point anywhere.
        if _origin(request.url) not in self._origins:
            return request
        token = auth.get_token(self._auth_config)
        if token:
            request.headers["Authorization"] = f"Bearer {token}"
        return request
```

In `_read`, change the 401 branch to `auth.current(self._auth_config, force_refresh=True)`.

- [ ] **Step 4: Implement `jstex/widget.py`**

```python
    profile_name = traitlets.Unicode("").tag(sync=True)  # active profile

    def __init__(
        self,
        *,
        profile: str | None = None,
        stac_url: str | None = None,
        height: int = 600,
        backend: StacBackend | None = None,
        runner: Runner | None = None,
        **kwargs: Any,
    ):
        run = runner or DEFAULT_RUNNER
        config = load_config(profile=profile, stac_url=stac_url)
        super().__init__(
            query=QueryState().to_dict(),
            map_height=height,
            can_cancel=run is not sync_runner,
            profile_name=config.profile,
            basemap={...},  # unchanged
            **kwargs,
        )
        self._config = config
        self._backend = backend or StacBackend(config.stac_url, auth_config=config)
        # ... rest unchanged

    @property
    def config(self) -> Config:
        """The effective settings of this explorer (see jstex.config())."""
        return self._config
```

In `_reply_collections`: `self.auth_source = auth.current(self._config).source`. Import `Config` from `.config`.

- [ ] **Step 5: Implement `jstex/api.py` `item()`**

```python
def item(href: str, *, profile: str | None = None, stac_url: str | None = None) -> pystac.Item:
    """Open a STAC item by URL with the user's token (restricted collections work)."""
    cfg = load_config(profile=profile, stac_url=stac_url)
    return StacBackend(cfg.stac_url, auth_config=cfg).read_item(href)
```

- [ ] **Step 6: Widget type** — `js/types.ts`:

```ts
export type AuthSource =
  | 'hub'
  | 'token'
  | 'session'
  | 'device'
  | 'password'
  | 'anonymous';
```

- [ ] **Step 7: Run to verify they pass**

Run: `pytest -q tests && jlpm vitest run && npx tsc -p js/tsconfig.json`
Expected: all pass, tsc clean.

- [ ] **Step 8: Commit**

```bash
ruff format jstex tests && ruff check jstex tests && npx prettier --write "js/**/*.ts"
git add jstex/stac.py jstex/widget.py jstex/api.py js/types.ts tests
git commit -m "feat: profile-aware STAC client, Explorer(profile=) and jstex.item(profile=)"
```

---
### Task 6: Device-code login and `jstex.login()`

**Files:**
- Create: `jstex/login.py`, `tests/test_login.py`
- Modify: `jstex/api.py`, `jstex/__init__.py`

**Interfaces:**
- Consumes: `oidc.metadata`, `oidc.token_request`, `oidc.OidcError`, `oidc.TIMEOUT_S`; `auth.complete_login`, `auth.current`, `auth.set_manual_token`, `auth.sessions()`; `config.load_config`, `config.save_login_client_id`.
- Produces:
  - `class LoginError(JstexAuthError)` with `.reason` in `"unsupported" | "client_refused" | "need_client_id" | "denied" | "timeout" | "cancelled" | "busy" | "bad_credentials" | "needs_browser" | "error"`
  - `@dataclass(frozen=True) class DeviceCode: uri: str; code: str; expires_in: int`
  - `login_client_id(cfg: Config) -> str | None` — `cfg.login_client_id`, else the client id of a stored *device* session for the issuer
  - `device_login(cfg, *, client_id: str, show: Callable[[DeviceCode], None], cancel: threading.Event | None = None, max_wait: float = 300, sleep: Callable[[float], None] | None = None, now: Callable[[], float] | None = None) -> auth.TokenInfo` (defaults resolve `time.sleep`/`time.time` at call time, so tests can patch them)
  - `exclusive()` — context manager; raises `LoginError(reason="busy")` if a login is already running in this process
  - `status_text(info: auth.TokenInfo) -> str`
  - `jstex.login(profile=None, *, token=None, method=None, username=None, client_id=None, save=False) -> str` (Task 7 adds the password branch)

- [ ] **Step 1: Write the failing tests** — `tests/test_login.py`:

```python
import base64
import hashlib
import threading
import time
from urllib.parse import parse_qs

import pytest
import responses

from jstex import auth, oidc
from jstex.config import load_config
from jstex.login import DeviceCode, LoginError, device_login, login_client_id
from jstex.sessions import Session, SessionStore

ISSUER = "https://id.example.org/realms/r"
DEVICE = ISSUER + "/protocol/openid-connect/auth/device"
TOKEN = ISSUER + "/protocol/openid-connect/token"


@pytest.fixture
def cfg(tmp_path):
    auth._store = SessionStore(tmp_path / "sessions.json")
    oidc.reset()
    yield load_config(profile="none", stac_url="https://stac.example.org/v1", issuer=ISSUER)
    auth._store = None


def mock_meta():
    responses.get(
        ISSUER + "/.well-known/openid-configuration",
        json={"issuer": ISSUER, "token_endpoint": TOKEN, "device_authorization_endpoint": DEVICE},
    )


def device_ok():
    responses.post(DEVICE, json={
        "device_code": "DC", "user_code": "ABCD-EFGH",
        "verification_uri": ISSUER + "/device", "verification_uri_complete": ISSUER + "/device?user_code=ABCD-EFGH",
        "expires_in": 600, "interval": 5,
    })


@responses.activate
def test_device_login_polls_until_approved_with_pkce(cfg):
    mock_meta()
    device_ok()
    answers = iter([
        (400, {"error": "authorization_pending"}),
        (400, {"error": "slow_down"}),
        (200, {"access_token": "opaque-access", "expires_in": 300, "refresh_token": "R", "refresh_expires_in": 1800}),
    ])
    bodies = []

    def token(request):
        bodies.append(parse_qs(request.body))
        status, body = next(answers)
        import json

        return (status, {}, json.dumps(body))

    responses.add_callback(responses.POST, TOKEN, callback=token)
    shown, sleeps = [], []
    info = device_login(cfg, client_id="dev", show=shown.append, sleep=sleeps.append)
    assert shown == [DeviceCode(ISSUER + "/device?user_code=ABCD-EFGH", "ABCD-EFGH", 600)]
    assert sleeps == [5.0, 5.0, 10.0]  # slow_down adds 5 s
    assert info.source == "device" and info.token == "opaque-access"
    assert abs(info.expires_at - (time.time() + 300)) < 5  # from expires_in, not the JWT
    start = parse_qs(responses.calls[1].request.body)
    assert start["code_challenge_method"] == ["S256"] and start["client_id"] == ["dev"]
    verifier = bodies[0]["code_verifier"][0]
    expected = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    assert start["code_challenge"] == [expected]
    stored = auth._store.get(ISSUER)
    assert (stored.client_id, stored.refresh_token, stored.method) == ("dev", "R", "device")


@responses.activate
def test_refused_client_is_reported(cfg):
    mock_meta()
    responses.post(DEVICE, status=401, json={"error": "unauthorized_client"})
    with pytest.raises(LoginError) as err:
        device_login(cfg, client_id="cdse-public", show=print, sleep=lambda s: None)
    assert err.value.reason == "client_refused"


@responses.activate
def test_expired_code_and_cancel(cfg):
    mock_meta()
    device_ok()
    responses.post(TOKEN, status=400, json={"error": "expired_token"})
    with pytest.raises(LoginError) as err:
        device_login(cfg, client_id="dev", show=lambda c: None, sleep=lambda s: None)
    assert err.value.reason == "timeout"
    device_ok()
    cancel = threading.Event()
    cancel.set()
    with pytest.raises(LoginError) as err:
        device_login(cfg, client_id="dev", show=lambda c: None, cancel=cancel, sleep=lambda s: None)
    assert err.value.reason == "cancelled"


def test_client_id_from_config_or_a_remembered_device_session(cfg):
    assert login_client_id(cfg) is None
    auth._store.put(ISSUER, Session("remembered", "R", None, "device"))
    assert login_client_id(cfg) == "remembered"
    assert login_client_id(load_config(profile="none", stac_url="https://s/v1", issuer=ISSUER, login_client_id="cfg")) == "cfg"
    auth._store.put(ISSUER, Session("pw", "R", None, "password"))
    assert login_client_id(cfg) is None  # a password client is not a device client


@responses.activate
def test_jstex_login_asks_for_a_client_id_and_can_save_it(cfg, monkeypatch):
    import jstex

    mock_meta()
    device_ok()
    responses.post(TOKEN, json={"access_token": "A", "expires_in": 300, "refresh_token": "R"})
    monkeypatch.setenv("JSTEX_STAC_URL", "https://stac.example.org/v1")
    monkeypatch.setenv("JSTEX_OIDC_ISSUER", ISSUER)
    monkeypatch.setattr("builtins.input", lambda prompt="": "typed-client")
    monkeypatch.setattr("jstex.login.time.sleep", lambda s: None)
    status = jstex.login(profile="none", method="device", save=False)
    assert status.startswith("Signed in (device login)")
    assert auth._store.get(ISSUER).client_id == "typed-client"


@responses.activate
def test_jstex_login_with_a_token(cfg):
    import jstex

    assert jstex.login(profile="cdse-opensearch", token="MANUAL").startswith("Signed in (token)")
```

- [ ] **Step 2: Run to verify they fail**

Run: `pytest tests/test_login.py -q`
Expected: `ModuleNotFoundError: No module named 'jstex.login'`.

- [ ] **Step 3: Implement `jstex/login.py`**

```python
"""Interactive login (spec 2026-10-02 §4 steps 4-5): device code with PKCE,
and (Task 7) the password grant. Runs only on user action."""

from __future__ import annotations

import base64
import hashlib
import secrets
import threading
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from typing import TYPE_CHECKING

import requests

from . import auth, oidc
from .errors import JstexAuthError

if TYPE_CHECKING:
    from .config import Config

MAX_WAIT_S = 300
_login_lock = threading.Lock()
LABELS = {
    "token": "token",
    "hub": "hub",
    "session": "session",
    "device": "device login",
    "password": "password",
}


class LoginError(JstexAuthError):
    def __init__(self, message: str, reason: str = "error"):
        super().__init__(message)
        self.reason = reason


@dataclass(frozen=True)
class DeviceCode:
    uri: str
    code: str
    expires_in: int


@contextmanager
def exclusive() -> Iterator[None]:
    if not _login_lock.acquire(blocking=False):
        raise LoginError("A sign-in is already in progress.", "busy")
    try:
        yield
    finally:
        _login_lock.release()


def status_text(info: auth.TokenInfo) -> str:
    if info.source == "anonymous":
        return "Not signed in."
    who = f" as {info.user}" if info.user else ""
    return f"Signed in ({LABELS[info.source]}){who}."


def login_client_id(cfg: Config) -> str | None:
    if cfg.login_client_id:
        return cfg.login_client_id
    if cfg.issuer:
        session = auth.sessions().get(cfg.issuer)
        if session is not None and session.method == "device":
            return session.client_id
    return None


def _pkce() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(64)
    digest = hashlib.sha256(verifier.encode()).digest()
    return verifier, base64.urlsafe_b64encode(digest).rstrip(b"=").decode()


def scope(cfg: Config) -> str:
    return "openid offline_access" if cfg.offline_access else "openid"


def _finish(cfg: Config, tokens: dict, client_id: str, method: str) -> auth.TokenInfo:
    return auth.complete_login(
        cfg,
        access_token=tokens["access_token"],
        expires_in=tokens.get("expires_in"),
        refresh_token=tokens.get("refresh_token"),
        refresh_expires_in=tokens.get("refresh_expires_in"),
        client_id=client_id,
        method=method,  # type: ignore[arg-type]
    )


def device_login(
    cfg: Config,
    *,
    client_id: str,
    show: Callable[[DeviceCode], None],
    cancel: threading.Event | None = None,
    max_wait: float = MAX_WAIT_S,
    sleep: Callable[[float], None] | None = None,
    now: Callable[[], float] | None = None,
) -> auth.TokenInfo:
    sleep = sleep or time.sleep
    now = now or time.time
    if not cfg.issuer:
        raise LoginError("This profile has no identity service (issuer).", "unsupported")
    endpoint = oidc.metadata(cfg.issuer).get("device_authorization_endpoint")
    if not endpoint:
        raise LoginError("The identity service does not offer device login.", "unsupported")
    verifier, challenge = _pkce()
    try:
        resp = requests.post(
            endpoint,
            data={"client_id": client_id, "scope": scope(cfg), "code_challenge": challenge, "code_challenge_method": "S256"},
            timeout=oidc.TIMEOUT_S,
        )
        body = resp.json()
    except (requests.RequestException, ValueError) as err:
        raise LoginError("The identity service could not start a device login.") from err
    if resp.status_code >= 400 or "error" in body:
        error = str(body.get("error", ""))
        if error in ("unauthorized_client", "invalid_client"):
            raise LoginError(f"Client {client_id!r} is not allowed to use device login.", "client_refused")
        raise LoginError(f"Device login failed ({error or resp.status_code}).")
    expires_in = int(body.get("expires_in", max_wait))
    show(DeviceCode(body.get("verification_uri_complete") or body["verification_uri"], body["user_code"], expires_in))
    interval = float(body.get("interval", 5))
    deadline = now() + min(max_wait, expires_in)
    while True:
        if cancel is not None and cancel.is_set():
            raise LoginError("Sign-in cancelled.", "cancelled")
        if now() >= deadline:
            raise LoginError("The code expired before sign-in was completed.", "timeout")
        sleep(interval)
        if cancel is not None and cancel.is_set():
            raise LoginError("Sign-in cancelled.", "cancelled")
        try:
            tokens = oidc.token_request(
                cfg.issuer,
                {
                    "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
                    "device_code": body["device_code"],
                    "client_id": client_id,
                    "code_verifier": verifier,
                },
            )
        except oidc.OidcError as err:
            if err.error == "authorization_pending":
                continue
            if err.error == "slow_down":
                interval += 5
                continue
            if err.error == "access_denied":
                raise LoginError("Sign-in was denied.", "denied") from err
            if err.error == "expired_token":
                raise LoginError("The code expired before sign-in was completed.", "timeout") from err
            raise LoginError(f"Device login failed ({err.error}).") from err
        return _finish(cfg, tokens, client_id, "device")


class _CellDisplay:
    """Device code as updating HTML in a notebook cell (print elsewhere)."""

    def __init__(self) -> None:
        self._handle = None

    def show(self, code: DeviceCode) -> None:
        import html

        text = (
            f'Open <a href="{html.escape(code.uri)}" target="_blank" rel="noopener">{html.escape(code.uri)}</a> '
            f"and confirm the code <b><code>{html.escape(code.code)}</code></b> "
            f"(valid {code.expires_in // 60} min)."
        )
        try:
            from IPython.display import HTML, display

            self._handle = display(HTML(text), display_id=True)
        except ImportError:
            print(f"Open {code.uri} and confirm the code {code.code}.")

    def done(self, message: str) -> None:
        if self._handle is not None:
            from IPython.display import HTML

            self._handle.update(HTML(message))
```

- [ ] **Step 4: Implement `jstex.login()`** — append to `jstex/api.py`:

```python
from . import auth
from .config import save_login_client_id
from .login import LoginError, _CellDisplay, device_login, exclusive, login_client_id, status_text


def login(
    profile: str | None = None,
    *,
    token: str | None = None,
    method: str | None = None,
    username: str | None = None,
    client_id: str | None = None,
    save: bool = False,
) -> str:
    """Sign in for `profile` (default: the active one) and return a status line.

    token=...        use this access token (manual)
    method="device"  device code: open a link, confirm a code (default when possible)
    method="password" username and password (Task 7)
    client_id=...    device-login client id; asked for when none is configured
    save=True        also write that client id to ~/.config/jstex/config.toml
    """
    cfg = load_config(profile=profile)
    if token:
        return status_text(auth.set_manual_token(cfg, token))
    if method is None and auth.current(cfg).source != "anonymous":
        return status_text(auth.current(cfg))
    with exclusive():
        if method in (None, "device"):
            cid = client_id or login_client_id(cfg)
            if cid is None and (method == "device" or not (cfg.password_login and cfg.password_client_id)):
                cid = input("Device-login client id: ").strip() or None
            if cid is not None:
                display = _CellDisplay()
                try:
                    info = device_login(cfg, client_id=cid, show=display.show)
                except LoginError as err:
                    if err.reason != "client_refused" or method == "device" or not cfg.password_login:
                        raise
                else:
                    if save:
                        save_login_client_id(cfg.profile, cid)
                    display.done(status_text(info))
                    return status_text(info)
        return _password(cfg, username)  # Task 7


def _password(cfg, username):  # replaced in Task 7
    raise LoginError("No device-login client id; set login_client_id or pass client_id=.", "need_client_id")
```

`jstex/__init__.py`: add `"login"` to `__all__` and to the names served from `api` in `__getattr__`.

- [ ] **Step 5: Run to verify they pass**

Run: `pytest -q tests`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
ruff format jstex tests && ruff check jstex tests
git add jstex/login.py jstex/api.py jstex/__init__.py tests/test_login.py
git commit -m "feat(login): device-code login with PKCE and jstex.login()"
```

---
### Task 7: Password login, `jstex.logout()`, `jstex.whoami()`

**Files:**
- Modify: `jstex/login.py`, `jstex/api.py`, `jstex/__init__.py`, `jstex/data/profiles.json` (probe results)
- Test: `tests/test_login.py` (append)

**Interfaces:**
- Consumes: `login.scope`, `login._finish`, `login.LoginError`, `login.exclusive`, `login.status_text` (Task 6); `auth.logout`, `auth.whoami` (Task 4).
- Produces:
  - `password_login(cfg: Config, *, username: str, password: str, client_id: str | None = None) -> auth.TokenInfo`
  - `jstex.login(..., method="password")` path; `jstex.logout(profile=None) -> str`; `jstex.whoami(profile=None) -> dict` (`source`, `user`, `expires_at`)
  - `jstex.access_token(profile=None) -> str | None` — the current access token for the user's own requests

- [ ] **Step 1: Write the failing tests** (append to `tests/test_login.py`):

```python
import logging

from jstex.login import password_login


@responses.activate
def test_password_login_stores_a_password_session(cfg):
    mock_meta()
    cfg2 = load_config(profile="none", stac_url="https://s/v1", issuer=ISSUER, password_client_id="pub")
    responses.post(
        TOKEN,
        json={"access_token": "A", "expires_in": 300, "refresh_token": "R"},
        match=[responses.matchers.urlencoded_params_matcher(
            {"grant_type": "password", "username": "alice", "password": "s3cret", "client_id": "pub", "scope": "openid"}
        )],
    )
    info = password_login(cfg2, username="alice", password="s3cret")
    assert info.source == "password"
    assert auth._store.get(ISSUER).method == "password"


@responses.activate
@pytest.mark.parametrize(
    ("body", "reason"),
    [
        ({"error": "invalid_grant", "error_description": "Invalid user credentials"}, "bad_credentials"),
        ({"error": "invalid_grant", "error_description": "Account is not fully set up"}, "needs_browser"),
        ({"error": "unauthorized_client", "error_description": "Client not allowed for direct access grants"}, "unsupported"),
    ],
)
def test_password_errors_never_leak_the_password(cfg, caplog, body, reason):
    mock_meta()
    cfg2 = load_config(profile="none", stac_url="https://s/v1", issuer=ISSUER, password_client_id="pub")
    responses.post(TOKEN, status=401, json=body)
    caplog.set_level(logging.DEBUG)
    with pytest.raises(LoginError) as err:
        password_login(cfg2, username="alice", password="s3cret")
    assert err.value.reason == reason
    assert "s3cret" not in str(err.value) and "s3cret" not in repr(err.value.__cause__)
    assert "s3cret" not in caplog.text


@responses.activate
def test_jstex_login_password_logout_whoami(cfg, monkeypatch):
    import jstex

    mock_meta()
    responses.post(TOKEN, json={"access_token": "A", "expires_in": 300, "refresh_token": "R"})
    monkeypatch.setenv("JSTEX_STAC_URL", "https://stac.example.org/v1")
    monkeypatch.setenv("JSTEX_OIDC_ISSUER", ISSUER)
    monkeypatch.setenv("JSTEX_PASSWORD_CLIENT_ID", "pub")
    monkeypatch.setenv("JSTEX_PASSWORD_LOGIN", "1")
    monkeypatch.setattr("getpass.getpass", lambda prompt="": "s3cret")
    assert jstex.login(profile="none", method="password", username="alice").startswith("Signed in (password)")
    assert jstex.whoami(profile="none")["source"] == "password"
    assert jstex.logout(profile="none") == "Signed out."
    assert jstex.whoami(profile="none")["source"] == "anonymous"


def test_access_token_for_the_users_own_requests(monkeypatch):
    import jstex

    monkeypatch.setenv("JSTEX_ACCESS_TOKEN", "T")
    assert jstex.access_token() == "T"
    monkeypatch.delenv("JSTEX_ACCESS_TOKEN")
    auth.reset_cache()
    assert jstex.access_token() is None
```

- [ ] **Step 2: Run to verify they fail**

Run: `pytest tests/test_login.py -q`
Expected: `ImportError: cannot import name 'password_login' from 'jstex.login'`.

- [ ] **Step 3: Implement `password_login`** (append to `jstex/login.py`):

```python
def password_login(
    cfg: Config, *, username: str, password: str, client_id: str | None = None
) -> auth.TokenInfo:
    """Resource-owner password grant. The password is sent once and never kept."""
    cid = client_id or cfg.password_client_id
    if not cfg.issuer or not cid:
        raise LoginError("This profile has no client for password login.", "unsupported")
    try:
        tokens = oidc.token_request(
            cfg.issuer,
            {"grant_type": "password", "username": username, "password": password, "client_id": cid, "scope": scope(cfg)},
        )
    except oidc.OidcError as err:
        text = err.description.lower()
        if err.error == "invalid_grant" and ("not fully set up" in text or "required action" in text or "otp" in text):
            raise LoginError(
                "This account needs a browser login (MFA or required action); use device login.", "needs_browser"
            ) from None
        if err.error == "invalid_grant":
            raise LoginError("Wrong username or password.", "bad_credentials") from None
        if err.error in ("unauthorized_client", "unsupported_grant_type", "invalid_client"):
            raise LoginError("Password login is not allowed for this profile's client.", "unsupported") from None
        raise LoginError(f"Password login failed ({err.error}).") from None
    return _finish(cfg, tokens, cid, "password")
```

(`from None` drops the `OidcError` cause: its description is server text and must not be logged alongside anything user-supplied.)

- [ ] **Step 4: Implement the API** — in `jstex/api.py` replace the `_password` stub and add `logout`/`whoami`:

```python
import getpass

from .login import password_login


def _password(cfg, username: str | None) -> str:
    if not (cfg.password_login and cfg.password_client_id):
        raise LoginError(
            "No sign-in method available: set login_client_id (device login) or pass client_id=.",
            "need_client_id",
        )
    user = username or input("Username: ").strip()
    info = password_login(cfg, username=user, password=getpass.getpass("Password: "))
    return status_text(info)


def logout(profile: str | None = None) -> str:
    """Forget the stored login for `profile`'s identity service."""
    auth.logout(load_config(profile=profile))
    return "Signed out."


def whoami(profile: str | None = None) -> dict:
    """How jstex is signed in for `profile`: source, user name and expiry."""
    return auth.whoami(load_config(profile=profile))


def access_token(profile: str | None = None) -> str | None:
    """The current access token for `profile` (None when anonymous), for your
    own HTTP requests. jstex sends it only to the profile's own services; where
    else you send it is your decision."""
    return auth.get_token(load_config(profile=profile))
```

In `login()`, the final `return _password(cfg, username)` now reaches this function; also send `method == "password"` straight to it (change the device branch condition to `if method in (None, "device"):` — already so — and make the function end with `return _password(cfg, username)`).

`jstex/__init__.py`: add `"logout"`, `"whoami"` and `"access_token"` to `__all__` and the `api` names in `__getattr__`.

- [ ] **Step 5: Probe which public clients allow password login** (dummy credentials; the grant's error tells whether it is enabled — `invalid_grant` = allowed, `unauthorized_client` = not):

```bash
for realm_client in "CODE-DE3 code-de3-public" "Creodias-new CLOUDFERRO_PUBLIC"; do
  set -- $realm_client
  curl -s -X POST "https://identity.cloudferro.com/auth/realms/$1/protocol/openid-connect/token" \
    -d grant_type=password -d client_id="$2" -d username=jstex-probe -d password=x | head -c 200; echo
done
```

Set `"password_login": true` (and, for CREODIAS, `"client_id"` in `services.auth`) in `jstex/data/profiles.json` only where the answer is `invalid_grant`; leave `false` otherwise. Record the answers in the commit message.

- [ ] **Step 6: Run to verify they pass**

Run: `pytest -q tests`
Expected: all pass (`test_packaged_registry_matches_schema` still passes after the edit).

- [ ] **Step 7: Commit**

```bash
ruff format jstex tests && ruff check jstex tests
git add jstex/login.py jstex/api.py jstex/__init__.py jstex/data/profiles.json tests/test_login.py
git commit -m "feat(login): password login, jstex.logout(), whoami(), access_token(); password_login flags from probes"
```

---
### Task 8: Widget sign-in protocol (Python side)

**Files:**
- Modify: `jstex/widget.py`
- Test: `tests/test_widget.py` (append)

**Interfaces:**
- Consumes: `login.device_login`, `login.password_login`, `login.login_client_id`, `login.exclusive`, `login.LoginError`, `login.DeviceCode` (Tasks 6–7); `auth.current`, `auth.logout`.
- Produces (protocol, mirrored by Task 9):
  - Traits: `auth_user = Unicode("")`, `login_methods = List(Unicode())` — `"device"` when the profile has an issuer, `"password"` when `password_login` and `password_client_id` are set.
  - JS → Py: `{"type": "login_start", "method": "device" | "password", "client_id"?: str}`, `{"type": "login_password", "username": str, "password": str}`, `{"type": "login_cancel"}`, `{"type": "logout"}`.
  - Py → JS: `{"type": "login", "state": "need_client_id"}`, `{"type": "login", "state": "password"}` (show the password form), `{"type": "login", "state": "device", "uri": str, "code": str, "expires_in": int}`, `{"type": "login", "state": "done"}`, `{"type": "login", "state": "signed_out"}`, `{"type": "login", "state": "error", "message": str, "next"?: "client_id" | "password"}`.

- [ ] **Step 1: Write the failing tests** (append to `tests/test_widget.py`):

```python
import threading

from jstex import auth
from jstex.login import DeviceCode, LoginError


def signed_in(source="device"):
    return auth.TokenInfo("T", source, 9e9, "alice")


def test_login_methods_follow_the_profile():
    ex, _ = make(FakeBackend())
    assert ex.login_methods == ["device", "password"]  # cdse-opensearch
    ex2 = Explorer(profile="none", stac_url="https://s/v1", backend=FakeBackend(), runner=sync_runner)
    assert ex2.login_methods == []


def test_device_sign_in_without_client_id_asks_for_one():
    ex, sent = make(FakeBackend())
    ex._on_msg(ex, {"type": "login_start", "method": "device"}, [])
    assert sent[-1] == {"type": "login", "state": "need_client_id"}


def test_device_sign_in_shows_the_code_then_finishes(monkeypatch):
    ex, sent = make(FakeBackend())

    def fake_device(cfg, *, client_id, show, cancel):
        assert client_id == "dev"
        show(DeviceCode("https://id/device", "ABCD", 600))
        return signed_in()

    monkeypatch.setattr("jstex.widget.device_login", fake_device)
    ex._on_msg(ex, {"type": "login_start", "method": "device", "client_id": "dev"}, [])
    assert sent[-2:] == [
        {"type": "login", "state": "device", "uri": "https://id/device", "code": "ABCD", "expires_in": 600},
        {"type": "login", "state": "done"},
    ]
    assert (ex.auth_source, ex.auth_user) == ("device", "alice")


def test_refused_device_client_points_to_password(monkeypatch):
    ex, sent = make(FakeBackend())

    def refused(cfg, **kw):
        raise LoginError("Client 'x' is not allowed to use device login.", "client_refused")

    monkeypatch.setattr("jstex.widget.device_login", refused)
    ex._on_msg(ex, {"type": "login_start", "method": "device", "client_id": "x"}, [])
    assert sent[-1]["state"] == "error" and sent[-1]["next"] == "password"


def test_password_is_never_echoed(monkeypatch):
    ex, sent = make(FakeBackend())

    def bad(cfg, *, username, password):
        raise LoginError("Wrong username or password.", "bad_credentials")

    monkeypatch.setattr("jstex.widget.password_login", bad)
    ex._on_msg(ex, {"type": "login_password", "username": "alice", "password": "s3cret"}, [])
    assert sent[-1] == {"type": "login", "state": "error", "message": "Wrong username or password."}
    assert "s3cret" not in repr(sent) and "s3cret" not in repr(ex.get_state())


def test_cancel_and_logout(monkeypatch):
    ex, sent = make(FakeBackend())
    ex._login_cancel = threading.Event()
    ex._on_msg(ex, {"type": "login_cancel"}, [])
    assert ex._login_cancel.is_set()
    monkeypatch.setattr("jstex.widget.auth.logout", lambda cfg: None)
    monkeypatch.setattr("jstex.widget.auth.current", lambda cfg=None, force_refresh=False: auth.TokenInfo(None, "anonymous", 0))
    ex._on_msg(ex, {"type": "logout"}, [])
    assert sent[-1] == {"type": "login", "state": "signed_out"}
    assert ex.auth_source == "anonymous" and ex.auth_user == ""
```

- [ ] **Step 2: Run to verify they fail**

Run: `pytest tests/test_widget.py -q`
Expected: `AttributeError: 'Explorer' object has no attribute 'login_methods'` (and the `monkeypatch.setattr("jstex.widget.device_login", …)` targets do not exist yet).

- [ ] **Step 3: Implement** — `jstex/widget.py`:

```python
from .login import LoginError, device_login, exclusive, login_client_id, password_login

    auth_user = traitlets.Unicode("").tag(sync=True)
    login_methods = traitlets.List(traitlets.Unicode()).tag(sync=True)

    # in __init__, after self._config = config:
        methods = ["device"] if config.issuer else []
        if config.password_login and config.password_client_id and config.issuer:
            methods.append("password")
        self.login_methods = methods
        self._login_cancel = threading.Event()

    # in _on_msg, before the final `elif kind == "sync"` branch:
        elif kind == "login_start":
            self._login_cancel = threading.Event()
            self._run(self._login_device if content.get("method") == "device" else self._login_ask_password,
                      str(content.get("client_id") or "") or None)
        elif kind == "login_password":
            # Local variables only: never stored, logged or echoed.
            self._run(self._login_password, str(content.get("username") or ""), str(content.get("password") or ""))
        elif kind == "login_cancel":
            self._login_cancel.set()
        elif kind == "logout":
            self._run(self._logout)

    def _login_send(self, state: str, **extra: Any) -> None:
        self.send({"type": "login", "state": state, **extra})

    def _signed_in(self, info: auth.TokenInfo) -> None:
        self.auth_source, self.auth_user = info.source, info.user
        self._login_send("done")

    def _login_failed(self, err: LoginError) -> None:
        extra: dict[str, str] = {}
        if err.reason == "client_refused":
            extra["next"] = "password" if "password" in self.login_methods else "client_id"
        self._login_send("error", message=str(err), **extra)

    def _login_device(self, client_id: str | None) -> None:
        cid = client_id or login_client_id(self._config)
        if cid is None:
            self._login_send("need_client_id")
            return
        try:
            with exclusive():
                info = device_login(
                    self._config,
                    client_id=cid,
                    show=lambda c: self._login_send("device", uri=c.uri, code=c.code, expires_in=c.expires_in),
                    cancel=self._login_cancel,
                )
        except LoginError as err:
            self._login_failed(err)
            return
        except Exception as err:  # noqa: BLE001 - the UI must leave the busy state
            self._login_send("error", message=str(err) or type(err).__name__)
            return
        self._signed_in(info)

    def _login_ask_password(self, _client_id: str | None) -> None:
        self._login_send("password")

    def _login_password(self, username: str, password: str) -> None:
        try:
            with exclusive():
                info = password_login(self._config, username=username, password=password)
        except LoginError as err:
            self._login_failed(err)
            return
        except Exception:  # noqa: BLE001 - never include anything that could hold the password
            self._login_send("error", message="Password login failed.")
            return
        self._signed_in(info)

    def _logout(self) -> None:
        auth.logout(self._config)
        info = auth.current(self._config)
        self.auth_source, self.auth_user = info.source, info.user
        self._login_send("signed_out")
```

Also set `self.auth_user = …` next to `self.auth_source = …` in `_reply_collections` (use one `info = auth.current(self._config)`).

- [ ] **Step 4: Run to verify they pass**

Run: `pytest -q tests`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
ruff format jstex tests && ruff check jstex tests
git add jstex/widget.py tests/test_widget.py
git commit -m "feat(widget): sign-in protocol — device, password, cancel, logout"
```

---
### Task 9: Widget sign-in UI (state, protocol, panel footer)

**Files:**
- Create: `js/ui/signin.ts`, `js/__tests__/signin.test.ts`
- Modify: `js/types.ts`, `js/model-sync.ts`, `js/backend.ts`, `js/actions.ts`, `js/widget.ts`, `js/ui/panel.ts`, `js/strings.ts`, `js/styles.css`, `js/__tests__/helpers.ts`, `js/__tests__/panel.test.ts`

**Interfaces:**
- Consumes: the Task 8 protocol (traits `auth_source`, `auth_user`, `login_methods`, `profile_name`; messages listed there).
- Produces:
  - `types.ts`: `LoginState` (below); `ExplorerState` gains `authUser: string; loginMethods: string[]; profileName: string; login: LoginState`; `LoginMessage`
  - `Backend` gains `startLogin(method: 'device' | 'password', clientId?: string): void`, `submitPassword(username: string, password: string): void`, `cancelLogin(): void`, `logout(): void`; `BackendEvents` gains `onLogin(msg: LoginMessage): void`
  - `Actions` gains `loadCollections(): Promise<void>`, `startLogin(method, clientId?)`, `submitPassword(username, password)`, `cancelLogin()`, `logout()`
  - `model-sync.ts`: `applyLogin(store, msg, reload: () => void): void`
  - `ui/signin.ts`: `mountSignin(el, store, actions): () => void`, `isInsecure(loc: { protocol: string; hostname: string }): boolean`

- [ ] **Step 1: Types** — `js/types.ts` (append; extend `ExplorerState`):

```ts
/** Sign-in flow in the panel footer (protocol: jstex/widget.py _login_*). */
export type LoginState =
  | { state: 'idle' }
  | { state: 'starting' }
  | { state: 'need_client_id' }
  | { state: 'device'; uri: string; code: string; expiresAt: number }
  | { state: 'password' }
  | { state: 'error'; message: string; next?: 'client_id' | 'password' };

export interface LoginMessage {
  type: 'login';
  state: 'need_client_id' | 'device' | 'password' | 'done' | 'signed_out' | 'error';
  uri?: string;
  code?: string;
  expires_in?: number;
  message?: string;
  next?: 'client_id' | 'password';
}

// in ExplorerState, after authSource:
  authUser: string;
  loginMethods: string[];
  profileName: string;
  login: LoginState;
```

- [ ] **Step 2: Model sync** — `js/model-sync.ts`:

In `stateFromModel` add:

```ts
    authUser: (model.get('auth_user') as string) || '',
    loginMethods: (model.get('login_methods') as string[] | null) ?? [],
    profileName: (model.get('profile_name') as string) || '',
    login: { state: 'idle' },
```

Add to `TRAITS`: `['auth_user', 'authUser'], ['login_methods', 'loginMethods'], ['profile_name', 'profileName']`.

Append:

```ts
/** Apply a sign-in message from Python; `reload` refetches collections. */
export function applyLogin(
  store: Store<ExplorerState>,
  msg: LoginMessage,
  reload: () => void
): void {
  switch (msg.state) {
    case 'device':
      store.set({
        login: {
          state: 'device',
          uri: msg.uri ?? '',
          code: msg.code ?? '',
          expiresAt: Date.now() + (msg.expires_in ?? 0) * 1000
        }
      });
      return;
    case 'need_client_id':
    case 'password':
      store.set({ login: { state: msg.state } });
      return;
    case 'error':
      store.set({
        login: { state: 'error', message: msg.message ?? '', next: msg.next }
      });
      return;
    case 'done':
    case 'signed_out':
      store.set({ login: { state: 'idle' } });
      reload(); // restricted collections appear (or disappear)
  }
}
```

- [ ] **Step 3: Backend** — `js/backend.ts`: add to `Backend` and `BackendEvents` as in Interfaces, and to `CommBackend`:

```ts
  startLogin(method: 'device' | 'password', clientId?: string): void {
    this.model.send({
      type: 'login_start',
      method,
      ...(clientId ? { client_id: clientId } : {})
    });
  }

  submitPassword(username: string, password: string): void {
    // Sent straight to the kernel; never kept in the store or a trait.
    this.model.send({ type: 'login_password', username, password });
  }

  cancelLogin(): void {
    this.model.send({ type: 'login_cancel' });
  }

  logout(): void {
    this.model.send({ type: 'logout' });
  }
```

and in `onMessage`: `else if (msg.type === 'login') { this.events.onLogin(raw as LoginMessage); }`.

- [ ] **Step 4: Actions** — `js/actions.ts`: add to the `Actions` interface and the object:

```ts
    async loadCollections() {
      try {
        const collections = await backend.listCollections();
        store.set({ collections, collectionsLoading: false, collectionsError: '' });
      } catch (err) {
        if ((err as Error).message !== 'disposed')
          store.set({
            collectionsLoading: false,
            collectionsError: (err as Error).message
          });
      }
    },
    startLogin(method, clientId) {
      store.set({ login: { state: 'starting' } });
      backend.startLogin(method, clientId);
    },
    submitPassword(username, password) {
      store.set({ login: { state: 'starting' } });
      backend.submitPassword(username, password);
    },
    cancelLogin() {
      backend.cancelLogin();
      store.set({ login: { state: 'idle' } });
    },
    logout() {
      backend.logout();
    },
```

`js/widget.ts`: replace the inline `backend.listCollections().then(…).catch(…)` block with `void actions.loadCollections();`, and create the backend with
`new CommBackend(m, { onPage: msg => applyPage(store, msg), onLogin: msg => applyLogin(store, msg, () => void actions.loadCollections()) })`.
Because `actions` is created after the backend, declare `let actions: Actions;` before the backend and assign it right after (`actions = createActions(m, store, backend, S);`); the `onLogin` closure only runs later.

`js/__tests__/helpers.ts` — add to the fake backend in `setupView`: `startLogin: vi.fn(), submitPassword: vi.fn(), cancelLogin: vi.fn(), logout: vi.fn(),`.

- [ ] **Step 5: Strings** — `js/strings.ts`, replace `signedIn` with:

```ts
    signIn: trans.__('Sign in'),
    signOut: trans.__('Sign out'),
    signedInVia: (how: string) => trans.__('Signed in (%1)', how),
    signedInAs: (how: string, user: string) =>
      trans.__('Signed in (%1) as %2', how, user),
    authLabels: {
      hub: trans.__('hub'),
      token: trans.__('token'),
      session: trans.__('session'),
      device: trans.__('device login'),
      password: trans.__('password'),
      anonymous: ''
    } as Record<string, string>,
    profileTitle: (name: string) => trans.__('Profile: %1', name),
    signingIn: trans.__('Signing in…'),
    deviceStep: trans.__('Open the sign-in page and confirm this code:'),
    openSignIn: trans.__('Open sign-in page'),
    expiresIn: (min: number, sec: number) =>
      trans.__('Code valid for %1:%2', min, String(sec).padStart(2, '0')),
    clientIdLabel: trans.__('Device-login client id'),
    clientIdHint: trans.__('Ask your platform operator for it; it is remembered after a successful sign-in.'),
    continueBtn: trans.__('Continue'),
    usePassword: trans.__('Use password instead'),
    enterClientId: trans.__('Enter a client id'),
    username: trans.__('Username'),
    password: trans.__('Password'),
    insecurePassword: trans.__(
      'This page is not served over HTTPS: your password would cross the network unencrypted.'
    ),
    tryAgain: trans.__('Try again'),
    close: trans.__('Close'),
```

- [ ] **Step 6: Write the failing tests** — `js/__tests__/signin.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { applyLogin } from '../model-sync';
import { isInsecure, mountSignin } from '../ui/signin';
import { byRef as q, setupView } from './helpers';

function view(values: Record<string, unknown> = {}) {
  const v = setupView({
    login_methods: ['device', 'password'],
    profile_name: 'cdse-opensearch',
    ...values
  });
  mountSignin(v.el, v.store, v.actions);
  v.store.set({ collectionsLoading: false });
  return v;
}

describe('sign-in area', () => {
  it('offers Sign in when anonymous and starts device login', () => {
    const { el, store, backend } = view();
    expect(q(el, 'statusText').textContent).toBe(
      'Not signed in — restricted collections are hidden.'
    );
    q(el, 'signIn').click();
    expect(backend.startLogin).toHaveBeenCalledWith('device', undefined);
    expect(store.get().login.state).toBe('starting');
    expect(q(el, 'box').textContent).toContain('Signing in…');
  });

  it('asks for a client id when none is configured', () => {
    const { el, store, backend } = view();
    applyLogin(store, { type: 'login', state: 'need_client_id' }, vi.fn());
    (q(el, 'clientId') as HTMLInputElement).value = 'dev-client';
    q(el, 'continue').click();
    expect(backend.startLogin).toHaveBeenLastCalledWith('device', 'dev-client');
  });

  it('shows the device code with link and countdown; Cancel stops it', () => {
    const { el, store, backend } = view();
    applyLogin(
      store,
      { type: 'login', state: 'device', uri: 'https://id/device?c=1', code: 'ABCD-EFGH', expires_in: 600 },
      vi.fn()
    );
    expect(q(el, 'code').textContent).toBe('ABCD-EFGH');
    expect((q(el, 'open') as HTMLAnchorElement).href).toBe('https://id/device?c=1');
    expect(q(el, 'countdown').textContent).toMatch(/^Code valid for (10:00|9:5\d)$/);
    q(el, 'cancelLogin').click();
    expect(backend.cancelLogin).toHaveBeenCalled();
    expect(store.get().login.state).toBe('idle');
  });

  it('password form submits and clears the password field', () => {
    const { el, store, backend } = view();
    applyLogin(store, { type: 'login', state: 'password' }, vi.fn());
    (q(el, 'username') as HTMLInputElement).value = 'alice';
    (q(el, 'password') as HTMLInputElement).value = 'pw';
    q(el, 'submitPassword').click();
    expect(backend.submitPassword).toHaveBeenCalledWith('alice', 'pw');
    expect(JSON.stringify(store.get())).not.toContain('"pw"');
  });

  it('a refused device client offers the password path', () => {
    const { el, store, backend } = view();
    applyLogin(
      store,
      { type: 'login', state: 'error', message: 'Client x is not allowed.', next: 'password' },
      vi.fn()
    );
    expect(q(el, 'box').textContent).toContain('Client x is not allowed.');
    q(el, 'usePassword').click();
    expect(backend.startLogin).toHaveBeenLastCalledWith('password', undefined);
  });

  it('signed in: status with user and profile, Sign out', () => {
    const { el, store, backend } = view();
    store.set({ authSource: 'device', authUser: 'alice' });
    expect(q(el, 'statusText').textContent).toBe('Signed in (device login) as alice');
    expect(q(el, 'statusText').title).toBe('Profile: cdse-opensearch');
    expect(q(el, 'signIn').hidden).toBe(true);
    q(el, 'signOut').click();
    expect(backend.logout).toHaveBeenCalled();
    store.set({ authSource: 'hub', authUser: 'alice' });
    expect(q(el, 'signOut').hidden).toBe(true); // the hub would sign the user in again
  });

  it('done reloads collections; insecure pages are detected', () => {
    const { store } = view();
    const reload = vi.fn();
    applyLogin(store, { type: 'login', state: 'done' }, reload);
    expect(reload).toHaveBeenCalled();
    expect(store.get().login.state).toBe('idle');
    expect(isInsecure({ protocol: 'http:', hostname: 'dev.example.org' })).toBe(true);
    expect(isInsecure({ protocol: 'http:', hostname: 'localhost' })).toBe(false);
    expect(isInsecure({ protocol: 'https:', hostname: 'dev.example.org' })).toBe(false);
  });
});
```

In `js/__tests__/panel.test.ts`, test "sign-in line, cancel and error banner follow state": replace the expectation `'Signed in — restricted collections included.'` with `'Signed in (hub)'` (the status now lives in the sign-in area, same `authText`/`statusText` ref — see Step 8).

- [ ] **Step 7: Run to verify they fail**

Run: `jlpm vitest run js/__tests__/signin.test.ts`
Expected: `Failed to resolve import "../ui/signin"`.

- [ ] **Step 8: Implement `js/ui/signin.ts`**

```ts
/**
 * Panel-footer sign-in (spec 2026-10-02 §4.1): status line with Sign in /
 * Sign out, and an inline area for the device code, the client-id field, the
 * password form and errors. The password goes straight to the kernel.
 */
import type { Actions } from '../actions';
import { escapeHtml } from '../format';
import type { Store } from '../store';
import { S } from '../strings';
import type { ExplorerState, LoginState } from '../types';

type SigninActions = Pick<
  Actions,
  'startLogin' | 'submitPassword' | 'cancelLogin' | 'logout'
>;

const SIGN_OUT_SOURCES = new Set(['token', 'session', 'device', 'password']);

export function isInsecure(loc: { protocol: string; hostname: string }): boolean {
  return (
    loc.protocol !== 'https:' &&
    !['localhost', '127.0.0.1', '[::1]'].includes(loc.hostname)
  );
}

function btn(ref: string, label: string, primary = false): string {
  return `<button type="button" class="jstex-control${primary ? ' jstex-primary' : ''}" data-ref="${ref}">${escapeHtml(label)}</button>`;
}

function boxHtml(login: LoginState, methods: string[]): string {
  switch (login.state) {
    case 'starting':
      return `<p>${escapeHtml(S.signingIn)}</p><div class="jstex-row">${btn('cancelLogin', S.cancel)}</div>`;
    case 'need_client_id':
      return `<label class="jstex-signin__label">${escapeHtml(S.clientIdLabel)}
          <input type="text" class="jstex-control" data-ref="clientId" autocomplete="off" spellcheck="false"></label>
        <p class="jstex-hint">${escapeHtml(S.clientIdHint)}</p>
        <div class="jstex-row">${btn('continue', S.continueBtn, true)}${
          methods.includes('password') ? btn('usePassword', S.usePassword) : ''
        }${btn('cancelLogin', S.cancel)}</div>`;
    case 'device':
      return `<p>${escapeHtml(S.deviceStep)}</p>
        <div class="jstex-signin__code jstex-mono" data-ref="code">${escapeHtml(login.code)}</div>
        <div class="jstex-row">
          <a class="jstex-control jstex-primary" data-ref="open" href="${escapeHtml(login.uri)}" target="_blank" rel="noopener">${escapeHtml(S.openSignIn)}</a>
          ${btn('cancelLogin', S.cancel)}
        </div>
        <p class="jstex-hint" data-ref="countdown"></p>`;
    case 'password':
      return `<form data-ref="passwordForm" class="jstex-signin__form">
          <label class="jstex-signin__label">${escapeHtml(S.username)}
            <input type="text" class="jstex-control" data-ref="username" autocomplete="username"></label>
          <label class="jstex-signin__label">${escapeHtml(S.password)}
            <input type="password" class="jstex-control" data-ref="password" autocomplete="current-password"></label>
          ${isInsecure(window.location) ? `<p class="jstex-hint jstex-hint--warn">${escapeHtml(S.insecurePassword)}</p>` : ''}
          <div class="jstex-row">${btn('submitPassword', S.signIn, true)}${btn('cancelLogin', S.cancel)}</div>
        </form>`;
    case 'error':
      return `<p class="jstex-hint jstex-hint--err" role="alert">${escapeHtml(login.message)}</p>
        <div class="jstex-row">${
          login.next === 'password'
            ? btn('usePassword', S.usePassword, true)
            : login.next === 'client_id'
              ? btn('enterClientId', S.enterClientId, true)
              : btn('tryAgain', S.tryAgain, true)
        }${btn('cancelLogin', S.close)}</div>`;
    default:
      return '';
  }
}

export function mountSignin(
  el: HTMLElement,
  store: Store<ExplorerState>,
  actions: SigninActions
): () => void {
  el.innerHTML = `
    <div class="jstex-signin">
      <div class="jstex-hint jstex-hint--icon jstex-signin__status" data-ref="auth">
        <span data-ref="statusText"></span>
        <button type="button" class="jstex-link" data-ref="signIn">${escapeHtml(S.signIn)}</button>
        <button type="button" class="jstex-link" data-ref="signOut">${escapeHtml(S.signOut)}</button>
      </div>
      <div class="jstex-signin__box" data-ref="box" hidden></div>
    </div>`;
  const ref = <T extends HTMLElement = HTMLElement>(name: string) =>
    el.querySelector(`[data-ref="${name}"]`) as T;
  const box = ref('box');
  let timer: ReturnType<typeof setInterval> | undefined;

  const tick = () => {
    const login = store.get().login;
    const out = box.querySelector<HTMLElement>('[data-ref="countdown"]');
    if (login.state !== 'device' || !out) return;
    const left = Math.max(0, Math.round((login.expiresAt - Date.now()) / 1000));
    out.textContent = S.expiresIn(Math.floor(left / 60), left % 60);
  };

  const renderStatus = (s: ExplorerState) => {
    const anonymous = s.authSource === 'anonymous';
    const how = S.authLabels[s.authSource] ?? s.authSource;
    const status = ref('statusText');
    status.textContent = anonymous
      ? S.anonymousNote
      : s.authUser
        ? S.signedInAs(how, s.authUser)
        : S.signedInVia(how);
    status.title = s.profileName ? S.profileTitle(s.profileName) : '';
    ref('auth').hidden = s.collectionsLoading;
    ref('signIn').hidden = !anonymous || !s.loginMethods.length || s.login.state !== 'idle';
    ref('signOut').hidden = !SIGN_OUT_SOURCES.has(s.authSource);
  };

  const renderBox = (s: ExplorerState) => {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
    box.innerHTML = boxHtml(s.login, s.loginMethods);
    box.hidden = s.login.state === 'idle';
    if (s.login.state === 'device') {
      tick();
      timer = setInterval(tick, 1000);
    }
  };

  el.addEventListener('click', e => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-ref]');
    const methods = store.get().loginMethods;
    switch (target?.dataset.ref) {
      case 'signIn':
        actions.startLogin(methods.includes('device') ? 'device' : 'password');
        break;
      case 'signOut':
        actions.logout();
        break;
      case 'continue': {
        const id = (box.querySelector('[data-ref="clientId"]') as HTMLInputElement).value.trim();
        if (id) actions.startLogin('device', id);
        break;
      }
      case 'usePassword':
        actions.startLogin('password');
        break;
      case 'enterClientId':
        store.set({ login: { state: 'need_client_id' } });
        break;
      case 'tryAgain':
        actions.startLogin('device');
        break;
      case 'submitPassword': {
        e.preventDefault();
        const user = box.querySelector('[data-ref="username"]') as HTMLInputElement;
        const pass = box.querySelector('[data-ref="password"]') as HTMLInputElement;
        actions.submitPassword(user.value.trim(), pass.value);
        pass.value = '';
        break;
      }
      case 'cancelLogin':
        actions.cancelLogin();
        break;
    }
  });
  box.addEventListener('submit', e => e.preventDefault());

  renderStatus(store.get());
  renderBox(store.get());
  const unsubscribe = store.subscribe((s, prev) => {
    if (
      s.authSource !== prev.authSource ||
      s.authUser !== prev.authUser ||
      s.profileName !== prev.profileName ||
      s.loginMethods !== prev.loginMethods ||
      s.collectionsLoading !== prev.collectionsLoading ||
      s.login !== prev.login
    )
      renderStatus(s);
    if (s.login !== prev.login) renderBox(s);
  });
  return () => {
    if (timer !== undefined) clearInterval(timer);
    unsubscribe();
  };
}
```

`js/ui/panel.ts`: replace the footer line
`<div class="jstex-hint jstex-hint--icon" data-ref="auth">${ICON.info}<span data-ref="authText"></span></div>`
with `<div data-slot="signin"></div>`; mount it with the other sections — `cleanups.push(mountSignin(el.querySelector('[data-slot="signin"]') as HTMLElement, store, actions));` — and delete the three `ref('auth')…` / `ref('authText')…` lines from `update`. In `js/__tests__/panel.test.ts`, change `q(el, 'authText')` to `q(el, 'statusText')` (two places) besides the text change from Step 6.

- [ ] **Step 9: Styles** — append to `js/styles.css`:

```css
/* sign-in (panel footer) */
.jstex .jstex-signin__status {
  flex-wrap: wrap;
}
.jstex .jstex-signin__box {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 4px;
  padding: 8px;
  border: 1px solid var(--jstex-border);
  border-radius: 4px;
  background: var(--jstex-bg);
}
.jstex .jstex-signin__box[hidden] {
  display: none;
}
.jstex .jstex-signin__box p {
  margin: 0;
}
.jstex .jstex-signin__code {
  font-size: 1.5em;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-align: center;
  padding: 4px 0;
}
.jstex .jstex-signin__label {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 0.92em;
  color: var(--jstex-muted);
}
.jstex .jstex-signin__label .jstex-control {
  width: 100%;
}
.jstex .jstex-signin__form {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.jstex a.jstex-control {
  text-decoration: none;
}
```

- [ ] **Step 10: Run to verify they pass**

Run: `jlpm vitest run && npx tsc -p js/tsconfig.json && jlpm i18n:extract && pytest -q tests`
Expected: all pass, tsc clean, `jstex/locale/jstex.pot` gains the new strings.

- [ ] **Step 11: Commit**

```bash
npx prettier --write "js/**/*.ts"
git add js jstex/locale/jstex.pot
git commit -m "feat(widget): sign-in area — device code, client id, password, sign out"
```

---
### Task 10: End-to-end sign-in with a fake identity provider

Discovery overrides are covered by the unit tests in Task 2, not here: the fake server is plain `http://`, and discovery documents must use `https://` URLs (spec §3.4), so an e2e discovery test would only exercise the rejection path.

**Files:**
- Modify: `ui-tests/fake_stac.py`
- Create: `ui-tests/tests/signin.spec.ts`

**Interfaces:**
- Consumes: the whole sign-in stack (Tasks 4–9).
- Produces (fake server, `http://127.0.0.1:8765`):
  - Issuer `http://127.0.0.1:8765/oidc/realms/test`: `/.well-known/openid-configuration`, `/protocol/openid-connect/auth/device` (user code `WDJB-MJHT`, interval 1 s), `/protocol/openid-connect/token` (device grant pending until approved; password `alice`/`secret`; refresh grant)
  - `GET /__approve` approves the pending device code; `GET /__reset` clears approval
  - `GET /v1/collections` adds `{"id": "restricted-l2a", "title": "Restricted L2A"}` when the request carries a Bearer token issued by the fake

- [ ] **Step 1: Extend `ui-tests/fake_stac.py`** — add near the top:

```python
import base64
import time
from urllib.parse import parse_qs

ISSUER = f"http://127.0.0.1:{PORT}/oidc/realms/test"
OIDC = "/oidc/realms/test"
oidc_state = {"approved": False}
RESTRICTED = {"id": "restricted-l2a", "title": "Restricted L2A", "description": "Needs a login."}


def _jwt(claims: dict) -> str:
    def seg(obj: dict) -> str:
        return base64.urlsafe_b64encode(json.dumps(obj).encode()).rstrip(b"=").decode()

    return f"{seg({'alg': 'none'})}.{seg(claims)}.sig"


def signed_in_by_fake(header: str) -> bool:
    """True for 'Bearer <jwt>' whose payload names this fake issuer."""
    parts = header.removeprefix("Bearer ").split(".")
    if not header.startswith("Bearer ") or len(parts) != 3:
        return False
    payload = parts[1] + "=" * (-len(parts[1]) % 4)
    try:
        return json.loads(base64.urlsafe_b64decode(payload)).get("iss") == ISSUER
    except ValueError:
        return False


def tokens() -> dict:
    access = _jwt({"iss": ISSUER, "sub": "u1", "preferred_username": "alice", "exp": time.time() + 300})
    return {"access_token": access, "expires_in": 300, "refresh_token": "R", "refresh_expires_in": 1800}
```

In `do_GET`, before the existing branches:

```python
        if path == f"{OIDC}/.well-known/openid-configuration":
            return self._json({
                "issuer": ISSUER,
                "token_endpoint": f"{ISSUER}/protocol/openid-connect/token",
                "device_authorization_endpoint": f"{ISSUER}/protocol/openid-connect/auth/device",
            })
        if path == "/__approve":
            oidc_state["approved"] = True
            return self._json({"approved": True})
        if path == "/__reset":
            oidc_state["approved"] = False
            return self._json({"approved": False})
        if path == "/v1/collections":
            signed_in = signed_in_by_fake(self.headers.get("Authorization", ""))
            return self._json({"collections": COLLECTIONS + ([RESTRICTED] if signed_in else []), "links": []})
```

(and remove the old `elif path == "/v1/collections":` branch). Replace `do_POST` with:

```python
    def do_POST(self) -> None:  # noqa: N802
        global last_search
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length) or b""
        path = self.path.split("?")[0]
        if path == f"{OIDC}/protocol/openid-connect/auth/device":
            return self._json({
                "device_code": "DC", "user_code": "WDJB-MJHT",
                "verification_uri": f"{ISSUER}/device",
                "verification_uri_complete": f"{ISSUER}/device?user_code=WDJB-MJHT",
                "expires_in": 300, "interval": 1,
            })
        if path == f"{OIDC}/protocol/openid-connect/token":
            form = {k: v[0] for k, v in parse_qs(raw.decode()).items()}
            grant = form.get("grant_type", "")
            if grant.endswith("device_code"):
                if oidc_state["approved"]:
                    return self._json(tokens())
                return self._json({"error": "authorization_pending"}, 400)
            if grant == "password":
                if (form.get("username"), form.get("password")) == ("alice", "secret"):
                    return self._json(tokens())
                return self._json({"error": "invalid_grant", "error_description": "Invalid user credentials"}, 401)
            if grant == "refresh_token":
                return self._json(tokens())
            return self._json({"error": "unsupported_grant_type"}, 400)
        last_search = json.loads(raw or b"{}")
        if path == "/v1/search":
            self._json({"type": "FeatureCollection", "features": [item(i) for i in IDS], "links": [], "numberMatched": 3})
        else:
            self._json({"detail": "not found"}, 404)
```

- [ ] **Step 2: Write the e2e tests** — `ui-tests/tests/signin.spec.ts`:

```ts
import { expect, test, type Page } from '@jupyterlab/galata';

const STAC = 'http://127.0.0.1:8765/v1/';
const ISSUER = 'http://127.0.0.1:8765/oidc/realms/test';

test.use({ viewport: { width: 1600, height: 1200 } });

async function explorer(page: Page, loginClient: string | null) {
  const code = [
    'import os, tempfile',
    'os.environ["XDG_DATA_HOME"] = tempfile.mkdtemp()',
    `os.environ["JSTEX_OIDC_ISSUER"] = "${ISSUER}"`,
    'os.environ["JSTEX_PASSWORD_CLIENT_ID"] = "jstex-test"',
    'os.environ["JSTEX_PASSWORD_LOGIN"] = "1"',
    loginClient ? `os.environ["JSTEX_LOGIN_CLIENT_ID"] = "${loginClient}"` : 'os.environ.pop("JSTEX_LOGIN_CLIENT_ID", None)',
    'import jstex',
    `ex = jstex.Explorer(profile="none", stac_url="${STAC}")`,
    'ex'
  ].join('\n');
  await page.notebook.setCell(0, 'code', `exec(${JSON.stringify(code)})\nex`);
  await page.notebook.runCell(0);
  const w = page.locator('.jp-OutputArea-output .jstex').first();
  await expect(w.locator('[data-ref="statusText"]')).toHaveText(
    'Not signed in — restricted collections are hidden.',
    { timeout: 30000 }
  );
  return w;
}

test.describe('sign-in', () => {
  test.beforeEach(async ({ page }) => {
    await page.request.get('http://127.0.0.1:8765/__reset');
    await page.notebook.createNew();
  });

  test('device login shows the code, completes, and restricted collections appear', async ({ page }) => {
    const w = await explorer(page, 'jstex-test');
    await expect(w.locator('text=Restricted L2A')).toHaveCount(0);
    await w.locator('[data-ref="signIn"]').click();
    await expect(w.locator('[data-ref="code"]')).toHaveText('WDJB-MJHT');
    await page.request.get('http://127.0.0.1:8765/__approve');
    await expect(w.locator('[data-ref="statusText"]')).toHaveText('Signed in (device login) as alice', { timeout: 15000 });
    await expect(w.locator('text=Restricted L2A')).toBeVisible();
    await w.locator('[data-ref="signOut"]').click();
    await expect(w.locator('[data-ref="statusText"]')).toHaveText('Not signed in — restricted collections are hidden.');
    await expect(w.locator('text=Restricted L2A')).toHaveCount(0);
  });

  test('without a configured client id the user enters one', async ({ page }) => {
    const w = await explorer(page, null);
    await w.locator('[data-ref="signIn"]').click();
    await w.locator('[data-ref="clientId"]').fill('typed-client');
    await w.locator('[data-ref="continue"]').click();
    await expect(w.locator('[data-ref="code"]')).toHaveText('WDJB-MJHT');
    await w.locator('[data-ref="cancelLogin"]').click();
    await expect(w.locator('[data-ref="box"]')).toBeHidden();
  });

  test('password login: wrong password, then the right one', async ({ page }) => {
    const w = await explorer(page, null);
    await w.locator('[data-ref="signIn"]').click();
    await w.locator('[data-ref="usePassword"]').click();
    await w.locator('[data-ref="username"]').fill('alice');
    await w.locator('[data-ref="password"]').fill('wrong');
    await w.locator('[data-ref="submitPassword"]').click();
    await expect(w.locator('[role="alert"]')).toHaveText('Wrong username or password.');
    // The error offers "Try again" (device login); with no client id configured
    // that shows the client-id step, which offers "Use password instead".
    await w.locator('[data-ref="tryAgain"]').click();
    await w.locator('[data-ref="usePassword"]').click();
    await w.locator('[data-ref="username"]').fill('alice');
    await w.locator('[data-ref="password"]').fill('secret');
    await w.locator('[data-ref="submitPassword"]').click();
    await expect(w.locator('[data-ref="statusText"]')).toHaveText('Signed in (password) as alice', { timeout: 15000 });
  });
});
```

- [ ] **Step 3: Run**

Run: `jlpm build && cd ui-tests && jlpm playwright test tests/signin.spec.ts; cd ..`
Expected: `3 passed`. Then the full e2e suite: `cd ui-tests && jlpm playwright test; cd ..` → all pass (existing specs unchanged: they run without a login).

- [ ] **Step 4: Commit**

```bash
npx prettier --write ui-tests/tests/signin.spec.ts
git add ui-tests/fake_stac.py ui-tests/tests/signin.spec.ts
git commit -m "test(e2e): device and password sign-in against a fake identity provider"
```

---
### Task 11: S3 key policy (`jstex.s3.KeyManager`)

**Files:**
- Create: `jstex/s3.py` (key policy; Task 12 adds the user helpers), `tests/test_s3.py`
- Modify: `pyproject.toml` (extra `s3`; test deps `moto[s3]>=5`)

**Interfaces:**
- Consumes: `auth.get_token(cfg)`, `oidc.claims()` (Task 4); `Config.s3_keys_url/s3_endpoint/s3_region/s3_bucket`, `load_config` (Task 3).
- Produces:
  - Constants `KEY_TTL_S = 8 * 3600`, `RENEW_BELOW_S = 3600`, `PROPAGATION_BUDGET_S = 10`, `CAP_NEGATIVE_CACHE_S = 30`
  - `class JstexS3Error(JstexError)`
  - `@dataclass(frozen=True) class S3Key: access_key: str; secret_key: str (repr=False); expires_at: float; created_at: float`
  - `keys_path() -> Path` (`$XDG_CONFIG_HOME/jstex/s3-credentials.json`)
  - `class KeyManager(cfg, *, path=None, now=None, sleep=None, probe=None)` with `credentials() -> S3Key` and `invalidate(key: S3Key) -> S3Key`
  - `manager(cfg: Config) -> KeyManager` (one per keys-manager URL + profile per process)

- [ ] **Step 1: Dependencies** — `pyproject.toml`:

```toml
[project.optional-dependencies]
s3 = ["boto3>=1.34", "filelock>=3.12"]
# test: add "moto[s3]>=5", "boto3>=1.34", "filelock>=3.12"
```

Run `pip install -e ".[dev,test,s3]"`.

- [ ] **Step 2: Write the failing tests** — `tests/test_s3.py`:

```python
import calendar
import json
import os
import stat
import threading
import time

import pytest
import responses

from jstex.config import load_config
from jstex.s3 import KEY_TTL_S, JstexS3Error, KeyManager, S3Key, keys_path
from tests.conftest import make_jwt

KEYS = "https://s3-keys-manager.cloudferro.com/api/user"


@pytest.fixture
def cfg(monkeypatch):
    monkeypatch.setenv("JSTEX_ACCESS_TOKEN", make_jwt(time.time() + 3600))
    return load_config()  # cdse-opensearch: keys manager, endpoint, bucket


def created(access="AK1", hours=8):
    exp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + hours * 3600))
    return {"access_id": access, "secret": "SECRET-" + access, "expiration_date": exp}


def mgr(cfg, **kw):
    kw.setdefault("probe", lambda key: "ok")
    kw.setdefault("sleep", lambda s: None)
    return KeyManager(cfg, **kw)


@responses.activate
def test_key_is_created_for_8_hours_and_reused(cfg):
    responses.post(KEYS + "/credentials", json=created())
    m = mgr(cfg)
    key = m.credentials()
    assert key.access_key == "AK1" and "SECRET" not in repr(key)
    sent = json.loads(responses.calls[0].request.body)
    asked = calendar.timegm(time.strptime(sent["expiration_date"], "%Y-%m-%dT%H:%M:%SZ"))
    assert abs(asked - (time.time() + KEY_TTL_S)) < 60
    assert responses.calls[0].request.headers["Authorization"].startswith("Bearer ")
    assert m.credentials() == key
    assert len(responses.calls) == 1
    assert stat.S_IMODE(os.stat(keys_path()).st_mode) == 0o600


@responses.activate
def test_key_close_to_expiry_is_renewed_and_the_old_one_deleted(cfg):
    responses.post(KEYS + "/credentials", json=created("AK1", hours=0.5))
    responses.delete(KEYS + "/credentials/access_id/AK1", status=204)
    first = mgr(cfg).credentials()
    responses.replace(responses.POST, KEYS + "/credentials", json=created("AK2"))
    second = mgr(cfg).credentials()
    assert (first.access_key, second.access_key) == ("AK1", "AK2")
    assert any(c.request.method == "DELETE" for c in responses.calls)


@responses.activate
def test_key_that_expired_overnight_is_renewed_before_use(cfg):
    responses.post(KEYS + "/credentials", json=created("AK1"))
    m = mgr(cfg)
    m.credentials()
    data = json.loads(keys_path().read_text())
    for entry in data.values():
        entry["expires_at"] = time.time() - 60
    keys_path().write_text(json.dumps(data))
    responses.replace(responses.POST, KEYS + "/credentials", json=created("AK2"))
    responses.delete(KEYS + "/credentials/access_id/AK1", status=404)
    assert mgr(cfg).credentials().access_key == "AK2"


@responses.activate
def test_key_cap_is_reported_and_negative_cached(cfg):
    responses.post(KEYS + "/credentials", status=403, json={"detail": "Max number of credentials reached."})
    m = mgr(cfg)
    with pytest.raises(JstexS3Error, match="limit"):
        m.credentials()
    with pytest.raises(JstexS3Error, match="limit"):
        m.credentials()
    assert len(responses.calls) == 1


@responses.activate
def test_new_key_waits_for_propagation(cfg):
    responses.post(KEYS + "/credentials", json=created())
    answers = iter(["InvalidAccessKeyId", "InvalidAccessKeyId", "ok"])
    sleeps = []
    mgr(cfg, probe=lambda key: next(answers), sleep=sleeps.append).credentials()
    assert len(sleeps) == 2


@responses.activate
def test_invalidate_drops_the_key_and_creates_one_new(cfg):
    responses.post(KEYS + "/credentials", json=created("AK1"))
    m = mgr(cfg)
    old = m.credentials()
    responses.replace(responses.POST, KEYS + "/credentials", json=created("AK2"))
    assert m.invalidate(old).access_key == "AK2"


def test_unconfigured_profile_and_anonymous_user(monkeypatch):
    with pytest.raises(JstexS3Error, match="not configured"):
        KeyManager(load_config(profile="codede"))
    with pytest.raises(JstexS3Error, match="Sign in"):
        mgr(load_config()).credentials()


@responses.activate
def test_concurrent_kernels_create_one_key(cfg):
    responses.post(KEYS + "/credentials", json=created())
    results = []

    def run():
        results.append(mgr(cfg).credentials().access_key)

    threads = [threading.Thread(target=run) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert results == ["AK1"] * 4
    assert len([c for c in responses.calls if c.request.method == "POST"]) == 1
```

- [ ] **Step 3: Run to verify they fail**

Run: `pytest tests/test_s3.py -q`
Expected: `ModuleNotFoundError: No module named 'jstex.s3'`.

- [ ] **Step 4: Implement `jstex/s3.py`** (key policy):

```python
"""S3 access (spec 2026-10-02 §5). Keys come from the profile's keys manager
with the user's token; the policy is ported from STEX (platforms/cdse.ts,
s3-credentials.ts): 8 h keys, renewal below 1 h, superseded keys deleted,
one re-mint on InvalidAccessKeyId, propagation wait, key-cap back-off, and a
file lock so concurrent kernels share one key. Needs `jupyterlab-jstex[s3]`.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import tempfile
import threading
import time
from collections.abc import Callable
from dataclasses import asdict, dataclass, field
from pathlib import Path
from urllib.parse import quote

import requests

from . import auth, oidc
from .config import Config
from .errors import JstexError

KEY_TTL_S = 8 * 3600
RENEW_BELOW_S = 3600
PROPAGATION_BUDGET_S = 10
CAP_NEGATIVE_CACHE_S = 30
HTTP_TIMEOUT_S = 30


class JstexS3Error(JstexError):
    """S3 access is not possible (configuration, login, key limit, ...)."""


@dataclass(frozen=True)
class S3Key:
    access_key: str
    secret_key: str = field(repr=False)
    expires_at: float
    created_at: float


def keys_path() -> Path:
    base = os.environ.get("XDG_CONFIG_HOME") or str(Path.home() / ".config")
    return Path(base) / "jstex" / "s3-credentials.json"


def _parse_iso(value: str | None) -> float | None:
    if not value:
        return None
    try:
        parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed.timestamp()


class KeyManager:
    def __init__(
        self,
        cfg: Config,
        *,
        path: Path | None = None,
        now: Callable[[], float] | None = None,
        sleep: Callable[[float], None] | None = None,
        probe: Callable[[S3Key], str] | None = None,
    ):
        if not (cfg.s3_keys_url and cfg.s3_endpoint and cfg.s3_bucket):
            raise JstexS3Error(
                f"S3 is not configured for profile {cfg.profile!r} (needs s3_keys_url, s3_endpoint and s3_bucket)."
            )
        self.cfg = cfg
        self.path = path or keys_path()
        self._now = now or time.time
        self._sleep = sleep or time.sleep
        self._probe = probe or self._probe_s3
        self._cap_until = 0.0
        self._base = cfg.s3_keys_url.rstrip("/")

    # -- storage ---------------------------------------------------------
    def _token(self) -> str:
        token = auth.get_token(self.cfg)
        if not token:
            raise JstexS3Error("Sign in first: S3 keys need a login (jstex.login() or the Sign in button).")
        return token

    def _slot(self) -> str:
        sub = oidc.claims(self._token()).get("sub", "unknown")
        return f"{self._base}|{sub}"

    def _load(self) -> dict:
        try:
            data = json.loads(self.path.read_text())
            return data if isinstance(data, dict) else {}
        except (OSError, ValueError):
            return {}

    def _save(self, data: dict) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=self.path.parent, suffix=".tmp")  # 0600
        try:
            with os.fdopen(fd, "w") as fh:
                json.dump(data, fh)
            os.replace(tmp, self.path)
        except BaseException:
            Path(tmp).unlink(missing_ok=True)
            raise

    def _lock(self):
        from filelock import FileLock

        return FileLock(str(self.path) + ".lock", timeout=60)

    # -- policy ----------------------------------------------------------
    def credentials(self) -> S3Key:
        superseded = None
        with self._lock():
            data = self._load()
            slot = self._slot()
            entry = data.get(slot)
            now = self._now()
            if entry and entry.get("expires_at", 0) - now > RENEW_BELOW_S:
                return S3Key(**entry)
            key = self._create(now)
            data[slot] = asdict(key)
            self._save(data)
            superseded = entry.get("access_key") if entry else None
        if superseded:
            self._delete_quietly(superseded)
        return key

    def invalidate(self, key: S3Key) -> S3Key:
        """S3 rejected `key` (InvalidAccessKeyId): drop it and create one new key."""
        with self._lock():
            data = self._load()
            slot = self._slot()
            if (data.get(slot) or {}).get("access_key") == key.access_key:
                del data[slot]
                self._save(data)
        return self.credentials()

    def _create(self, now: float) -> S3Key:
        if now < self._cap_until:
            raise JstexS3Error(self._cap_message())
        expires = dt.datetime.fromtimestamp(now + KEY_TTL_S, dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        try:
            resp = requests.post(
                f"{self._base}/credentials",
                json={"expiration_date": expires},
                headers={"Authorization": f"Bearer {self._token()}"},
                timeout=HTTP_TIMEOUT_S,
            )
        except requests.RequestException as err:
            raise JstexS3Error(f"S3 keys manager unreachable ({type(err).__name__}).") from err
        if resp.status_code in (400, 403, 409) and "number of credentials" in resp.text.lower():
            self._cap_until = now + CAP_NEGATIVE_CACHE_S
            raise JstexS3Error(self._cap_message())
        if resp.status_code in (401, 403):
            raise JstexS3Error(
                f"The S3 keys manager refused the request (HTTP {resp.status_code}); check that you are signed in to this profile."
            )
        if not resp.ok:
            raise JstexS3Error(f"S3 key request failed (HTTP {resp.status_code}).")
        body = resp.json()
        key = S3Key(
            str(body["access_id"]),
            str(body["secret"]),
            _parse_iso(body.get("expiration_date")) or now + KEY_TTL_S,
            now,
        )
        self._wait_until_active(key)
        return key

    def _cap_message(self) -> str:
        return "S3 key limit reached — remove unused keys in your platform's S3 keys manager, then retry."

    def _wait_until_active(self, key: S3Key) -> None:
        deadline = self._now() + PROPAGATION_BUDGET_S
        while self._probe(key) == "InvalidAccessKeyId":
            if self._now() >= deadline:
                return  # still unknown: the first real request re-mints once
            self._sleep(0.5)

    def _probe_s3(self, key: S3Key) -> str:
        """Signed ListObjectsV2 (max 1 key, top level) on the bucket; returns the error code or 'ok'."""
        import boto3
        from botocore.config import Config as BotoConfig
        from botocore.exceptions import BotoCoreError, ClientError

        client = boto3.client(
            "s3",
            endpoint_url=self.cfg.s3_endpoint,
            region_name=self.cfg.s3_region,
            aws_access_key_id=key.access_key,
            aws_secret_access_key=key.secret_key,
            config=BotoConfig(s3={"addressing_style": "path"}, retries={"max_attempts": 1}),
        )
        try:
            client.list_objects_v2(Bucket=self.cfg.s3_bucket, MaxKeys=1, Delimiter="/")
            return "ok"
        except ClientError as err:
            return str(err.response.get("Error", {}).get("Code", ""))
        except BotoCoreError:
            return "error"

    def _delete_quietly(self, access_key: str) -> None:
        try:
            requests.delete(
                f"{self._base}/credentials/access_id/{quote(access_key, safe='')}",
                headers={"Authorization": f"Bearer {self._token()}"},
                timeout=HTTP_TIMEOUT_S,
            )
        except (requests.RequestException, JstexS3Error):
            pass  # an undeleted key frees its slot when it expires (8 h)


_managers: dict[tuple[str, str], KeyManager] = {}
_managers_lock = threading.Lock()


def manager(cfg: Config) -> KeyManager:
    with _managers_lock:
        key = (cfg.s3_keys_url or "", cfg.profile)
        if key not in _managers:
            _managers[key] = KeyManager(cfg)
        return _managers[key]
```

- [ ] **Step 5: Run to verify they pass**

Run: `pytest -q tests`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
ruff format jstex tests && ruff check jstex tests
git add jstex/s3.py tests/test_s3.py pyproject.toml
git commit -m "feat(s3): key policy ported from STEX — 8 h keys, renewal, re-mint, propagation, lock"
```

---
### Task 12: S3 helpers for users (`jstex.s3.*`)

**Files:**
- Modify: `jstex/s3.py` (append), `jstex/__init__.py` (lazy `s3` submodule)
- Test: `tests/test_s3.py` (append)

**Interfaces:**
- Consumes: `KeyManager`, `manager()`, `S3Key`, `JstexS3Error` (Task 11); `load_config` (Task 3).
- Produces:
  - `location(asset_or_href) -> {"Bucket": str, "Key": str}` — accepts an `s3://bucket/key` or `/bucket/key` string, a `pystac.Asset`, or an asset dict; uses `alternate.s3.href` when the main href is not S3
  - `endpoint_for(asset, cfg) -> str` — the asset's `storage:refs` → item `storage:schemes[ref].platform` when it is `https`, else `cfg.s3_endpoint`
  - `session(*, profile=None) -> boto3.Session` (self-refreshing credentials)
  - `client(asset=None, *, profile=None)` — boto3 S3 client (path-style, endpoint per asset), re-mints once on `InvalidAccessKeyId` for a non-fresh key
  - `storage_options(asset=None, *, profile=None) -> dict` (fsspec/s3fs/xarray), `gdal_env(asset=None, *, profile=None) -> dict[str, str]` (GDAL/rasterio) — static keys valid ≤ 8 h
  - `write_aws_profile(name="jstex", *, profile=None) -> Path`
  - `jstex.s3` reachable as an attribute (`import jstex; jstex.s3.client(...)`)

- [ ] **Step 1: Write the failing tests** (append to `tests/test_s3.py`):

```python
import configparser

import boto3
import pystac

from jstex import s3


class FakeManager:
    def __init__(self, created_at=None):
        self.key = S3Key("AK", "SK", time.time() + 7 * 3600, created_at or time.time() - 3600)
        self.invalidated = []

    def credentials(self):
        return self.key

    def invalidate(self, key):
        self.invalidated.append(key.access_key)
        self.key = S3Key("AK2", "SK2", time.time() + 8 * 3600, time.time())
        return self.key


@pytest.fixture
def fake(monkeypatch):
    m = FakeManager()
    monkeypatch.setattr(s3, "manager", lambda cfg: m)
    return m


def test_location_from_hrefs_alternates_and_dicts():
    assert s3.location("s3://eodata/Sentinel-2/a.jp2") == {"Bucket": "eodata", "Key": "Sentinel-2/a.jp2"}
    assert s3.location("/eodata/Sentinel-2/a.jp2") == {"Bucket": "eodata", "Key": "Sentinel-2/a.jp2"}
    asset = pystac.Asset("https://download.example/a.jp2", extra_fields={"alternate": {"s3": {"href": "s3://eodata/x/a.jp2"}}})
    assert s3.location(asset) == {"Bucket": "eodata", "Key": "x/a.jp2"}
    assert s3.location({"href": "s3://b/k"}) == {"Bucket": "b", "Key": "k"}
    with pytest.raises(s3.JstexS3Error, match="S3"):
        s3.location("https://download.example/a.jp2")


def test_endpoint_from_storage_schemes():
    cfg = load_config()
    item = pystac.Item("i", None, None, dt.datetime(2024, 1, 1), {
        "storage:schemes": {"cdse": {"type": "custom-s3", "platform": "https://eodata.example.eu"}}
    })
    asset = pystac.Asset("s3://eodata/k", extra_fields={"storage:refs": ["cdse"]})
    item.add_asset("B04", asset)
    assert s3.endpoint_for(asset, cfg) == "https://eodata.example.eu"
    assert s3.endpoint_for(pystac.Asset("s3://eodata/k"), cfg) == cfg.s3_endpoint


def test_gdal_env_and_storage_options(fake):
    env = s3.gdal_env()
    assert env["AWS_ACCESS_KEY_ID"] == "AK" and env["AWS_SECRET_ACCESS_KEY"] == "SK"
    assert env["AWS_S3_ENDPOINT"] == "eodata.dataspace.copernicus.eu"
    assert env["AWS_VIRTUAL_HOSTING"] == "FALSE" and env["AWS_HTTPS"] == "YES"
    opts = s3.storage_options()
    assert opts["key"] == "AK" and opts["client_kwargs"]["endpoint_url"] == "https://eodata.dataspace.copernicus.eu"


def test_client_reads_with_refreshing_credentials(fake, monkeypatch):
    from moto import mock_aws

    monkeypatch.setenv("MOTO_S3_CUSTOM_ENDPOINTS", "https://eodata.dataspace.copernicus.eu")
    monkeypatch.setenv("JSTEX_S3_REGION", "us-east-1")  # moto needs a real AWS region name
    with mock_aws():
        raw = boto3.client("s3", endpoint_url="https://eodata.dataspace.copernicus.eu", region_name="us-east-1")
        raw.create_bucket(Bucket="eodata")
        raw.put_object(Bucket="eodata", Key="x/a.txt", Body=b"hello")
        c = s3.client()
        assert c.get_object(**s3.location("s3://eodata/x/a.txt"))["Body"].read() == b"hello"


def test_unknown_key_on_an_old_key_re_mints_once(fake):
    handler = s3._retry_unknown_key(fake, s3._credentials(fake))
    response = (None, {"Error": {"Code": "InvalidAccessKeyId"}})
    assert handler(response=response, attempts=1) == 0  # retry now, with a new key
    assert fake.invalidated == ["AK"]
    assert handler(response=response, attempts=2) is None  # only once


def test_unknown_key_on_a_fresh_key_is_not_re_minted(monkeypatch):
    m = FakeManager(created_at=time.time())
    handler = s3._retry_unknown_key(m, s3._credentials(m))
    assert handler(response=(None, {"Error": {"Code": "InvalidAccessKeyId"}}), attempts=1) is None
    assert m.invalidated == []


def test_write_aws_profile_keeps_other_profiles(fake, tmp_path, monkeypatch):
    creds_file, conf_file = tmp_path / "credentials", tmp_path / "config"
    monkeypatch.setenv("AWS_SHARED_CREDENTIALS_FILE", str(creds_file))
    monkeypatch.setenv("AWS_CONFIG_FILE", str(conf_file))
    creds_file.write_text("[other]\naws_access_key_id = X\naws_secret_access_key = Y\n")
    s3.write_aws_profile("jstex")
    creds = configparser.ConfigParser()
    creds.read(creds_file)
    assert creds["other"]["aws_access_key_id"] == "X"
    assert creds["jstex"]["aws_access_key_id"] == "AK"
    conf = configparser.ConfigParser()
    conf.read(conf_file)
    assert conf["profile jstex"]["endpoint_url"] == "https://eodata.dataspace.copernicus.eu"
    assert stat.S_IMODE(os.stat(creds_file).st_mode) == 0o600
```

(Add `import datetime as dt` to the test imports.)

- [ ] **Step 2: Run to verify they fail**

Run: `pytest tests/test_s3.py -q`
Expected: `AttributeError: module 'jstex.s3' has no attribute 'location'`.

- [ ] **Step 3: Implement** (append to `jstex/s3.py`):

```python
from typing import Any
from urllib.parse import urlsplit

from .config import load_config

FRESH_KEY_S = 60  # a key this young that S3 does not know is still propagating


def _href(asset_or_href: Any) -> str | None:
    if isinstance(asset_or_href, str):
        return asset_or_href
    if isinstance(asset_or_href, dict):
        href, extra = asset_or_href.get("href"), asset_or_href
    else:  # pystac.Asset
        href, extra = asset_or_href.href, asset_or_href.extra_fields
    if href and (href.startswith("s3://") or href.startswith("/")):
        return href
    alt = ((extra.get("alternate") or {}).get("s3") or {}).get("href")
    return alt or href


def location(asset_or_href: Any) -> dict[str, str]:
    href = _href(asset_or_href) or ""
    if href.startswith("s3://"):
        path = href[5:]
    elif href.startswith("/"):
        path = href[1:]
    else:
        raise JstexS3Error(f"Not an S3 location: {href!r} (the asset has no s3:// href or alternate).")
    bucket, _, key = path.partition("/")
    return {"Bucket": bucket, "Key": key}


def endpoint_for(asset: Any, cfg: Config) -> str:
    refs = (getattr(asset, "extra_fields", None) or (asset if isinstance(asset, dict) else {})).get("storage:refs") or []
    owner = getattr(asset, "owner", None)
    schemes = (getattr(owner, "properties", None) or {}).get("storage:schemes") or {}
    for ref in refs:
        platform = (schemes.get(ref) or {}).get("platform", "")
        if isinstance(platform, str) and platform.startswith("https://") and "{" not in platform:
            return platform
    return str(cfg.s3_endpoint)


def _credentials(mgr):
    """botocore RefreshableCredentials fed by the KeyManager (refresh 1 h before expiry)."""
    from botocore.credentials import RefreshableCredentials

    def fetch() -> dict:
        key = mgr.credentials()
        return {
            "access_key": key.access_key,
            "secret_key": key.secret_key,
            "token": None,
            "expiry_time": dt.datetime.fromtimestamp(key.expires_at - RENEW_BELOW_S, dt.timezone.utc).isoformat(),
        }

    return RefreshableCredentials.create_from_metadata(fetch(), fetch, "jstex")


def _force_refresh(creds) -> None:
    # botocore has no public "refresh now"; this is its own mandatory-refresh path.
    creds._protected_refresh(is_mandatory=True)


def _retry_unknown_key(mgr, creds):
    """needs-retry handler: on InvalidAccessKeyId from a non-fresh key, re-mint once."""

    def handler(response=None, attempts: int = 0, **_: Any):
        if response is None or attempts != 1:
            return None
        code = (response[1] or {}).get("Error", {}).get("Code")
        key = mgr.credentials()
        if code != "InvalidAccessKeyId" or time.time() - key.created_at < FRESH_KEY_S:
            return None
        mgr.invalidate(key)
        _force_refresh(creds)
        return 0  # retry immediately

    return handler


def session(*, profile: str | None = None):
    import boto3
    import botocore.session

    cfg = load_config(profile=profile)
    core = botocore.session.get_session()
    core._credentials = _credentials(manager(cfg))  # boto3 has no public setter
    return boto3.Session(botocore_session=core, region_name=cfg.s3_region)


def client(asset: Any = None, *, profile: str | None = None):
    from botocore.config import Config as BotoConfig

    cfg = load_config(profile=profile)
    mgr = manager(cfg)
    sess = session(profile=profile)
    c = sess.client(
        "s3",
        endpoint_url=endpoint_for(asset, cfg) if asset is not None else cfg.s3_endpoint,
        config=BotoConfig(s3={"addressing_style": "path"}, retries={"max_attempts": 3}),
    )
    c.meta.events.register("needs-retry.s3", _retry_unknown_key(mgr, sess._session._credentials))
    return c


def storage_options(asset: Any = None, *, profile: str | None = None) -> dict:
    """fsspec/s3fs options (static key, valid up to 8 h — call again for a new one)."""
    cfg = load_config(profile=profile)
    key = manager(cfg).credentials()
    endpoint = endpoint_for(asset, cfg) if asset is not None else cfg.s3_endpoint
    return {
        "key": key.access_key,
        "secret": key.secret_key,
        "client_kwargs": {"endpoint_url": endpoint, "region_name": cfg.s3_region},
        "config_kwargs": {"s3": {"addressing_style": "path"}},
    }


def gdal_env(asset: Any = None, *, profile: str | None = None) -> dict[str, str]:
    """GDAL/rasterio settings for /vsis3/ (static key, valid up to 8 h)."""
    cfg = load_config(profile=profile)
    key = manager(cfg).credentials()
    endpoint = endpoint_for(asset, cfg) if asset is not None else str(cfg.s3_endpoint)
    parts = urlsplit(endpoint)
    return {
        "AWS_ACCESS_KEY_ID": key.access_key,
        "AWS_SECRET_ACCESS_KEY": key.secret_key,
        "AWS_S3_ENDPOINT": parts.netloc,
        "AWS_HTTPS": "YES" if parts.scheme == "https" else "NO",
        "AWS_VIRTUAL_HOSTING": "FALSE",
        "AWS_DEFAULT_REGION": cfg.s3_region,
        "GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR",
    }


def write_aws_profile(name: str = "jstex", *, profile: str | None = None) -> Path:
    """Write the current key as AWS profile `name` (for R, Julia and the AWS CLI).
    The key is valid up to 8 h; call again for a new one. Other profiles are kept."""
    import configparser

    cfg = load_config(profile=profile)
    key = manager(cfg).credentials()
    creds_path = Path(os.environ.get("AWS_SHARED_CREDENTIALS_FILE") or Path.home() / ".aws" / "credentials")
    conf_path = Path(os.environ.get("AWS_CONFIG_FILE") or Path.home() / ".aws" / "config")
    creds_path.parent.mkdir(parents=True, exist_ok=True)
    conf_path.parent.mkdir(parents=True, exist_ok=True)
    creds = configparser.ConfigParser()
    creds.read(creds_path)
    creds[name] = {"aws_access_key_id": key.access_key, "aws_secret_access_key": key.secret_key}
    fd = os.open(creds_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as fh:
        creds.write(fh)
    os.chmod(creds_path, 0o600)
    conf = configparser.ConfigParser()
    conf.read(conf_path)
    conf[f"profile {name}"] = {
        "endpoint_url": str(cfg.s3_endpoint),
        "region": cfg.s3_region,
        "s3": "\naddressing_style = path",
    }
    with conf_path.open("w") as fh:
        conf.write(fh)
    return creds_path
```

`jstex/__init__.py` — in `__getattr__`, before the final `raise`:

```python
    if name == "s3":
        import importlib

        return importlib.import_module(".s3", __name__)
```

and add `"s3"` to `__all__`.

- [ ] **Step 4: Run to verify they pass**

Run: `pytest -q tests`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
ruff format jstex tests && ruff check jstex tests
git add jstex/s3.py jstex/__init__.py tests/test_s3.py
git commit -m "feat(s3): client, session, location, storage_options, gdal_env, write_aws_profile"
```

---
### Task 13: "Copy boto3 snippet" per asset

**Files:**
- Modify: `js/snippets.ts`, `js/ui/details.ts`, `js/strings.ts`
- Test: `js/__tests__/details.test.ts` (append), `js/__tests__/foundations.test.ts` (append)

**Interfaces:**
- Consumes: `jstex.item`, `jstex.s3.client`, `jstex.s3.location` (Tasks 5, 12) — the snippet calls them.
- Produces: `pythonAssetSnippet(selfHref: string, assetKey: string): string`; `hasS3(a: StacAsset): boolean` (exported from `js/snippets.ts`).

- [ ] **Step 1: Write the failing tests**

Append to `js/__tests__/foundations.test.ts`:

```ts
import { hasS3, pythonAssetSnippet } from '../snippets';

describe('asset snippet', () => {
  it('downloads the asset over S3 with jstex', () => {
    expect(pythonAssetSnippet('https://stac.test/items/a', 'B04')).toBe(
      [
        '# needs: pip install "jupyterlab-jstex[s3]"',
        'import jstex',
        '',
        'item = jstex.item("https://stac.test/items/a")',
        'asset = item.assets["B04"]',
        'loc = jstex.s3.location(asset)',
        'jstex.s3.client(asset).download_file(**loc, Filename=loc["Key"].rsplit("/", 1)[-1])'
      ].join('\n')
    );
  });

  it('knows which assets are on S3', () => {
    expect(hasS3({ href: 's3://eodata/a' })).toBe(true);
    expect(hasS3({ href: '/eodata/a' })).toBe(true);
    expect(hasS3({ href: 'https://x/a', alternate: { s3: { href: 's3://eodata/a' } } })).toBe(true);
    expect(hasS3({ href: 'https://x/a' })).toBe(false);
  });
});
```

Append to `js/__tests__/details.test.ts` (inside the existing `describe`):

```ts
  it('offers a boto3 snippet for S3 assets', () => {
    const { el, store, actions } = setup();
    mountDetails(el, store, actions);
    store.set({ items: [item('a')], activeId: 'a' });
    const btn = el.querySelector<HTMLButtonElement>('[data-snippet="B04"]')!;
    expect(btn.textContent).toContain('Copy boto3 snippet');
    expect(btn.dataset.copy).toContain('item.assets["B04"]');
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `jlpm vitest run js/__tests__/foundations.test.ts js/__tests__/details.test.ts`
Expected: `SyntaxError ... does not provide an export named 'hasS3'`.

- [ ] **Step 3: Implement**

`js/snippets.ts` — append:

```ts
import type { StacAsset } from './types';

/** True when the asset (or its `s3` alternate) is reachable over S3. */
export function hasS3(a: StacAsset): boolean {
  const s3 = (h?: string) => !!h && (h.startsWith('s3://') || h.startsWith('/'));
  return s3(a.href) || s3(a.alternate?.s3?.href);
}

/** Python that downloads one asset over S3 with jstex's managed keys. */
export function pythonAssetSnippet(selfHref: string, assetKey: string): string {
  return [
    '# needs: pip install "jupyterlab-jstex[s3]"',
    'import jstex',
    '',
    `item = jstex.item(${JSON.stringify(selfHref)})`,
    `asset = item.assets[${JSON.stringify(assetKey)}]`,
    'loc = jstex.s3.location(asset)',
    'jstex.s3.client(asset).download_file(**loc, Filename=loc["Key"].rsplit("/", 1)[-1])'
  ].join('\n');
}
```

`js/strings.ts` — next to `copyPython`: `copyBoto3: trans.__('Copy boto3 snippet'),`

`js/ui/details.ts` — import `{ hasS3, pythonAssetSnippet, pythonItemSnippet }`, change `assetBlock` to take the item's self link and add the button after the hrefs:

```ts
function assetBlock(key: string, a: StacAsset, self?: string): string {
  // ... tags and alternates unchanged ...
  const snippet =
    self && hasS3(a)
      ? `<div class="jstex-asset__actions"><button type="button" class="jstex-control jstex-btn-sm" data-snippet="${escapeHtml(key)}" data-copy="${escapeHtml(pythonAssetSnippet(self, key))}">${ICON.code}<span>${escapeHtml(S.copyBoto3)}</span></button></div>`
      : '';
  return `<div class="jstex-asset">
    <div class="jstex-asset__head">…unchanged…</div>
    ${hrefLine(a.href)}${alternates}${snippet}
  </div>`;
}
```

and call it as `assets.map(([k, a]) => assetBlock(k, a, self))`. The existing click handler already copies any `button[data-copy]`.

`js/styles.css` — append:

```css
.jstex .jstex-asset__actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 2px;
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `jlpm vitest run && npx tsc -p js/tsconfig.json && jlpm i18n:extract`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
npx prettier --write "js/**/*.ts"
git add js jstex/locale/jstex.pot
git commit -m "feat(details): copy a boto3 snippet for S3 assets"
```

---
### Task 14: Sample notebooks and their CI check

**Files:**
- Create: `examples/01-download.ipynb`, `examples/02-ndvi-gdal.ipynb`, `examples/03-xarray.ipynb`, `examples/requirements.txt`, `examples/README.md`, `scripts/check_notebooks.py`
- Modify: `.github/workflows/build.yml` (one step), `README.md` (Examples section)

**Interfaces:**
- Consumes: `jstex.Explorer`, `ex.query`, `ex.search(wait=True)`, `ex.selected_item`, `ex.results`, `jstex.whoami`, `jstex.s3.location/client/gdal_env/storage_options` (Tasks 3–12).
- Produces: the notebooks (committed **without outputs**) and `python scripts/check_notebooks.py` (exit 1 when a code cell has outputs or an execution count, or a notebook is invalid).

- [ ] **Step 1: Write the failing check first** — `scripts/check_notebooks.py`:

```python
"""Example notebooks are committed without outputs, so no token, key or user
data can reach git. Fails (exit 1) on outputs, execution counts or invalid
notebooks."""

import pathlib
import sys

import nbformat

bad: list[str] = []
paths = sorted(pathlib.Path("examples").glob("*.ipynb"))
if not paths:
    bad.append("no notebooks in examples/")
for path in paths:
    nb = nbformat.read(path, as_version=4)
    try:
        nbformat.validate(nb)
    except nbformat.ValidationError as err:
        bad.append(f"{path}: invalid ({err.message})")
    for i, cell in enumerate(nb.cells):
        if cell.cell_type == "code" and (cell.get("outputs") or cell.get("execution_count") is not None):
            bad.append(f"{path}: cell {i} has outputs")
if bad:
    print("Example notebooks must be valid and committed without outputs:\n" + "\n".join(bad))
    sys.exit(1)
print(f"{len(paths)} notebooks ok")
```

Run: `python scripts/check_notebooks.py`
Expected: exit 1, `no notebooks in examples/`.

- [ ] **Step 2: Shared cells.** All three notebooks start with the same first cells (write them once in the generator below):

Markdown — "what you need" (per notebook, see Step 3) — then:

```python
import jstex

jstex.whoami()  # 'anonymous'? Sign in in the widget below or run jstex.login()
```

```python
ex = jstex.Explorer()
ex
```

Markdown: "Choose a Sentinel-2 L2A item in the widget (it becomes `ex.selected_item`), or run the next cell to search from code."

```python
AOI = [10.0, 45.3, 10.4, 45.6]  # lon/lat bbox (Lake Garda, Italy)
ex.query = {
    **ex.query,
    "collections": ["sentinel-2-l2a"],
    "datetime": {"from": "2024-07-01T00:00:00Z", "to": "2024-07-31T23:59:59Z"},
    "aois": [{"geometry": {"type": "Polygon", "coordinates": [[
        [AOI[0], AOI[1]], [AOI[2], AOI[1]], [AOI[2], AOI[3]], [AOI[0], AOI[3]], [AOI[0], AOI[1]]
    ]]}, "selected": True}],
    "filters": [{"field": "eo:cloud_cover", "op": "<=", "value": 10}],
}
ex.search(wait=True)
item = ex.selected_item or next(iter(ex.results))
item.id, sorted(item.assets)
```

```python
def band(item, common_name):
    """The finest-resolution asset of a band, by its common name (e.g. 'red', 'nir')."""
    found = []
    for key, asset in item.assets.items():
        bands = asset.extra_fields.get("eo:bands") or asset.extra_fields.get("bands") or []
        if any(common_name in (b.get("common_name"), b.get("eo:common_name")) for b in bands):
            found.append((asset.extra_fields.get("gsd") or 999, key, asset))
    if not found:
        raise KeyError(f"no {common_name!r} band in {sorted(item.assets)}")
    _, key, asset = min(found)
    return key, asset
```

- [ ] **Step 3: Notebook-specific cells**

**`01-download.ipynb`** — intro: "# Download data with jstex — selected assets or a complete product, over S3. You need `pip install \"jupyterlab-jstex[s3]\"` and a CDSE account (hub login, a stored session or **Sign in**)." After the shared cells:

```python
from pathlib import Path

out = Path("downloads") / item.id
out.mkdir(parents=True, exist_ok=True)
for name in ("red", "nir"):
    key, asset = band(item, name)
    loc = jstex.s3.location(asset)
    target = out / loc["Key"].rsplit("/", 1)[-1]
    jstex.s3.client(asset).download_file(**loc, Filename=str(target))
    print(f"{key}: {target} ({target.stat().st_size / 1e6:.1f} MB)")
```

Markdown: "Assets with an `https://` link download over HTTPS with your access token (`jstex.access_token()`). Send the token only to hosts you trust — here, the platform's own download service."

```python
import requests
from urllib.parse import urlsplit


def download_https(href, target):
    token = jstex.access_token()
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    with requests.get(href, headers=headers, stream=True, timeout=60) as resp:
        resp.raise_for_status()
        with open(target, "wb") as fh:
            for chunk in resp.iter_content(1 << 20):
                fh.write(chunk)


trusted = {"download.dataspace.copernicus.eu", "zipper.dataspace.copernicus.eu"}
for key, asset in item.assets.items():
    if asset.href.startswith("https://") and urlsplit(asset.href).hostname in trusted:
        target = out / f"{key}{Path(urlsplit(asset.href).path).suffix}"
        download_https(asset.href, target)
        print(f"{key}: {target} ({target.stat().st_size / 1e6:.1f} MB)")
        break  # one example; a full product zip can be several GB
```

Markdown: "## Complete product — every file under the product's S3 folder, keeping its layout; files already present with the same size are skipped."

```python
import os

from jstex.s3 import JstexS3Error


def s3_keys(item):
    for asset in item.assets.values():
        try:
            yield jstex.s3.location(asset)
        except JstexS3Error:
            pass  # asset without an S3 location


locs = list(s3_keys(item))
bucket = locs[0]["Bucket"]
prefix = os.path.commonprefix([loc["Key"] for loc in locs]).rsplit("/", 1)[0] + "/"
product = Path("downloads") / prefix.rstrip("/").rsplit("/", 1)[-1]
s3 = jstex.s3.client()
objects = [
    obj
    for page in s3.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=prefix)
    for obj in page.get("Contents", [])
]
total = sum(obj["Size"] for obj in objects)
done = 0
for obj in objects:
    target = product / obj["Key"][len(prefix):]
    if not (target.exists() and target.stat().st_size == obj["Size"]):
        target.parent.mkdir(parents=True, exist_ok=True)
        s3.download_file(bucket, obj["Key"], str(target))
    done += obj["Size"]
    print(f"\r{done / total:6.1%}  {target.name[:60]:<60}", end="")
print(f"\n{len(objects)} files, {total / 1e6:.0f} MB in {product}")
```

**`02-ndvi-gdal.ipynb`** — intro: "# Sentinel-2 NDVI with GDAL. NDVI = (NIR − Red) / (NIR + Red), read directly from S3 through GDAL's `/vsis3/`, cropped to the area of interest, written as a Cloud-Optimised GeoTIFF. You need `jupyterlab-jstex[s3]`, the GDAL Python bindings (`conda install gdal`, or the image's GDAL), numpy and matplotlib." After the shared cells:

```python
import numpy as np
from osgeo import gdal

gdal.UseExceptions()
red_key, red = band(item, "red")
nir_key, nir = band(item, "nir")
for name, value in jstex.s3.gdal_env(red).items():  # S3 key valid up to 8 h
    gdal.SetConfigOption(name, value)


def vsis3(asset):
    loc = jstex.s3.location(asset)
    return f"/vsis3/{loc['Bucket']}/{loc['Key']}"


def read(asset):
    """Crop to AOI (lon/lat) in the raster's own CRS; reflectance with nodata as NaN."""
    ds = gdal.Warp("", vsis3(asset), format="MEM", outputBounds=AOI, outputBoundsSRS="EPSG:4326")
    b = ds.GetRasterBand(1)
    arr = b.ReadAsArray().astype("float32")
    meta = (asset.extra_fields.get("raster:bands") or [{}])[0]
    nodata = b.GetNoDataValue() if b.GetNoDataValue() is not None else meta.get("nodata", 0)
    scale = meta.get("scale", b.GetScale() or 1.0)
    offset = meta.get("offset", b.GetOffset() or 0.0)
    refl = arr * scale + offset
    refl[arr == nodata] = np.nan
    return ds, refl


red_ds, red_r = read(red)
_, nir_r = read(nir)
with np.errstate(divide="ignore", invalid="ignore"):
    ndvi = (nir_r - red_r) / (nir_r + red_r)
print(f"NDVI {np.nanmin(ndvi):.2f} … {np.nanmax(ndvi):.2f}, mean {np.nanmean(ndvi):.2f}")
```

```python
mem = gdal.GetDriverByName("MEM").Create("", red_ds.RasterXSize, red_ds.RasterYSize, 1, gdal.GDT_Float32)
mem.SetGeoTransform(red_ds.GetGeoTransform())
mem.SetProjection(red_ds.GetProjection())
mem.GetRasterBand(1).WriteArray(np.nan_to_num(ndvi, nan=-9999))
mem.GetRasterBand(1).SetNoDataValue(-9999)
gdal.Translate(f"ndvi_{item.id}.tif", mem, format="COG", creationOptions=["COMPRESS=DEFLATE"])
```

```python
import matplotlib.pyplot as plt

plt.figure(figsize=(7, 6))
plt.imshow(ndvi, cmap="RdYlGn", vmin=-1, vmax=1)
plt.colorbar(label="NDVI")
plt.title(item.id)
plt.axis("off");
```

**`03-xarray.ipynb`** — intro: "# Working with xarray: open bands lazily from S3, clip to the AOI, mask clouds with the scene classification (SCL), and plot an NDVI time series. You need `jupyterlab-jstex[s3]`, rioxarray, xarray, matplotlib (dask for larger areas)." Shared cells, but with `"value": 30` cloud cover and then:

```python
import os

import pandas as pd
import rioxarray  # noqa: F401  (registers .rio)
import xarray as xr
from rasterio.enums import Resampling

os.environ.update(jstex.s3.gdal_env())  # GDAL reads these at every (lazy) read; key valid up to 8 h
items = sorted(ex.results, key=lambda i: i.datetime)[:6]


def asset_by_prefix(item, prefix):
    found = [(a.extra_fields.get("gsd") or 999, k, a) for k, a in item.assets.items() if k.upper().startswith(prefix)]
    return min(found)[1:] if found else (None, None)


def open_asset(asset):
    loc = jstex.s3.location(asset)
    da = rioxarray.open_rasterio(f"/vsis3/{loc['Bucket']}/{loc['Key']}", chunks={"x": 1024, "y": 1024}, masked=True)
    return da.squeeze("band", drop=True).rio.clip_box(*AOI, crs="EPSG:4326")


frames, dates = [], []
template = None
for it in items:
    red = open_asset(band(it, "red")[1])
    nir = open_asset(band(it, "nir")[1])
    template = red if template is None else template
    red, nir = red.rio.reproject_match(template), nir.rio.reproject_match(template)
    ndvi = (nir - red) / (nir + red)
    _, scl_asset = asset_by_prefix(it, "SCL")
    if scl_asset is not None:  # keep vegetation, bare soil and water (SCL 4, 5, 6)
        scl = open_asset(scl_asset).rio.reproject_match(template, resampling=Resampling.nearest)
        ndvi = ndvi.where(scl.isin([4, 5, 6]))
    frames.append(ndvi)
    dates.append(pd.Timestamp(it.datetime))
cube = xr.concat(frames, dim=pd.Index(dates, name="time"))
cube
```

```python
series = cube.mean(dim=("x", "y")).compute()
series.plot(marker="o", figsize=(8, 3))
```

```python
cube.median("time").plot(cmap="RdYlGn", vmin=-1, vmax=1, figsize=(7, 6))
```

Markdown (last cell): "**Dask:** the arrays above are lazy (`chunks=`); `.compute()` reads only the clipped blocks. For larger areas or longer periods, start a `dask.distributed.Client()` first."

- [ ] **Step 4: Generate the notebooks** (one-off; do not commit the script) — put the cell texts from Steps 2–3 into lists and write them with nbformat:

```python
import nbformat as nbf

def notebook(cells):  # cells: list of ("md" | "code", source)
    nb = nbf.v4.new_notebook()
    nb.metadata["kernelspec"] = {"name": "python3", "display_name": "Python 3", "language": "python"}
    nb.cells = [nbf.v4.new_markdown_cell(src) if kind == "md" else nbf.v4.new_code_cell(src) for kind, src in cells]
    return nb

# nbf.write(notebook([...]), "examples/01-download.ipynb")  — likewise 02, 03
```

`examples/requirements.txt`:

```text
jupyterlab-jstex[s3]
numpy
matplotlib
rioxarray
xarray
pandas
dask[array]
# GDAL Python bindings: conda install -c conda-forge gdal (or your image's GDAL)
```

`examples/README.md`: one paragraph per notebook (what it shows, what it needs), the note that notebooks are stored without outputs, and how to run them (`pip install -r examples/requirements.txt`, open in JupyterLab, sign in).

Run: `python scripts/check_notebooks.py && pip install nbqa && nbqa ruff examples`
Expected: `3 notebooks ok`; ruff clean.

- [ ] **Step 5: CI** — `.github/workflows/build.yml`, after the "Lint the extension" step:

```yaml
    - name: Check example notebooks
      run: |
        set -eux
        python -m pip install nbformat nbqa ruff
        python scripts/check_notebooks.py
        nbqa ruff examples
```

- [ ] **Step 6: Run them for real (manual, needs a CDSE account)** — in a JupyterLab with the dev install and `pip install -r examples/requirements.txt`: run each notebook top to bottom, signed in to CDSE. Fix the cells if the live catalogue differs (asset keys, band metadata, SCL key), keeping the generator text in sync. Save the NDVI map (02) and the time series (03) as `docs/images/example-ndvi.png` and `docs/images/example-ndvi-series.png`. Then **clear all outputs** (`jupyter nbconvert --clear-output --inplace examples/*.ipynb`) and re-run `python scripts/check_notebooks.py`.

- [ ] **Step 7: README** — add after "Using results in Python":

```markdown
## Examples

Notebooks in [`examples/`](examples/) (stored without outputs; `pip install -r examples/requirements.txt`):

- [Download data](examples/01-download.ipynb) — selected assets or a complete product over S3.
- [Sentinel-2 NDVI with GDAL](examples/02-ndvi-gdal.ipynb) — read bands through `/vsis3/`, write a Cloud-Optimised GeoTIFF.

  ![NDVI map from the GDAL example](docs/images/example-ndvi.png)
- [Working with xarray](examples/03-xarray.ipynb) — lazy bands, cloud mask, NDVI time series.

  ![NDVI time series from the xarray example](docs/images/example-ndvi-series.png)
```

- [ ] **Step 8: Commit**

```bash
git add examples scripts/check_notebooks.py .github/workflows/build.yml README.md docs/images/example-ndvi.png docs/images/example-ndvi-series.png
git commit -m "docs(examples): download, NDVI with GDAL and xarray notebooks; CI keeps them output-free"
```

---
### Task 15: Documentation, packaging check and milestone

**Files:**
- Modify: `README.md`, `DEVELOPMENT.md`, `CONTRIBUTING.md`, `docs/architecture.md`, `CHANGELOG.md`, `deploy/z2jh-values.example.yaml`, `jstex/locale/jstex.pot`

**Interfaces:**
- Consumes: everything above. Produces documentation only, plus the `MILESTONE:` commit.

- [ ] **Step 1: README** — user-facing sections (replace the old basemap-centred Configuration text where it overlaps):
  - **Profiles:** what a profile is; ready-made `cdse-opensearch` (default), `cdse`, `creodias`, `codede`; `jstex.list_profiles()`, `jstex.config()`; selecting with `Explorer(profile=…)` / `JSTEX_PROFILE` / `profile =` in `~/.config/jstex/config.toml`; an own profile example (the TOML from spec §3.3); `profile = "none"`; that values merge GitHub registry → `eo-services.json` discovery → config files → env → arguments, and `JSTEX_PROFILES_URL=builtin` for offline use.
  - **Configuration table:** add `JSTEX_PROFILE`, `JSTEX_PROFILES_URL`, `JSTEX_OIDC_ISSUER`, `JSTEX_LOGIN_CLIENT_ID`, `JSTEX_PASSWORD_CLIENT_ID`, `JSTEX_PASSWORD_LOGIN`, `JSTEX_OFFLINE_ACCESS`, `JSTEX_S3_ENDPOINT`, `JSTEX_S3_REGION`, `JSTEX_S3_KEYS_URL`, `JSTEX_S3_BUCKET` (meaning and default = from the profile).
  - **Signing in:** the order (manual token → JupyterHub → stored session → device login → password); the **Sign in** button and `jstex.login()` / `jstex.logout()` / `jstex.whoami()`; device login needs a device-enabled client id (configured, from discovery, or typed in; `save=True`); password login caveats (no MFA/social login, HTTPS warning); where sessions are stored.
  - **S3 access:** `pip install "jupyterlab-jstex[s3]"`; `jstex.s3.client(asset)`, `location`, `session`, `storage_options`, `gdal_env`, `write_aws_profile` with one example each; keys are created for 8 h, renewed and shared by your kernels; the key-limit message.
  - **Limitations:** remove the ones now solved; keep "one area of interest", "Load more" (other v0.2 plan).
- [ ] **Step 2: DEVELOPMENT.md** — Architecture summary bullets for `profiles.py`, `config.py`, `oidc.py`/`sessions.py`/`auth.py`, `login.py`, `s3.py`; Gotchas:
  - tests run offline: `tests/conftest.py` sets `JSTEX_PROFILES_URL=builtin` and private `XDG_*` dirs; tests that need the network registry or discovery set `JSTEX_PROFILES_URL` themselves and mock with `responses`;
  - `jstex.profiles` is the submodule, so the public helper is `jstex.list_profiles()`;
  - registry data lives in `jstex/data/` (a `jstex/profiles/` folder would clash with `profiles.py`);
  - `jstex/s3.py` uses botocore's private `_protected_refresh` and `Session._credentials` (no public API); pinned by tests;
  - `filelock` locks across threads too (separate file handles), which the concurrency test relies on.
- [ ] **Step 3: docs/architecture.md** — new sections: Profiles (sources, merge order, cache, validation, `pinned`), Token chain (replace §9 with the six steps, issuer match, sessions, device/password, widget protocol table from Task 8), S3 keys (policy and helpers); update the module tables, the context diagram (identity service and keys manager), and the traits/messages tables (`profile_name`, `auth_user`, `login_methods`, login messages).
- [ ] **Step 4: CHANGELOG.md** — under `## [Unreleased]`:

```markdown
### Added

- **Profiles**: ready-made settings for CDSE (`cdse-opensearch` default, `cdse`), CREODIAS and CODE-DE, merged from the jstex profile registry on GitHub, the platform's `eo-services.json` discovery document, `/etc/jstex/config.toml` and `~/.config/jstex/config.toml`, `JSTEX_*` variables and arguments; own profiles for private catalogues; `jstex.config()` and `jstex.list_profiles()`.
- **Sign in without JupyterHub**: device-code login (PKCE) and, where the platform allows it, password login — from the widget's **Sign in** button or `jstex.login()`; stored sessions are reused by later kernels; `jstex.logout()`, `jstex.whoami()`.
- **S3 access** (`pip install "jupyterlab-jstex[s3]"`): S3 keys created and renewed automatically and shared by your kernels; `jstex.s3.client()`, `location()`, `session()`, `storage_options()`, `gdal_env()`, `write_aws_profile()`; "Copy boto3 snippet" per asset.
- **Example notebooks**: downloading data, Sentinel-2 NDVI with GDAL, xarray time series.

### Changed

- The JupyterHub token is used only for the profile's own identity service; the user's token is sent only to the profile's STAC, identity and keys-manager hosts.
- The status line shows how you are signed in (`hub`, `token`, `session`, `device login`, `password`); the source previously called `env` is now `token`.
```

- [ ] **Step 5: deploy example** — `deploy/z2jh-values.example.yaml` `singleuser.extraEnv`: add commented `JSTEX_PROFILE: cdse-opensearch` and a note that device/password login is not needed on a hub (the hub token is used when its issuer matches the profile).
- [ ] **Step 5b: Release checklist** — `CONTRIBUTING.md`, "Packaging the extension": insert before the tag step:

```markdown
2. Run the three notebooks in `examples/` top to bottom against CDSE (signed
   in, `pip install -r examples/requirements.txt`); check their results, then
   clear the outputs (`jupyter nbconvert --clear-output --inplace examples/*.ipynb`)
   and run `python scripts/check_notebooks.py`.
```

and renumber the following steps.
- [ ] **Step 6: Translations** — `jlpm i18n:extract`; commit the updated `jstex/locale/jstex.pot`.
- [ ] **Step 7: Full verification**

Run, in order (all must pass):

```bash
ruff check jstex tests && ruff format --check jstex tests
pytest -q tests jstex/tests
jlpm vitest run && npx tsc -p js/tsconfig.json && jlpm lint:check
python scripts/check_notebooks.py
jlpm build && (cd ui-tests && jlpm playwright test)
jlpm build:prod && rm -rf dist && python -m build --wheel
unzip -l dist/*.whl | grep -E 'jstex/data/profiles(\.schema)?\.json|jstex/static/widget.js'
jlpm build   # back to the development labextension for local Galata runs
```

Expected: every suite green; the wheel lists `jstex/data/profiles.json`, `jstex/data/profiles.schema.json` and the widget bundle.

- [ ] **Step 8: Commit**

```bash
npx prettier --write README.md DEVELOPMENT.md CONTRIBUTING.md CHANGELOG.md docs/architecture.md
git add README.md DEVELOPMENT.md CONTRIBUTING.md CHANGELOG.md docs/architecture.md deploy/z2jh-values.example.yaml jstex/locale/jstex.pot
git commit -m "MILESTONE: v0.2 base — profiles, sign-in and S3 keys (docs, changelog)"
```

Do not push or merge; report to the user with the test counts (pushing and merging need their approval).
