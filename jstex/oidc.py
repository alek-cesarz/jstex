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
        resp = requests.get(
            f"{key}/.well-known/openid-configuration", timeout=TIMEOUT_S
        )
        resp.raise_for_status()
        data = resp.json()
    except (requests.RequestException, ValueError) as err:
        raise OidcError(
            "discovery_failed", f"cannot read {key}/.well-known/openid-configuration"
        ) from err
    with _lock:
        _meta[key] = data
    return data


def token_request(issuer: str, data: dict) -> dict:
    endpoint = metadata(issuer)["token_endpoint"]
    try:
        resp = requests.post(endpoint, data=data, timeout=TIMEOUT_S)
    except requests.RequestException as err:
        raise OidcError(
            "network_error", f"token endpoint unreachable ({type(err).__name__})"
        ) from err
    try:
        body = resp.json()
    except ValueError:
        body = {}
    if resp.status_code >= 400 or "error" in body:
        # Never echo the request (it may hold a password or refresh token).
        raise OidcError(
            str(body.get("error", f"http_{resp.status_code}")),
            str(body.get("error_description", "")),
        )
    return body


def claims(token: str) -> dict:
    try:
        payload = token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        data = json.loads(base64.urlsafe_b64decode(payload))
        return data if isinstance(data, dict) else {}
    except (IndexError, ValueError):
        return {}
