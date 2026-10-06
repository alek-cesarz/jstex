import json
import time

import pytest
import responses

from jstex import profiles
from jstex.profiles import (
    PACKAGED_REGISTRY,
    REGISTRY_URL,
    load_registry,
    valid_profiles,
)


def test_packaged_registry_matches_schema():
    import jsonschema

    schema = json.loads((PACKAGED_REGISTRY.parent / "profiles.schema.json").read_text())
    jsonschema.validate(json.loads(PACKAGED_REGISTRY.read_text()), schema)


def test_ready_made_profiles_are_packaged():
    reg = load_registry()
    assert reg.source == "packaged"
    assert {"cdse-opensearch", "cdse", "creodias", "codede"} <= set(reg.profiles)
    cdse_os = reg.profiles["cdse-opensearch"]
    assert cdse_os["services"]["catalogue"]["stac"]["url"] == (
        "https://stac.opensearch.dataspace.copernicus.eu/v1"
    )
    assert "services.catalogue.stac.url" in cdse_os["pinned"]


def test_non_https_profile_is_dropped_with_a_warning():
    doc = {
        "version": "1.0",
        "profiles": {
            "ok": {"services": {"catalogue": {"stac": {"url": "https://s/v1"}}}},
            "bad": {"services": {"catalogue": {"stac": {"url": "http://s/v1"}}}},
        },
    }
    with pytest.warns(UserWarning, match="bad"):
        assert set(valid_profiles(doc, "test")) == {"ok"}


@responses.activate
def test_network_registry_is_fetched_and_cached(monkeypatch):
    monkeypatch.setenv("JSTEX_PROFILES_URL", REGISTRY_URL)
    doc = {"version": "1.0", "profiles": {"x": {"services": {}}}}
    responses.get(REGISTRY_URL, json=doc)
    assert load_registry().source == "github"
    profiles.reset()
    assert load_registry().source == "cache"  # fresh cache: no second request
    assert len(responses.calls) == 1


@responses.activate
def test_stale_cache_is_used_when_the_network_fails(monkeypatch):
    monkeypatch.setenv("JSTEX_PROFILES_URL", REGISTRY_URL)
    responses.get(REGISTRY_URL, json={"version": "1.0", "profiles": {"x": {}}})
    load_registry()
    cache = profiles.cache_dir() / "profiles.json"
    data = json.loads(cache.read_text())
    data["fetched_at"] = time.time() - 2 * 86400
    cache.write_text(json.dumps(data))
    responses.replace(
        responses.GET, REGISTRY_URL, body="<html>proxy</html>", status=200
    )
    profiles.reset()
    reg = load_registry()
    assert reg.source == "cache" and "x" in reg.profiles


@responses.activate
def test_packaged_copy_when_nothing_else_works(monkeypatch):
    monkeypatch.setenv("JSTEX_PROFILES_URL", REGISTRY_URL)
    responses.get(REGISTRY_URL, status=503)
    reg = load_registry()
    assert reg.source == "packaged" and "cdse-opensearch" in reg.profiles
