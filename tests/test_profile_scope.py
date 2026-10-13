"""Which profile a call uses: the explorer's own, the kernel default
(jstex.use_profile), or the configured default — and whoami() pointing to the
other profiles in use."""

import pytest
import responses
from responses import matchers

import jstex
from jstex import s3
from jstex.profiles import JstexProfileError
from jstex.widget import Explorer, sync_runner
from tests.test_s3 import FakeManager
from tests.test_widget import FakeBackend


def explorer(**kw):
    return Explorer(backend=FakeBackend(), runner=sync_runner, **kw)


def test_use_profile_sets_the_kernel_default():
    assert jstex.whoami()["profile"] == "cdse-opensearch"
    jstex.use_profile("creodias")
    assert jstex.whoami()["profile"] == "creodias"
    assert jstex.show_config().config.profile == "creodias"
    assert explorer().profile_name == "creodias"
    jstex.use_profile(None)
    assert jstex.whoami()["profile"] == "cdse-opensearch"


def test_use_profile_beats_the_env_and_rejects_unknown_names(monkeypatch):
    monkeypatch.setenv("JSTEX_PROFILE", "codede")
    jstex.use_profile("creodias")
    assert jstex.whoami()["profile"] == "creodias"
    with pytest.raises(JstexProfileError):
        jstex.use_profile("no-such-profile")
    assert jstex.whoami()["profile"] == "creodias"  # unchanged


def test_explorer_sign_in_methods_use_its_profile(monkeypatch):
    ex = explorer(profile="creodias")
    sent = []
    monkeypatch.setattr(ex, "send", sent.append)
    assert ex.whoami()["profile"] == "creodias"
    assert ex.login(token="TOK").startswith("Signed in (token)")
    assert ex.access_token() == "TOK"
    assert jstex.access_token() is None  # the default (CDSE) profile is not signed in
    assert ex.auth_source == "token"
    assert {"type": "login", "state": "done"} in sent  # the panel follows
    assert ex.logout() == "Signed out."
    assert ex.access_token() is None and ex.auth_source == "anonymous"


@responses.activate
def test_explorer_item_uses_its_own_catalogue_and_token():
    ex = explorer(profile="none", stac_url="https://stac.test/v1/")
    ex.login(token="T")
    href = "https://stac.test/v1/collections/c1/items/a"
    responses.get(
        href,
        json={
            "type": "Feature",
            "stac_version": "1.0.0",
            "id": "a",
            "geometry": None,
            "properties": {"datetime": "2024-07-01T10:00:00Z"},
            "links": [],
            "assets": {},
        },
        match=[matchers.header_matcher({"Authorization": "Bearer T"})],
    )
    assert ex.item(href).id == "a"


def test_explorer_s3_uses_the_explorers_config(monkeypatch):
    seen = []
    m = FakeManager()
    monkeypatch.setattr(s3, "manager", lambda cfg: seen.append(cfg.profile) or m)
    ex = explorer(profile="cdse")
    assert ex.s3.gdal_env()["AWS_ACCESS_KEY_ID"] == "AK"
    assert ex.s3.storage_options()["key"] == "AK"
    assert ex.s3.location("s3://eodata/a/b.jp2") == {
        "Bucket": "eodata",
        "Key": "a/b.jp2",
    }
    assert seen == ["cdse", "cdse"]
    assert "cdse" in repr(ex.s3)


def test_whoami_points_to_other_profiles_in_use():
    ex = explorer(profile="creodias")
    who = jstex.whoami()
    assert who["profile"] == "cdse-opensearch"
    assert who["other_profiles"] == ["creodias"]
    assert "Also in use: creodias" in repr(who)
    assert "jstex.whoami('creodias')" in repr(who)
    assert ex.whoami()["other_profiles"] == []  # an explorer reports on itself
    jstex.use_profile("creodias")
    assert jstex.whoami()["other_profiles"] == []
    jstex.use_profile(None)
    ex.close()
    assert jstex.whoami()["other_profiles"] == []  # closed explorers do not count
