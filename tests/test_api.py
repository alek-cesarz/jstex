import pytest
import responses
from responses import matchers

import jstex


@responses.activate
def test_item_opens_with_bearer_token(monkeypatch):
    # The token goes only to the configured catalogue (see test_stac foreign-host test).
    monkeypatch.setenv("JSTEX_STAC_URL", "https://stac.test/v1/")
    monkeypatch.setenv("JSTEX_ACCESS_TOKEN", "T")
    href = "https://stac.test/v1/collections/c1/items/a"
    responses.get(
        href,
        json={
            "type": "Feature",
            "stac_version": "1.0.0",
            "id": "a",
            "geometry": None,
            "properties": {
                "datetime": None,
                "start_datetime": "2024-01-01T00:00:00Z",
                "end_datetime": "2024-12-31T23:59:59Z",
            },
            "links": [],
            "assets": {},
        },
        match=[matchers.header_matcher({"Authorization": "Bearer T"})],
    )
    it = jstex.item(href)
    assert it.id == "a" and it.get_self_href() == href


def test_import_is_light():
    # The Jupyter server imports jstex via the jupyterlab.locale entry point to
    # find translations; that must not pull in the widget stack.
    import subprocess
    import sys

    code = "import jstex, sys; print(any(m in sys.modules for m in ('jstex.widget', 'anywidget', 'pystac_client')))"
    out = subprocess.run(
        [sys.executable, "-c", code], capture_output=True, text=True, check=True
    )
    assert out.stdout.strip() == "False"


def test_public_config_helpers():
    import jstex

    assert jstex.show_config().config.profile == "cdse-opensearch"
    names = {p["name"] for p in jstex.list_profiles()}
    assert {"cdse-opensearch", "cdse", "creodias", "codede"} <= names


@responses.activate
def test_item_uses_the_profile_stac_host_for_the_token(monkeypatch):
    import jstex

    monkeypatch.setenv("JSTEX_ACCESS_TOKEN", "T")
    href = "https://stac.code-de.org/v1/collections/c/items/a"
    responses.get(
        href,
        json={
            "type": "Feature",
            "stac_version": "1.0.0",
            "id": "a",
            "geometry": None,
            "properties": {"datetime": "2024-01-01T00:00:00Z"},
            "links": [],
            "assets": {},
        },
    )
    jstex.item(href, profile="codede")
    assert responses.calls[0].request.headers["Authorization"] == "Bearer T"


@pytest.fixture
def utc(monkeypatch):
    import time as _time

    monkeypatch.setenv("TZ", "UTC")
    _time.tzset()
    yield
    monkeypatch.undo()
    _time.tzset()


def test_whoami_shows_a_readable_expiry_and_list(utc, monkeypatch):
    import datetime as dt

    from jstex import auth

    exp = dt.datetime(2026, 10, 7, 14, 0, tzinfo=dt.timezone.utc).timestamp()
    monkeypatch.setattr(
        auth,
        "current",
        lambda cfg=None, force_refresh=False: auth.TokenInfo(
            "T", "session", exp, "alice"
        ),
    )
    monkeypatch.setattr("time.time", lambda: exp - 52 * 60)
    who = jstex.whoami()
    assert dict(who) == {
        "profile": "cdse-opensearch",
        "source": "session",
        "user": "alice",
        "expires_at": "2026-10-07 14:00:00 UTC",
    }
    assert repr(who) == (
        "Profile:    cdse-opensearch\n"
        "Signed in:  session\n"
        "User:       alice\n"
        "Expires:    2026-10-07 14:00:00 UTC (in 52 min)"
    )
    html = who._repr_html_()
    assert "<table" in html and "2026-10-07 14:00:00 UTC (in 52 min)" in html


def test_whoami_when_not_signed_in(utc):
    who = jstex.whoami()
    assert who["source"] == "anonymous" and who["expires_at"] is None
    assert repr(who) == "Profile:    cdse-opensearch\nSigned in:  no"
