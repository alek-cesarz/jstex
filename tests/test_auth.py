import time

import pytest
import responses

from jstex import auth
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
    assert (info.token, info.source) == ("dev-token", "env")
    assert auth.headers() == {"Authorization": "Bearer dev-token"}


def test_anonymous_has_no_headers():
    assert auth.get_token() is None
    assert auth.headers() == {}
