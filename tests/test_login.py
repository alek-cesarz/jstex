import base64
import hashlib
import logging
import threading
import time
from urllib.parse import parse_qs

import pytest
import responses

from jstex import auth, oidc
from jstex.config import load_config
from jstex.interactive import (
    DeviceCode,
    LoginError,
    device_login,
    login_client_id,
    password_login,
)
from jstex.sessions import Session, SessionStore

ISSUER = "https://id.example.org/realms/r"
DEVICE = ISSUER + "/protocol/openid-connect/auth/device"
TOKEN = ISSUER + "/protocol/openid-connect/token"


@pytest.fixture
def cfg(tmp_path):
    auth._store = SessionStore(tmp_path / "sessions.json")
    oidc.reset()
    yield load_config(
        profile="none", stac_url="https://stac.example.org/v1", issuer=ISSUER
    )
    auth._store = None


def mock_meta():
    responses.get(
        ISSUER + "/.well-known/openid-configuration",
        json={
            "issuer": ISSUER,
            "token_endpoint": TOKEN,
            "device_authorization_endpoint": DEVICE,
        },
    )


def device_ok():
    responses.post(
        DEVICE,
        json={
            "device_code": "DC",
            "user_code": "ABCD-EFGH",
            "verification_uri": ISSUER + "/device",
            "verification_uri_complete": ISSUER + "/device?user_code=ABCD-EFGH",
            "expires_in": 600,
            "interval": 5,
        },
    )


@responses.activate
def test_device_login_polls_until_approved_with_pkce(cfg):
    mock_meta()
    device_ok()
    answers = iter(
        [
            (400, {"error": "authorization_pending"}),
            (400, {"error": "slow_down"}),
            (
                200,
                {
                    "access_token": "opaque-access",
                    "expires_in": 300,
                    "refresh_token": "R",
                    "refresh_expires_in": 1800,
                },
            ),
        ]
    )
    bodies = []

    def token(request):
        bodies.append(parse_qs(request.body))
        status, body = next(answers)
        import json

        return (status, {}, json.dumps(body))

    responses.add_callback(responses.POST, TOKEN, callback=token)
    shown, sleeps = [], []
    info = device_login(cfg, client_id="dev", show=shown.append, sleep=sleeps.append)
    assert shown == [
        DeviceCode(ISSUER + "/device?user_code=ABCD-EFGH", "ABCD-EFGH", 600)
    ]
    assert sleeps == [5.0, 5.0, 10.0]  # slow_down adds 5 s
    assert info.source == "device" and info.token == "opaque-access"
    assert (
        abs(info.expires_at - (time.time() + 300)) < 5
    )  # from expires_in, not the JWT
    start = parse_qs(responses.calls[1].request.body)
    assert start["code_challenge_method"] == ["S256"] and start["client_id"] == ["dev"]
    verifier = bodies[0]["code_verifier"][0]
    expected = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest())
        .rstrip(b"=")
        .decode()
    )
    assert start["code_challenge"] == [expected]
    stored = auth._store.get(ISSUER)
    assert (stored.client_id, stored.refresh_token, stored.method) == (
        "dev",
        "R",
        "device",
    )


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
        device_login(
            cfg,
            client_id="dev",
            show=lambda c: None,
            cancel=cancel,
            sleep=lambda s: None,
        )
    assert err.value.reason == "cancelled"


def test_client_id_from_config_or_a_remembered_device_session(cfg):
    assert login_client_id(cfg) is None
    auth._store.put(ISSUER, Session("remembered", "R", None, "device"))
    assert login_client_id(cfg) == "remembered"
    assert (
        login_client_id(
            load_config(
                profile="none",
                stac_url="https://s/v1",
                issuer=ISSUER,
                login_client_id="cfg",
            )
        )
        == "cfg"
    )
    auth._store.put(ISSUER, Session("pw", "R", None, "password"))
    assert login_client_id(cfg) is None  # a password client is not a device client


@responses.activate
def test_jstex_login_asks_for_a_client_id_and_can_save_it(cfg, monkeypatch):
    import jstex

    mock_meta()
    device_ok()
    responses.post(
        TOKEN, json={"access_token": "A", "expires_in": 300, "refresh_token": "R"}
    )
    monkeypatch.setenv("JSTEX_STAC_URL", "https://stac.example.org/v1")
    monkeypatch.setenv("JSTEX_OIDC_ISSUER", ISSUER)
    monkeypatch.setattr("builtins.input", lambda prompt="": "typed-client")
    monkeypatch.setattr("jstex.interactive.time.sleep", lambda s: None)
    status = jstex.login(profile="none", method="device", save=False)
    assert status.startswith("Signed in (device login)")
    assert auth._store.get(ISSUER).client_id == "typed-client"


@responses.activate
def test_jstex_login_with_a_token(cfg):
    import jstex

    assert jstex.login(profile="cdse-opensearch", token="MANUAL").startswith(
        "Signed in (token)"
    )


@responses.activate
def test_password_login_stores_a_password_session(cfg):
    mock_meta()
    cfg2 = load_config(
        profile="none", stac_url="https://s/v1", issuer=ISSUER, password_client_id="pub"
    )
    responses.post(
        TOKEN,
        json={"access_token": "A", "expires_in": 300, "refresh_token": "R"},
        match=[
            responses.matchers.urlencoded_params_matcher(
                {
                    "grant_type": "password",
                    "username": "alice",
                    "password": "s3cret",
                    "client_id": "pub",
                    "scope": "openid",
                }
            )
        ],
    )
    info = password_login(cfg2, username="alice", password="s3cret")
    assert info.source == "password"
    assert auth._store.get(ISSUER).method == "password"


@responses.activate
@pytest.mark.parametrize(
    ("body", "reason"),
    [
        (
            {"error": "invalid_grant", "error_description": "Invalid user credentials"},
            "bad_credentials",
        ),
        (
            {
                "error": "invalid_grant",
                "error_description": "Account is not fully set up",
            },
            "needs_browser",
        ),
        (
            {
                "error": "unauthorized_client",
                "error_description": "Client not allowed for direct access grants",
            },
            "unsupported",
        ),
    ],
)
def test_password_errors_never_leak_the_password(cfg, caplog, body, reason):
    mock_meta()
    cfg2 = load_config(
        profile="none", stac_url="https://s/v1", issuer=ISSUER, password_client_id="pub"
    )
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
    responses.post(
        TOKEN, json={"access_token": "A", "expires_in": 300, "refresh_token": "R"}
    )
    monkeypatch.setenv("JSTEX_STAC_URL", "https://stac.example.org/v1")
    monkeypatch.setenv("JSTEX_OIDC_ISSUER", ISSUER)
    monkeypatch.setenv("JSTEX_PASSWORD_CLIENT_ID", "pub")
    monkeypatch.setenv("JSTEX_PASSWORD_LOGIN", "1")
    monkeypatch.setattr("getpass.getpass", lambda prompt="": "s3cret")
    assert jstex.login(profile="none", method="password", username="alice").startswith(
        "Signed in (password)"
    )
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
