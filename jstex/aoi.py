"""Single area of interest: GeoJSON upload validation and geometry repair.

Upload rules (spec §4 Workflow B2): accept a Feature, a FeatureCollection or
a bare Polygon/MultiPolygon; only polygonal geometries count; several polygons
are collected into ONE MultiPolygon without a geometric union; a declared CRS
other than EPSG:4326/CRS84 is rejected; absent CRS means EPSG:4326. Errors
never change the current AOI (the caller only replaces it on success).
"""

from __future__ import annotations

import json
from typing import Any

from shapely import make_valid
from shapely.geometry import GeometryCollection, MultiPolygon, Polygon, mapping, shape

from .errors import JstexError

MAX_UPLOAD_BYTES = 5_000_000


class JstexAoiError(JstexError):
    """An uploaded or drawn area of interest cannot be used."""


def _crs_ok(doc: dict) -> bool:
    crs = doc.get("crs")
    if not crs:
        return True
    name = (
        str((crs.get("properties") or {}).get("name", ""))
        if isinstance(crs, dict)
        else ""
    )
    return "4326" in name or "CRS84" in name.upper()


def _polygons(doc: Any) -> list[list]:
    """Polygon coordinate arrays found in a GeoJSON document."""
    if not isinstance(doc, dict):
        return []
    kind = doc.get("type")
    if kind == "FeatureCollection":
        return [p for f in doc.get("features") or [] for p in _polygons(f)]
    if kind == "Feature":
        return _polygons(doc.get("geometry"))
    if kind == "Polygon":
        return [doc.get("coordinates")]
    if kind == "MultiPolygon":
        return list(doc.get("coordinates") or [])
    if kind == "GeometryCollection":
        return [p for g in doc.get("geometries") or [] for p in _polygons(g)]
    return []


def _valid_polygon(coords: Any) -> bool:
    if not isinstance(coords, list) or not coords:
        return False
    for ring in coords:
        if not isinstance(ring, list) or len(ring) < 4:
            return False
        for pos in ring:
            if not (
                isinstance(pos, list)
                and len(pos) >= 2
                and all(isinstance(v, (int, float)) for v in pos[:2])
            ):
                return False
            lon, lat = pos[0], pos[1]
            if not (-180 <= lon <= 180 and -90 <= lat <= 90):
                return False
    return True


def parse_aoi_upload(text: str) -> dict:
    """Validate an uploaded GeoJSON file and return one Polygon or MultiPolygon."""
    if len(text.encode("utf-8")) > MAX_UPLOAD_BYTES:
        raise JstexAoiError("The file is larger than 5 MB.")
    try:
        doc = json.loads(text)
    except ValueError as err:
        raise JstexAoiError("The file is not valid GeoJSON.") from err
    if not isinstance(doc, dict):
        raise JstexAoiError("The file is not valid GeoJSON.")
    if not _crs_ok(doc):
        raise JstexAoiError("Only EPSG:4326 (WGS84 lon/lat) supported.")
    polygons = _polygons(doc)
    if not polygons:
        raise JstexAoiError("No polygon geometry found")
    if not all(_valid_polygon(p) for p in polygons):
        raise JstexAoiError("Invalid coordinates in the polygon geometry.")
    if len(polygons) == 1:
        return {"type": "Polygon", "coordinates": polygons[0]}
    return {"type": "MultiPolygon", "coordinates": polygons}


def repair(geometry: dict) -> dict:
    """Make a polygonal geometry valid (e.g. a self-crossing drawn polygon).

    CDSE rejects invalid geometries (``GEOSIntersects: TopologyException``).
    Keeps only polygonal parts; raises if nothing polygonal is left.
    """
    geom = shape(geometry)
    if geom.is_valid:
        return geometry
    fixed = make_valid(geom)
    if isinstance(fixed, GeometryCollection):
        parts = [g for g in fixed.geoms if isinstance(g, (Polygon, MultiPolygon))]
        fixed = (
            parts[0]
            if len(parts) == 1
            else MultiPolygon(
                [
                    p
                    for g in parts
                    for p in (g.geoms if isinstance(g, MultiPolygon) else [g])
                ]
            )
        )
    if not isinstance(fixed, (Polygon, MultiPolygon)) or fixed.is_empty:
        raise JstexAoiError("The area of interest has no usable polygon.")
    return json.loads(json.dumps(mapping(fixed)))
