"""Interactive login (spec 2026-10-02 §4 steps 4-5): device code with PKCE,
and the password grant. Runs only on user action."""

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
        raise LoginError(
            "This profile has no identity service (issuer).", "unsupported"
        )
    endpoint = oidc.metadata(cfg.issuer).get("device_authorization_endpoint")
    if not endpoint:
        raise LoginError(
            "The identity service does not offer device login.", "unsupported"
        )
    verifier, challenge = _pkce()
    try:
        resp = requests.post(
            endpoint,
            data={
                "client_id": client_id,
                "scope": scope(cfg),
                "code_challenge": challenge,
                "code_challenge_method": "S256",
            },
            timeout=oidc.TIMEOUT_S,
        )
        body = resp.json()
    except (requests.RequestException, ValueError) as err:
        raise LoginError(
            "The identity service could not start a device login."
        ) from err
    if resp.status_code >= 400 or "error" in body:
        error = str(body.get("error", ""))
        if error in ("unauthorized_client", "invalid_client"):
            raise LoginError(
                f"Client {client_id!r} is not allowed to use device login.",
                "client_refused",
            )
        raise LoginError(f"Device login failed ({error or resp.status_code}).")
    expires_in = int(body.get("expires_in", max_wait))
    show(
        DeviceCode(
            body.get("verification_uri_complete") or body["verification_uri"],
            body["user_code"],
            expires_in,
        )
    )
    interval = float(body.get("interval", 5))
    deadline = now() + min(max_wait, expires_in)
    while True:
        if cancel is not None and cancel.is_set():
            raise LoginError("Sign-in cancelled.", "cancelled")
        if now() >= deadline:
            raise LoginError(
                "The code expired before sign-in was completed.", "timeout"
            )
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
                raise LoginError(
                    "The code expired before sign-in was completed.", "timeout"
                ) from err
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


def password_login(
    cfg: Config, *, username: str, password: str, client_id: str | None = None
) -> auth.TokenInfo:
    """Resource-owner password grant. The password is sent once and never kept."""
    cid = client_id or cfg.password_client_id
    if not cfg.issuer or not cid:
        raise LoginError(
            "This profile has no client for password login.", "unsupported"
        )
    try:
        tokens = oidc.token_request(
            cfg.issuer,
            {
                "grant_type": "password",
                "username": username,
                "password": password,
                "client_id": cid,
                "scope": scope(cfg),
            },
        )
    except oidc.OidcError as err:
        text = err.description.lower()
        if err.error == "invalid_grant" and (
            "not fully set up" in text or "required action" in text or "otp" in text
        ):
            raise LoginError(
                "This account needs a browser login (MFA or required action); use device login.",
                "needs_browser",
            ) from None
        if err.error == "invalid_grant":
            raise LoginError("Wrong username or password.", "bad_credentials") from None
        if err.error in (
            "unauthorized_client",
            "unsupported_grant_type",
            "invalid_client",
        ):
            raise LoginError(
                "Password login is not allowed for this profile's client.",
                "unsupported",
            ) from None
        raise LoginError(f"Password login failed ({err.error}).") from None
    return _finish(cfg, tokens, cid, "password")
