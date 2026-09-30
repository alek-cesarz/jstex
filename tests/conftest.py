import pytest

from jstex import auth


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    for var in (
        "JUPYTERHUB_API_URL",
        "JUPYTERHUB_API_TOKEN",
        "JUPYTERHUB_USER",
        "JSTEX_ACCESS_TOKEN",
        "JSTEX_STAC_URL",
        "JSTEX_STEX_URL",
        *(
            f"JSTEX_BASEMAP_{t}_{k}"
            for t in ("LIGHT", "DARK")
            for k in ("URL", "KEY", "KEY_PARAM", "ATTRIBUTION")
        ),
    ):
        monkeypatch.delenv(var, raising=False)
    auth.reset_cache()
    yield
    auth.reset_cache()


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
