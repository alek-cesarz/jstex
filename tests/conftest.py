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
    from jstex import config, oidc, profiles

    config._warned.clear()
    profiles.reset()
    oidc.reset()
    auth.reset_cache()
    auth._store = None  # bind the session store to this test's XDG_DATA_HOME
    yield
    profiles.reset()
    oidc.reset()
    auth.reset_cache()
    auth._store = None


def make_jwt(exp: float) -> str:
    import base64
    import json

    def seg(obj):
        return base64.urlsafe_b64encode(json.dumps(obj).encode()).rstrip(b"=").decode()

    return f"{seg({'alg': 'none'})}.{seg({'exp': exp, 'sub': 'u1'})}.sig"


@pytest.fixture
def hub_env(monkeypatch):
    monkeypatch.setenv("JUPYTERHUB_API_URL", "http://hub:8081/hub/api")
    monkeypatch.setenv("JUPYTERHUB_API_TOKEN", "server-token")
    monkeypatch.setenv("JUPYTERHUB_USER", "alice@example.org")
    return "http://hub:8081/hub/api/users/alice%40example.org"
