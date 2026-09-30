"""Access-token provider chain: JupyterHub auth_state -> JSTEX_ACCESS_TOKEN -> anonymous.

The hub's OAuthenticator keeps the user's OIDC tokens in the encrypted
``auth_state``. The single-user server may read it live when the hub grants
the ``admin:auth_state!user`` scope (see deploy/z2jh-values.example.yaml).
Only the access token leaves this module; the refresh token is never kept.
"""

from __future__ import annotations

import base64
import json
import os
import threading
import time
import warnings
from dataclasses import dataclass, field
from typing import Literal
from urllib.parse import quote

import requests

REFRESH_MARGIN_S = 60  # re-fetch when the token has less than this left
MIN_CACHE_S = 15  # never ask the hub more often than this
ANON_CACHE_S = 60  # how long an anonymous result is reused
HUB_TIMEOUT_S = 10

Source = Literal["hub", "env", "anonymous"]


@dataclass(frozen=True)
class TokenInfo:
    token: str | None = field(repr=False)
    source: Source
    expires_at: float


_lock = threading.Lock()
_cached: TokenInfo | None = None
_cache_until: float = 0.0
_warned: set[str] = set()


def _warn_once(key: str, message: str) -> None:
    if key not in _warned:
        _warned.add(key)
        warnings.warn(message, UserWarning, stacklevel=3)


def _jwt_exp(token: str) -> float | None:
    try:
        payload = token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        return float(json.loads(base64.urlsafe_b64decode(payload))["exp"])
    except (IndexError, ValueError, KeyError, TypeError):
        return None


def _from_hub() -> str | None:
    api = os.environ.get("JUPYTERHUB_API_URL")
    server_token = os.environ.get("JUPYTERHUB_API_TOKEN")
    user = os.environ.get("JUPYTERHUB_USER")
    if not (api and server_token and user):
        return None
    # /users/{name}, NOT /user: the latter returns auth_state: null (jupyterhub#5103).
    url = f"{api.rstrip('/')}/users/{quote(user, safe='')}"
    try:
        resp = requests.get(
            url,
            headers={"Authorization": f"token {server_token}"},
            timeout=HUB_TIMEOUT_S,
        )
    except requests.RequestException as err:
        _warn_once(
            "unreachable",
            f"jstex: JupyterHub API unreachable ({err}); searching anonymously.",
        )
        return None
    if resp.status_code == 403:
        _warn_once(
            "403",
            "jstex: the server token may not read auth_state; grant 'admin:auth_state!user' "
            "to the 'server' role (see deploy/z2jh-values.example.yaml). Searching anonymously.",
        )
        return None
    if not resp.ok:
        _warn_once(
            f"http{resp.status_code}",
            f"jstex: JupyterHub API returned {resp.status_code}; searching anonymously.",
        )
        return None
    state = resp.json().get("auth_state") or {}
    token = state.get("access_token")
    if not token:
        _warn_once(
            "null",
            "jstex: JupyterHub returned no auth_state access token; enable "
            "Authenticator.enable_auth_state and the admin:auth_state!user scope. Searching anonymously.",
        )
        return None
    return token


def _resolve(now: float) -> tuple[TokenInfo, float]:
    token = _from_hub()
    if token:
        exp = _jwt_exp(token) or now + 300
        return TokenInfo(token, "hub", exp), max(
            exp - REFRESH_MARGIN_S, now + MIN_CACHE_S
        )
    env_token = os.environ.get("JSTEX_ACCESS_TOKEN")
    if env_token:
        exp = _jwt_exp(env_token) or now + 3600
        return TokenInfo(env_token, "env", exp), max(
            exp - REFRESH_MARGIN_S, now + MIN_CACHE_S
        )
    return TokenInfo(None, "anonymous", now + ANON_CACHE_S), now + ANON_CACHE_S


def current(force_refresh: bool = False) -> TokenInfo:
    """Return the best available token, cached until shortly before it expires."""
    global _cached, _cache_until
    with _lock:
        now = time.time()
        if not force_refresh and _cached is not None and now < _cache_until:
            return _cached
        _cached, _cache_until = _resolve(now)
        return _cached


def get_token(force_refresh: bool = False) -> str | None:
    return current(force_refresh).token


def headers() -> dict[str, str]:
    token = get_token()
    return {"Authorization": f"Bearer {token}"} if token else {}


def reset_cache() -> None:
    global _cached, _cache_until
    with _lock:
        _cached, _cache_until = None, 0.0
        _warned.clear()


def _cache_until_override(value: float) -> None:
    """Test hook: pretend the cache window ended at ``value``."""
    global _cache_until
    with _lock:
        _cache_until = value
