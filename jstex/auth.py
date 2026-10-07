"""Access-token chain per identity service (spec 2026-10-02 §4):
manual token -> JupyterHub auth_state (same issuer only) -> stored session
-> (device / password: jstex.login) -> anonymous.
Only access tokens leave this module; refresh tokens stay in the session store.
"""

from __future__ import annotations

import base64
import json
import os
import threading
import time
import warnings
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Literal
from urllib.parse import quote

import requests

from . import oidc
from .errors import JstexWarning
from .sessions import Session, SessionStore

if TYPE_CHECKING:
    from .config import Config

REFRESH_MARGIN_S = 60  # re-fetch when the token has less than this left
MIN_CACHE_S = 15  # never ask the hub more often than this
ANON_CACHE_S = 60  # how long an anonymous result is reused
HUB_TIMEOUT_S = 10

_warned: set[str] = set()


def _warn_once(key: str, message: str) -> None:
    if key not in _warned:
        _warned.add(key)
        warnings.warn(message, JstexWarning, stacklevel=3)


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
    try:
        body = resp.json()
    except ValueError:
        _warn_once(
            "json",
            "jstex: the JupyterHub API answer is not JSON (proxy or login page?); searching anonymously.",
        )
        return None
    state = (body.get("auth_state") if isinstance(body, dict) else None) or {}
    token = state.get("access_token")
    if not token:
        _warn_once(
            "null",
            "jstex: JupyterHub returned no auth_state access token; enable "
            "Authenticator.enable_auth_state and the admin:auth_state!user scope. Searching anonymously.",
        )
        return None
    return token


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


def _info(
    token: str, source: Source, now: float, expires_in: float | None = None
) -> tuple[TokenInfo, float]:
    exp = now + float(expires_in) if expires_in else (_jwt_exp(token) or now + 300)
    return TokenInfo(token, source, exp, _user(token)), max(
        exp - REFRESH_MARGIN_S, now + MIN_CACHE_S
    )


def _from_session(issuer: str, now: float) -> tuple[TokenInfo, float] | None:
    store = sessions()
    with store.locked():  # one kernel refreshes at a time; the next reads its result
        return _refresh_session(store, issuer, now)


def _refresh_session(
    store: SessionStore, issuer: str, now: float
) -> tuple[TokenInfo, float] | None:
    session = store.get(issuer)
    if session is None:
        return None
    for _ in range(2):  # second round: another kernel may have rotated the token
        try:
            body = oidc.token_request(
                issuer,
                {
                    "grant_type": "refresh_token",
                    "refresh_token": session.refresh_token,
                    "client_id": session.client_id,
                },
            )
        except oidc.OidcError as err:
            if err.error != "invalid_grant":
                _warn_once(
                    f"refresh:{issuer}",
                    f"jstex: session refresh failed ({err.error}); searching anonymously.",
                )
                return None
            newer = store.get(issuer)
            if newer is not None and newer.refresh_token != session.refresh_token:
                session = newer
                continue
            store.drop(issuer, refresh_token=session.refresh_token)
            _warn_once(
                f"expired:{issuer}", "jstex: stored login expired; sign in again."
            )
            return None
        if body.get("refresh_token"):
            store.put(
                issuer,
                Session(
                    session.client_id,
                    body["refresh_token"],
                    now + float(body["refresh_expires_in"])
                    if body.get("refresh_expires_in")
                    else None,
                    session.method,
                ),
            )
        return _info(body["access_token"], "session", now, body.get("expires_in"))
    return None


def _iss(token: str) -> str:
    return str(oidc.claims(token).get("iss", "")).rstrip("/")


def _env_token(issuer: str | None) -> str | None:
    """JSTEX_ACCESS_TOKEN, unless it is a JWT issued by another identity service."""
    token = os.environ.get("JSTEX_ACCESS_TOKEN")
    iss = _iss(token) if token else ""
    if token and issuer and iss and iss != issuer:
        _warn_once(
            f"env-iss:{issuer}",
            f"jstex: JSTEX_ACCESS_TOKEN was issued by {iss}, not by this profile's "
            f"identity service {issuer}; it is not used here.",
        )
        return None
    return token


def _resolve(cfg: Config | None, now: float) -> tuple[TokenInfo, float]:
    """The token chain (spec §4). `cfg=None` is the unscoped v0.1 lookup used only
    by low-level callers; with a profile, the hub token needs a matching issuer."""
    issuer = _issuer(cfg)
    manual = _manual.get(issuer) or _env_token(issuer)
    if manual:
        return _info(manual, "token", now)
    if cfg is None or issuer:
        hub = _from_hub()
        if hub and (cfg is None or _iss(hub) == issuer):
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
            Session(
                client_id,
                refresh_token,
                now + float(refresh_expires_in) if refresh_expires_in else None,
                method,
            ),
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
                        data={
                            "token": session.refresh_token,
                            "client_id": session.client_id,
                            "token_type_hint": "refresh_token",
                        },
                        timeout=HUB_TIMEOUT_S,
                    )
                except requests.RequestException:
                    pass  # best effort; the local session is dropped anyway
            sessions().drop(issuer)
    with _lock:
        _manual.pop(issuer, None)
        _cached[issuer] = (
            TokenInfo(None, "anonymous", time.time() + ANON_CACHE_S),
            time.time() + ANON_CACHE_S,
        )


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
