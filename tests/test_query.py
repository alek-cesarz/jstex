import json
import pathlib

import pytest

from jstex.errors import JstexQueryError
from jstex.query import (
    Aoi,
    QueryState,
    build_cql2,
    decode,
    encode,
    search_get_url,
    share_url,
    to_search_body,
)

GOLDEN = json.loads(
    (pathlib.Path(__file__).parent / "fixtures" / "stex_codec_golden.json").read_text()
)
POLY = {
    "type": "Polygon",
    "coordinates": [
        [[10.123457, 45.5], [11, 45.5], [11, 46.987654], [10.123457, 45.5]]
    ],
}


def test_decode_stex_full():
    s = decode(GOLDEN["full"])
    assert s.collections == ["sentinel-2-l2a"]
    assert s.datetime == {"from": "2024-07-01T00:00:00Z", "to": "2024-08-31T23:59:59Z"}
    assert [a.selected for a in s.aois] == [True, False]
    assert s.aois[0].geometry == POLY  # rounded to 6 dp by STEX
    assert s.filters == [{"field": "eo:cloud_cover", "op": "<=", "value": 10}]
    assert s.sort == {"field": "properties.datetime", "direction": "asc"}
    assert s.page_size == 20


@pytest.mark.parametrize("name", ["empty", "collections_only", "full", "unicode"])
def test_roundtrip_matches_stex_semantics(name):
    s = decode(GOLDEN[name])
    assert decode(encode(s)) == s


def test_encode_is_byte_identical_for_integer_coordinates():
    s = QueryState(collections=["zażółć-gęślą"])
    assert encode(s) == GOLDEN["unicode"]
    assert encode(QueryState()) == GOLDEN["empty"]


def test_encode_rounds_to_6dp():
    ring = [[1.23456789, -1.23456749], [2, 0], [0, 2], [1.23456789, -1.23456749]]
    s = QueryState(aois=[Aoi({"type": "Polygon", "coordinates": [ring]})])
    assert decode(encode(s)).aois[0].geometry["coordinates"][0][0] == [
        1.234568,
        -1.234567,
    ]


def test_decode_accepts_full_share_url_and_legacy_aoi():
    import base64

    legacy = (
        base64.urlsafe_b64encode(json.dumps({"aoi": POLY}).encode())
        .rstrip(b"=")
        .decode()
    )
    s = decode(f"https://stex.example.org/?q={legacy}&x=1")
    assert s.aois == [Aoi(POLY, True)]


@pytest.mark.parametrize(
    "bad",
    [
        "",
        "%%%",
        "bm90LWpzb24",
        "eyJwYWdlU2l6ZSI6MH0",
        "eyJhb2lzIjpbeyJnIjp7InR5cGUiOiJQb2ludCJ9fV19",
    ],
)
def test_decode_rejects_invalid(bad):
    # "not-json", {"pageSize":0}, {"aois":[{"g":{"type":"Point"}}]}
    with pytest.raises(JstexQueryError, match="Invalid query URL"):
        decode(bad)


def test_dict_roundtrip():
    s = decode(GOLDEN["full"])
    assert QueryState.from_dict(s.to_dict()) == s
    assert s.to_dict()["pageSize"] == 20


def test_cql2_single_and_multiple():
    assert build_cql2([]) is None
    one = {"field": "eo:cloud_cover", "op": "<=", "value": 10}
    assert build_cql2([one]) == {
        "op": "<=",
        "args": [{"property": "eo:cloud_cover"}, 10],
    }
    two = build_cql2([one, {"field": "platform", "op": "=", "value": "sentinel-2a"}])
    assert two["op"] == "and" and len(two["args"]) == 2


def test_cql2_maps_ui_operators_to_standard_names():
    # CDSE rejects "!=" and "IN" (HTTP 400); "<>" and "in" are the CQL2-JSON names.
    assert build_cql2([{"field": "platform", "op": "!=", "value": "s2a"}])["op"] == "<>"
    got = build_cql2([{"field": "platform", "op": "IN", "value": ["s2a", "s2b"]}])
    assert got == {"op": "in", "args": [{"property": "platform"}, ["s2a", "s2b"]]}
    with pytest.raises(JstexQueryError, match="IN needs a list"):
        build_cql2([{"field": "platform", "op": "IN", "value": "s2a"}])


def test_search_body_repairs_self_crossing_aoi():
    bowtie = {
        "type": "Polygon",
        "coordinates": [[[0, 0], [2, 2], [2, 0], [0, 2], [0, 0]]],
    }
    geom = to_search_body(QueryState(collections=["c1"], aois=[Aoi(bowtie)]))[
        "intersects"
    ]
    assert geom["type"] == "MultiPolygon"


def test_search_body_minimal():
    assert to_search_body(QueryState(collections=["c1"])) == {
        "collections": ["c1"],
        "limit": 50,
    }


def test_search_body_datetime_open_ends_are_closed_with_far_bounds():
    assert "datetime" not in to_search_body(QueryState(collections=["c1"]))
    since = QueryState(collections=["c1"], datetime={"from": "2024-01-01T00:00:00Z"})
    assert (
        to_search_body(since)["datetime"] == "2024-01-01T00:00:00Z/2099-12-31T23:59:59Z"
    )
    until = QueryState(collections=["c1"], datetime={"to": "2024-01-31T23:59:59Z"})
    assert (
        to_search_body(until)["datetime"] == "1900-01-01T00:00:00Z/2024-01-31T23:59:59Z"
    )
    full = QueryState(
        collections=["c1"],
        datetime={"from": "2024-01-01T00:00:00Z", "to": "2024-01-31T23:59:59Z"},
    )
    assert (
        to_search_body(full)["datetime"] == "2024-01-01T00:00:00Z/2024-01-31T23:59:59Z"
    )


def test_search_body_intersects_uses_selected_aois_only():
    s = QueryState(collections=["c1"], aois=[Aoi(POLY, True), Aoi({**POLY}, False)])
    assert to_search_body(s)["intersects"] == POLY
    assert "intersects" not in to_search_body(
        QueryState(collections=["c1"], aois=[Aoi(POLY, False)])
    )


def test_search_body_overlapping_aois_are_unioned():
    a = {"type": "Polygon", "coordinates": [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]]}
    b = {"type": "Polygon", "coordinates": [[[1, 1], [3, 1], [3, 3], [1, 3], [1, 1]]]}
    geom = to_search_body(QueryState(collections=["c1"], aois=[Aoi(a), Aoi(b)]))[
        "intersects"
    ]
    assert geom["type"] == "Polygon"  # one merged polygon, no overlapping parts


def test_search_body_filter():
    s = QueryState(
        collections=["c1"],
        filters=[{"field": "eo:cloud_cover", "op": "<=", "value": 10}],
    )
    body = to_search_body(s)
    assert body["filter-lang"] == "cql2-json"
    assert body["filter"]["op"] == "<="


def test_search_body_requires_collection():
    with pytest.raises(JstexQueryError, match="collection"):
        to_search_body(QueryState())


def test_share_url():
    s = QueryState(collections=["c1"])
    assert (
        share_url(s, "https://stex.example.org/")
        == f"https://stex.example.org/?q={encode(s)}"
    )
    assert share_url(s, None) == encode(s)


def _get_params(url: str) -> dict[str, str]:
    from urllib.parse import parse_qsl, urlsplit

    return dict(parse_qsl(urlsplit(url).query))


def test_search_get_url_mirrors_the_post_body():
    s = QueryState(
        collections=["c1", "c2"],
        datetime={"from": "2024-07-01T00:00:00Z"},
        aois=[Aoi(POLY)],
        filters=[{"field": "eo:cloud_cover", "op": "<=", "value": 20}],
    )
    url = search_get_url(s, "https://stac.test/v1/")
    assert url.startswith("https://stac.test/v1/search?")
    body = to_search_body(s)
    p = _get_params(url)
    assert p["collections"] == "c1,c2"
    assert p["limit"] == "50"
    assert p["datetime"] == body["datetime"]  # open end closed, as in POST
    assert json.loads(p["intersects"]) == body["intersects"]
    assert json.loads(p["filter"]) == body["filter"]
    assert p["filter-lang"] == "cql2-json"
    assert "bbox" not in p


def test_search_get_url_minimal_query_has_only_collections_and_limit():
    url = search_get_url(QueryState(collections=["c1"]), "https://stac.test/v1/")
    assert _get_params(url) == {"collections": "c1", "limit": "50"}


def test_search_get_url_rounds_coordinates_to_6_decimals():
    poly = {
        "type": "Polygon",
        "coordinates": [
            [
                [10.1234567891, 45.5],
                [11, 45.5],
                [11, 46.9876543219],
                [10.1234567891, 45.5],
            ]
        ],
    }
    url = search_get_url(QueryState(collections=["c1"], aois=[Aoi(poly)]), "https://s/")
    ring = json.loads(_get_params(url)["intersects"])["coordinates"][0]
    assert ring[0] == [10.123457, 45.5] and ring[2] == [11, 46.987654]


def test_search_get_url_falls_back_to_bbox_when_too_long():
    import math

    n = 300
    ring = [
        [
            10.5 + 0.4 * math.cos(2 * math.pi * i / n),
            45.5 + 0.4 * math.sin(2 * math.pi * i / n),
        ]
        for i in range(n)
    ]
    ring.append(ring[0])
    s = QueryState(
        collections=["c1"], aois=[Aoi({"type": "Polygon", "coordinates": [ring]})]
    )
    with pytest.warns(UserWarning, match="bbox"):
        url = search_get_url(s, "https://stac.test/v1/")
    assert len(url) <= 2000
    p = _get_params(url)
    assert "intersects" not in p
    assert [float(v) for v in p["bbox"].split(",")] == [10.1, 45.1, 10.9, 45.9]


def test_search_get_url_requires_collection():
    with pytest.raises(JstexQueryError, match="collection"):
        search_get_url(QueryState(), "https://stac.test/v1/")


def test_decode_rejects_json_that_is_not_an_object():
    with pytest.raises(JstexQueryError, match="Invalid query URL"):
        decode("W10")  # base64url of "[]"
