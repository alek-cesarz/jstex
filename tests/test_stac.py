import json
import time

import pytest
import responses
from responses import matchers
from responses.registries import OrderedRegistry
from urllib3.util.retry import Retry

from jstex.errors import JstexStacError
from jstex.query import QueryState
from jstex.stac import StacBackend
from tests.conftest import make_jwt

URL = "https://stac.test/v1/"
NO_WAIT = Retry(
    total=2,
    backoff_factor=0,
    status_forcelist=(429,),
    allowed_methods=None,
    raise_on_status=False,
)


def item(i: str) -> dict:
    return {
        "type": "Feature",
        "stac_version": "1.0.0",
        "id": i,
        "geometry": None,
        "properties": {"datetime": "2024-07-01T10:00:00Z"},
        "links": [{"rel": "self", "href": f"{URL}collections/c1/items/{i}"}],
        "assets": {},
    }


@responses.activate
def test_collections_follow_next_and_depend_on_token(monkeypatch):
    monkeypatch.setenv("JSTEX_ACCESS_TOKEN", "T")
    responses.get(
        URL + "collections",
        json={
            "collections": [{"id": "open", "title": "Open"}],
            "links": [{"rel": "next", "href": URL + "collections?page=2"}],
        },
        match=[matchers.query_param_matcher({})],
    )
    responses.get(
        URL + "collections",
        json={
            "collections": [{"id": "restricted", "title": "Alpha restricted"}],
            "links": [],
        },
        match=[
            matchers.query_param_matcher({"page": "2"}),
            matchers.header_matcher({"Authorization": "Bearer T"}),
        ],
    )
    assert [c["id"] for c in StacBackend(URL).list_collections()] == [
        "restricted",
        "open",
    ]


@responses.activate
def test_collections_carry_info_for_the_picker():
    responses.get(
        URL + "collections",
        json={
            "collections": [
                {
                    "id": "s2",
                    "title": "Sentinel-2",
                    "description": "Surface reflectance",
                    "license": "other",
                    "extent": {
                        "temporal": {"interval": [["2015-06-27T10:25:31Z", None]]}
                    },
                },
                {"id": "bare"},
            ],
            "links": [],
        },
    )
    got = {c["id"]: c for c in StacBackend(URL).list_collections()}
    assert got["s2"] == {
        "id": "s2",
        "title": "Sentinel-2",
        "description": "Surface reflectance",
        "license": "other",
        "start": "2015-06-27T10:25:31Z",
        "end": None,
    }
    assert got["bare"] == {
        "id": "bare",
        "title": "bare",
        "description": "",
        "license": "",
        "start": None,
        "end": None,
    }


@responses.activate
def test_merged_queryables_is_an_intersection():
    responses.get(
        URL + "collections/a/queryables",
        json={
            "properties": {
                "eo:cloud_cover": {
                    "title": "Cloud",
                    "type": "number",
                    "minimum": 0,
                    "maximum": 100,
                },
                "platform": {"type": "string", "enum": ["s2a", "s2b"]},
                "orbit": {"type": "integer"},
                "only_a": {"type": "string"},
                "datetime": {"type": "string"},
                "geometry": {"type": "object"},
            }
        },
    )
    responses.get(
        URL + "collections/b/queryables",
        json={
            "properties": {
                "eo:cloud_cover": {"type": "number"},
                "platform": {"type": "string", "enum": ["s2c"]},
                "orbit": {"type": "string"},
            }
        },
    )
    b = StacBackend(URL)
    assert b.merged_queryables([]) == []
    assert [f["name"] for f in b.merged_queryables(["a"])] == [
        "eo:cloud_cover",
        "only_a",
        "orbit",
        "platform",
    ]
    both = b.merged_queryables(["a", "b"])
    assert both == [
        {
            "name": "eo:cloud_cover",
            "title": "Cloud",
            "type": "number",
            "minimum": 0,
            "maximum": 100,
        },
        {"name": "platform", "title": "platform", "type": "string"},
    ]


@responses.activate
def test_search_page_posts_body_and_returns_next_link():
    nxt = {
        "rel": "next",
        "href": URL + "search",
        "method": "POST",
        "body": {"token": "abc"},
        "merge": True,
    }
    responses.post(
        URL + "search",
        json={"features": [item("a")], "links": [nxt], "numberMatched": 7},
    )
    page = StacBackend(URL).search_page(QueryState(collections=["c1"], page_size=1))
    assert [i["id"] for i in page.items] == ["a"]
    assert page.next_link == nxt and page.matched == 7
    assert json.loads(responses.calls[0].request.body) == {
        "collections": ["c1"],
        "limit": 1,
    }


@responses.activate
def test_next_page_follows_link_exactly_with_merge():
    nxt = {
        "rel": "next",
        "href": URL + "search?x=1",
        "method": "POST",
        "body": {"token": "abc"},
        "merge": True,
    }
    responses.post(URL + "search?x=1", json={"features": [item("b")], "links": []})
    page = StacBackend(URL).next_page(nxt, {"collections": ["c1"], "limit": 1})
    assert responses.calls[0].request.url == URL + "search?x=1"
    assert json.loads(responses.calls[0].request.body) == {
        "collections": ["c1"],
        "limit": 1,
        "token": "abc",
    }
    assert page.next_link is None


@responses.activate
def test_get_next_link_uses_href_verbatim():
    nxt = {"rel": "next", "href": URL + "search?token=abc&collections=c1"}
    responses.get(URL + "search", json={"features": [], "links": []})
    StacBackend(URL).next_page(nxt, {"collections": ["c1"]})
    assert responses.calls[0].request.url == URL + "search?token=abc&collections=c1"


@responses.activate
def test_401_refreshes_token_once_and_retries(hub_env):
    responses.get(
        hub_env, json={"auth_state": {"access_token": make_jwt(time.time() + 600)}}
    )
    responses.post(URL + "search", status=401, json={"detail": "expired"})
    responses.post(URL + "search", json={"features": [], "links": []})
    StacBackend(URL).search_page(QueryState(collections=["c1"]))
    hub_calls = [c for c in responses.calls if c.request.url == hub_env]
    assert len(hub_calls) == 2  # initial + force_refresh


@responses.activate
def test_persistent_403_raises_typed_error():
    responses.post(URL + "search", status=403, json={"detail": "no"})
    with pytest.raises(JstexStacError) as exc:
        StacBackend(URL).search_page(QueryState(collections=["c1"]))
    assert exc.value.status == 403 and "Not authorised" in str(exc.value)


@responses.activate(registry=OrderedRegistry)
def test_429_is_retried():
    responses.post(URL + "search", status=429, json={})
    responses.post(URL + "search", json={"features": [item("a")], "links": []})
    page = StacBackend(URL, retry=NO_WAIT).search_page(QueryState(collections=["c1"]))
    assert [i["id"] for i in page.items] == ["a"]


@responses.activate
def test_429_exhausted_raises_rate_limited():
    responses.post(URL + "search", status=429, json={})
    with pytest.raises(JstexStacError, match="Rate limited"):
        StacBackend(URL, retry=NO_WAIT).search_page(QueryState(collections=["c1"]))


@responses.activate
def test_queryables_cached_per_collection():
    responses.get(
        URL + "collections/c1/queryables",
        json={"properties": {"eo:cloud_cover": {"type": "number"}}},
    )
    b = StacBackend(URL)
    b.queryables("c1")
    b.queryables("c1")
    assert len(responses.calls) == 1


@responses.activate
def test_read_item_sets_self_href_when_missing():
    d = item("a")
    d["links"] = []
    responses.get(URL + "collections/c1/items/a", json=d)
    it = StacBackend(URL).read_item(URL + "collections/c1/items/a")
    assert it.id == "a" and it.get_self_href() == URL + "collections/c1/items/a"
