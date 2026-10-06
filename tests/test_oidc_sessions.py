import json
import os
import stat

import pytest
import responses
from jstex.sessions import Session, SessionStore

from jstex import oidc
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
    responses.post(
        TOKEN,
        status=400,
        json={"error": "invalid_grant", "error_description": "Token is not active"},
    )
    with pytest.raises(oidc.OidcError) as err:
        oidc.token_request(
            ISSUER,
            {"grant_type": "refresh_token", "refresh_token": "x", "client_id": "c"},
        )
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
