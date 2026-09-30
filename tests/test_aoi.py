import json

import pytest

from jstex.aoi import JstexAoiError, parse_aoi_upload, repair

SQUARE = [[[10, 45], [11, 45], [11, 46], [10, 46], [10, 45]]]
OTHER = [[[20, 50], [21, 50], [21, 51], [20, 51], [20, 50]]]


def fc(*geoms, crs=None):
    doc = {
        "type": "FeatureCollection",
        "features": [
            {"type": "Feature", "properties": {}, "geometry": g} for g in geoms
        ],
    }
    if crs:
        doc["crs"] = {"type": "name", "properties": {"name": crs}}
    return json.dumps(doc)


def test_feature_collection_with_one_polygon():
    assert parse_aoi_upload(fc({"type": "Polygon", "coordinates": SQUARE})) == {
        "type": "Polygon",
        "coordinates": SQUARE,
    }


def test_two_polygons_become_one_multipolygon_without_union():
    geom = parse_aoi_upload(
        fc(
            {"type": "Polygon", "coordinates": SQUARE},
            {"type": "Polygon", "coordinates": OTHER},
        )
    )
    assert geom == {"type": "MultiPolygon", "coordinates": [SQUARE, OTHER]}


def test_feature_and_bare_geometry_accepted_and_points_ignored():
    feat = json.dumps(
        {"type": "Feature", "geometry": {"type": "Polygon", "coordinates": SQUARE}}
    )
    assert parse_aoi_upload(feat)["type"] == "Polygon"
    mixed = fc(
        {"type": "Point", "coordinates": [1, 2]},
        {"type": "Polygon", "coordinates": SQUARE},
    )
    assert parse_aoi_upload(mixed)["type"] == "Polygon"


def test_only_points_and_lines_rejected():
    with pytest.raises(JstexAoiError, match="No polygon geometry found"):
        parse_aoi_upload(
            fc(
                {"type": "Point", "coordinates": [1, 2]},
                {"type": "LineString", "coordinates": [[0, 0], [1, 1]]},
            )
        )


@pytest.mark.parametrize("crs", ["urn:ogc:def:crs:EPSG::3857", "EPSG:32633"])
def test_non_wgs84_crs_rejected(crs):
    with pytest.raises(
        JstexAoiError, match=r"Only EPSG:4326 \(WGS84 lon/lat\) supported\."
    ):
        parse_aoi_upload(fc({"type": "Polygon", "coordinates": SQUARE}, crs=crs))


@pytest.mark.parametrize("crs", ["urn:ogc:def:crs:OGC:1.3:CRS84", "EPSG:4326"])
def test_wgs84_crs_accepted(crs):
    assert (
        parse_aoi_upload(fc({"type": "Polygon", "coordinates": SQUARE}, crs=crs))[
            "type"
        ]
        == "Polygon"
    )


@pytest.mark.parametrize(
    "coords",
    [
        [[[10, 45], [11, 45], [10, 45]]],
        [[["a", 45], [11, 45], [11, 46], ["a", 45]]],
        [[[500, 45], [11, 45], [11, 46], [500, 45]]],
    ],
)
def test_bad_coordinates_rejected(coords):
    with pytest.raises(JstexAoiError, match="Invalid coordinates"):
        parse_aoi_upload(fc({"type": "Polygon", "coordinates": coords}))


def test_not_json_rejected():
    with pytest.raises(JstexAoiError, match="not valid GeoJSON"):
        parse_aoi_upload("{nope")


def test_repair_keeps_valid_geometry_and_fixes_bowtie():
    square = {"type": "Polygon", "coordinates": SQUARE}
    assert repair(square) is square
    bowtie = {
        "type": "Polygon",
        "coordinates": [[[0, 0], [2, 2], [2, 0], [0, 2], [0, 0]]],
    }
    fixed = repair(bowtie)
    assert fixed["type"] == "MultiPolygon" and len(fixed["coordinates"]) == 2


def test_unclosed_ring_rejected():
    # CDSE rejects the search for an unclosed ring (verified); refuse it at upload time.
    open_ring = [[[10, 45], [11, 45], [11, 46], [10, 46]]]
    with pytest.raises(JstexAoiError, match="Invalid coordinates"):
        parse_aoi_upload(fc({"type": "Polygon", "coordinates": open_ring}))
