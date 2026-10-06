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


from jstex.profiles import JstexProfileError, flatten, resolve

DISCOVERY = "https://discover.dataspace.copernicus.eu/.well-known/eo-services.json"
CDSE_DOC = {
    "version": "1.0",
    "platform": {"name": "cdse"},
    "services": {
        "catalogue": {"stac": {"url": "https://stac.dataspace.copernicus.eu/v1"}},
        "data_access": {
            "s3": {
                "endpoint": "https://eodata.example.eu",
                "credentials": {"url": "https://keys.example.eu/api/user"},
            }
        },
        "auth": {
            "issuer": "https://identity.dataspace.copernicus.eu/auth/realms/CDSE",
            "client_id": "cdse-public",
            "device_client_id": "dev-client",
        },
    },
}


def test_flatten_maps_dotted_paths_and_skips_pinned():
    doc = {
        "services": {
            "catalogue": {"stac": {"url": "https://a"}},
            "auth": {"issuer": "https://i"},
        }
    }
    paths = {
        "stac_url": "services.catalogue.stac.url",
        "issuer": "services.auth.issuer",
    }
    assert flatten(doc, paths) == {"stac_url": "https://a", "issuer": "https://i"}
    assert flatten(doc, paths, skip=["services.catalogue.stac.url"]) == {
        "issuer": "https://i"
    }


def test_offline_resolution_uses_the_github_profile_only():
    p = resolve("cdse-opensearch")
    assert p.values["stac_url"] == "https://stac.opensearch.dataspace.copernicus.eu/v1"
    assert p.values["password_client_id"] == "cdse-public"
    assert p.sources["stac_url"] == "packaged" and p.discovery is None


@responses.activate
def test_discovery_overrides_profile_except_pinned(monkeypatch):
    monkeypatch.setenv("JSTEX_PROFILES_URL", REGISTRY_URL)
    responses.get(REGISTRY_URL, status=503)  # packaged registry
    responses.get(DISCOVERY, json=CDSE_DOC)
    pinned = resolve("cdse-opensearch")
    assert (
        pinned.values["stac_url"]
        == "https://stac.opensearch.dataspace.copernicus.eu/v1"
    )
    assert pinned.values["s3_endpoint"] == "https://eodata.example.eu"
    assert pinned.sources["s3_endpoint"] == "discovery"
    assert pinned.values["login_client_id"] == "dev-client"  # device_client_id
    assert pinned.values["password_client_id"] == "cdse-public"
    free = resolve("cdse")
    assert free.values["stac_url"] == "https://stac.dataspace.copernicus.eu/v1"
    # Same discovery root as above: served from the fresh disk cache this time.
    assert free.sources["stac_url"] == "discovery-cache"


@responses.activate
def test_discovery_client_id_never_becomes_the_device_client(monkeypatch):
    monkeypatch.setenv("JSTEX_PROFILES_URL", REGISTRY_URL)
    responses.get(REGISTRY_URL, status=503)
    doc = json.loads(json.dumps(CDSE_DOC))
    del doc["services"]["auth"]["device_client_id"]
    responses.get(DISCOVERY, json=doc)
    assert "login_client_id" not in resolve("cdse").values


@responses.activate
def test_html_discovery_is_ignored_and_stale_cache_used(monkeypatch):
    monkeypatch.setenv("JSTEX_PROFILES_URL", REGISTRY_URL)
    responses.get(REGISTRY_URL, status=503)
    responses.get(DISCOVERY, json=CDSE_DOC)
    resolve("cdse")
    cached = next((profiles.cache_dir() / "discovery").glob("*.json"))
    data = json.loads(cached.read_text())
    data["fetched_at"] = 0
    cached.write_text(json.dumps(data))
    responses.replace(responses.GET, DISCOVERY, body="<html>login</html>", status=200)
    profiles.reset()
    p = resolve("cdse")
    assert p.values["s3_endpoint"] == "https://eodata.example.eu"
    assert p.sources["s3_endpoint"] == "discovery-cache"


@responses.activate
def test_http_urls_in_discovery_are_rejected(monkeypatch):
    monkeypatch.setenv("JSTEX_PROFILES_URL", REGISTRY_URL)
    responses.get(REGISTRY_URL, status=503)
    doc = json.loads(json.dumps(CDSE_DOC))
    doc["services"]["catalogue"]["stac"]["url"] = "http://evil.example/v1"
    responses.get(DISCOVERY, json=doc)
    with pytest.warns(UserWarning, match="discovery"):
        p = resolve("cdse")
    assert p.values["stac_url"] == "https://stac.dataspace.copernicus.eu/v1"


def test_unknown_profile_lists_the_available_ones():
    with pytest.raises(JstexProfileError, match="cdse-opensearch"):
        resolve("nope")
