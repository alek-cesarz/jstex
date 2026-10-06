import json
import time

import pytest
import responses

from jstex import auth, oidc
from jstex.config import load_config
from jstex.sessions import Session, SessionStore
from tests.conftest import make_jwt


@responses.activate
def test_hub_token_is_read_from_users_endpoint(hub_env):
    token = make_jwt(time.time() + 600)
    responses.get(
        hub_env,
        json={
            "name": "alice@example.org",
            "auth_state": {"access_token": token, "refresh_token": "R"},
        },
        match=[
            responses.matchers.header_matcher({"Authorization": "token server-token"})
        ],
    )
    info = auth.current()
    assert info.token == token and info.source == "hub"
    assert "R" not in repr(info)


@responses.activate
def test_hub_token_is_cached_until_near_expiry(hub_env):
    responses.get(
        hub_env, json={"auth_state": {"access_token": make_jwt(time.time() + 600)}}
    )
    auth.current()
    auth.current()
    assert len(responses.calls) == 1


@responses.activate
def test_token_close_to_expiry_is_refetched(hub_env):
    responses.get(
        hub_env, json={"auth_state": {"access_token": make_jwt(time.time() + 30)}}
    )
    auth.current()
    auth._cache_until_override(0)  # simulate the 15 s floor having elapsed
    auth.current()
    assert len(responses.calls) == 2


@responses.activate
def test_force_refresh_bypasses_cache(hub_env):
    responses.get(
        hub_env, json={"auth_state": {"access_token": make_jwt(time.time() + 600)}}
    )
    auth.current()
    auth.current(force_refresh=True)
    assert len(responses.calls) == 2


@responses.activate
def test_null_auth_state_warns_once_and_falls_back_to_anonymous(hub_env):
    responses.get(hub_env, json={"auth_state": None})
    with pytest.warns(UserWarning, match="auth_state"):
        info = auth.current()
    assert info.token is None and info.source == "anonymous"


@responses.activate
def test_hub_403_falls_back_with_scope_hint(hub_env):
    responses.get(hub_env, status=403, json={"message": "forbidden"})
    with pytest.warns(UserWarning, match="admin:auth_state!user"):
        assert auth.current().source == "anonymous"


def test_hub_unreachable_falls_back(hub_env):
    # no responses mock active -> real connection error to http://hub:8081
    with pytest.warns(UserWarning, match="unreachable"):
        assert auth.current().source == "anonymous"


def test_env_token_used_outside_hub(monkeypatch):
    monkeypatch.setenv("JSTEX_ACCESS_TOKEN", "dev-token")
    info = auth.current()
    assert (info.token, info.source) == ("dev-token", "token")
    assert auth.headers() == {"Authorization": "Bearer dev-token"}


def test_anonymous_has_no_headers():
    assert auth.get_token() is None
    assert auth.headers() == {}


@responses.activate
def test_hub_non_json_answer_falls_back_to_anonymous(hub_env):
    responses.get(hub_env, body="<html>login</html>", content_type="text/html")
    with pytest.warns(UserWarning, match="not JSON"):
        assert auth.current().source == "anonymous"


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
    responses.get(
        CDSE + "/.well-known/openid-configuration",
        json={"issuer": CDSE, "token_endpoint": CDSE_TOKEN},
    )


@responses.activate
def test_manual_token_beats_the_hub(hub_env, monkeypatch):
    monkeypatch.setenv("JSTEX_ACCESS_TOKEN", "MANUAL")
    responses.get(
        hub_env, json={"auth_state": {"access_token": jwt_for(CDSE, time.time() + 600)}}
    )
    assert auth.current(load_config()).source == "token"
    assert len(responses.calls) == 0


@responses.activate
def test_hub_token_of_another_issuer_is_not_used(hub_env):
    responses.get(
        hub_env,
        json={
            "auth_state": {
                "access_token": jwt_for("https://other/realms/x", time.time() + 600)
            }
        },
    )
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
        json={
            "access_token": jwt_for(CDSE, time.time() + 300),
            "expires_in": 300,
            "refresh_token": "R2",
        },
        match=[
            responses.matchers.urlencoded_params_matcher(
                {
                    "grant_type": "refresh_token",
                    "refresh_token": "R1",
                    "client_id": "dev",
                }
            )
        ],
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
            store.put(
                CDSE, Session("dev", "R2", None, "device")
            )  # the other kernel won the race
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
        cfg,
        access_token=jwt_for(CDSE, time.time() + 300),
        expires_in=300,
        refresh_token="R",
        refresh_expires_in=1800,
        client_id="dev",
        method="device",
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
        rsps.get(
            hub_env,
            json={
                "auth_state": {
                    "access_token": jwt_for("https://any", time.time() + 600)
                }
            },
        )
        assert auth.current(load_config(profile="none")).source == "hub"
