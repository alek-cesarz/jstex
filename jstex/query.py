"""QueryState and its STEX-compatible ?q= codec.

Wire format mirrors STEX src/lib/query-codec.ts: base64url (no padding) of
UTF-8 JSON, compact AOIs ``[{"g": geometry, "s": selected}]``, defaults
omitted, coordinates rounded to 6 dp with JS Math.round semantics.
"""

from __future__ import annotations

import base64
import binascii
import json
import math
import warnings
from copy import deepcopy
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import parse_qs, quote, urlencode, urlparse

from shapely.geometry import mapping, shape
from shapely.ops import unary_union

from .aoi import repair
from .errors import JstexQueryError

DEFAULT_SORT = {"field": "properties.datetime", "direction": "desc"}
# Open-ended ranges are sent closed: the CDSE endpoint's firewall rejects
# "../end" (looks like path traversal), so a missing end gets a far bound.
OPEN_START = "1900-01-01T00:00:00Z"
OPEN_END = "2099-12-31T23:59:59Z"
DEFAULT_PAGE_SIZE = 50
# GET search links: 2,000 characters is a common safe URL length, and the CDSE
# firewall answers longer GET /search URLs with an HTML "Request Rejected" page
# (measured 2026-09-30: 1,900 accepted, 2,244 rejected).
MAX_GET_URL_LENGTH = 2000
FILTER_OPS = {"=", "!=", "<", "<=", ">", ">=", "IN"}
# UI operators -> standard CQL2-JSON. CDSE answers HTTP 400 to "!=" and "IN"
# (verified 2026-09-30); "<>" and "in" work.
CQL2_OPS = {
    "=": "=",
    "!=": "<>",
    "<": "<",
    "<=": "<=",
    ">": ">",
    ">=": ">=",
    "IN": "in",
}
POLYGONAL = {"Polygon", "MultiPolygon"}


@dataclass
class Aoi:
    geometry: dict
    selected: bool = True


@dataclass
class QueryState:
    collections: list[str] = field(default_factory=list)
    datetime: dict[str, str] | None = None
    aois: list[Aoi] = field(default_factory=list)
    filters: list[dict] = field(default_factory=list)
    sort: dict = field(default_factory=lambda: dict(DEFAULT_SORT))
    page_size: int = DEFAULT_PAGE_SIZE

    def to_dict(self) -> dict[str, Any]:
        return {
            "collections": list(self.collections),
            "datetime": dict(self.datetime) if self.datetime else None,
            "aois": [
                {"geometry": deepcopy(a.geometry), "selected": a.selected}
                for a in self.aois
            ],
            "filters": deepcopy(self.filters),
            "sort": dict(self.sort),
            "pageSize": self.page_size,
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> QueryState:
        return _validate(
            {
                "collections": d.get("collections") or [],
                "datetime": d.get("datetime") or None,
                "aois": [
                    {"g": a.get("geometry"), "s": a.get("selected", True)}
                    for a in d.get("aois") or []
                ],
                "filters": d.get("filters") or [],
                "sort": d.get("sort") or dict(DEFAULT_SORT),
                "pageSize": d.get("pageSize", DEFAULT_PAGE_SIZE),
            }
        )


# ── codec ───────────────────────────────────────────────────────────


def _js_round(n: float) -> float:
    r = math.floor(n * 1e6 + 0.5) / 1e6
    return 0.0 if r == 0 else r


def _num(n: float) -> int | float:
    # JSON.stringify(10.0) == "10": emit ints for integral values.
    return int(n) if float(n).is_integer() else n


def _round_geometry(geom: dict) -> dict:
    def ring(r):
        return [[_num(_js_round(x)), _num(_js_round(y))] for x, y, *_ in r]

    if geom["type"] == "Polygon":
        return {
            "type": "Polygon",
            "coordinates": [ring(r) for r in geom["coordinates"]],
        }
    if geom["type"] == "MultiPolygon":
        return {
            "type": "MultiPolygon",
            "coordinates": [[ring(r) for r in p] for p in geom["coordinates"]],
        }
    return geom


def encode(state: QueryState) -> str:
    obj: dict[str, Any] = {}
    if state.collections:
        obj["collections"] = state.collections
    if state.datetime:
        obj["datetime"] = state.datetime
    if state.aois:
        obj["aois"] = [
            {"g": _round_geometry(a.geometry), "s": a.selected} for a in state.aois
        ]
    if state.filters:
        obj["filters"] = state.filters
    if state.sort != DEFAULT_SORT:
        obj["sort"] = state.sort
    if state.page_size != DEFAULT_PAGE_SIZE:
        obj["pageSize"] = state.page_size
    raw = json.dumps(obj, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _extract_q(q: str) -> str:
    q = q.strip()
    if "://" in q or q.startswith("?"):
        values = parse_qs(urlparse(q).query).get("q")
        if not values:
            raise JstexQueryError("Invalid query URL")
        return values[0]
    return q


def decode(q: str) -> QueryState:
    try:
        encoded = _extract_q(q)
        if not encoded:
            raise ValueError("empty")
        raw = base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4))
        obj = json.loads(raw.decode("utf-8"))
        if not isinstance(obj, dict):
            raise TypeError("not an object")
        if "aois" not in obj and "aoi" in obj:
            obj["aois"] = [{"g": obj.pop("aoi"), "s": True}]
        return _validate(obj)
    except JstexQueryError:
        raise
    except (ValueError, TypeError, KeyError, binascii.Error, UnicodeDecodeError) as err:
        raise JstexQueryError("Invalid query URL") from err


def _validate(obj: dict[str, Any]) -> QueryState:
    def bad() -> JstexQueryError:
        return JstexQueryError("Invalid query URL")

    collections = obj.get("collections", [])
    if not (
        isinstance(collections, list) and all(isinstance(c, str) for c in collections)
    ):
        raise bad()
    dt = obj.get("datetime")
    if dt is not None:
        if not isinstance(dt, dict) or not (dt.get("from") or dt.get("to")):
            raise bad()
        if any(k in dt and not isinstance(dt[k], str) for k in ("from", "to")):
            raise bad()
        dt = {k: dt[k] for k in ("from", "to") if dt.get(k)}
    aois = []
    for a in obj.get("aois", []) or []:
        geom = a.get("g") or a.get("geometry") if isinstance(a, dict) else None
        if not isinstance(geom, dict) or geom.get("type") not in POLYGONAL:
            raise bad()
        aois.append(Aoi(geom, bool(a.get("s", a.get("selected", True)))))
    filters = obj.get("filters", [])
    if not isinstance(filters, list) or not all(
        isinstance(f, dict)
        and isinstance(f.get("field"), str)
        and f.get("op") in FILTER_OPS
        and "value" in f
        for f in filters
    ):
        raise bad()
    sort = obj.get("sort", dict(DEFAULT_SORT))
    if not (
        isinstance(sort, dict)
        and isinstance(sort.get("field"), str)
        and sort.get("direction") in ("asc", "desc")
    ):
        raise bad()
    page_size = obj.get("pageSize", DEFAULT_PAGE_SIZE)
    if not isinstance(page_size, int) or isinstance(page_size, bool) or page_size <= 0:
        raise bad()
    return QueryState(list(collections), dt, aois, filters, dict(sort), page_size)


def share_url(state: QueryState, base: str | None) -> str:
    q = encode(state)
    return f"{base.rstrip('?')}?q={q}" if base else q


# ── search request ──────────────────────────────────────────────────


def _predicate(f: dict) -> dict:
    value = f["value"]
    if f["op"] == "IN" and not isinstance(value, list):
        raise JstexQueryError(f"Filter {f['field']}: IN needs a list of values.")
    return {"op": CQL2_OPS[f["op"]], "args": [{"property": f["field"]}, value]}


def build_cql2(filters: list[dict]) -> dict | None:
    preds = [_predicate(f) for f in filters]
    if not preds:
        return None
    return preds[0] if len(preds) == 1 else {"op": "and", "args": preds}


def _intersects(aois: list[Aoi]) -> dict | None:
    geoms = [repair(a.geometry) for a in aois if a.selected]
    if not geoms:
        return None
    if len(geoms) == 1:
        return geoms[0]
    # jstex keeps one AOI; several can only come from a decoded STEX share link.
    # Overlapping parts make CDSE fail with "GEOSIntersects: TopologyException".
    merged = unary_union([shape(g).buffer(0) for g in geoms])
    return json.loads(json.dumps(mapping(merged)))  # tuples -> lists


def to_search_body(state: QueryState) -> dict[str, Any]:
    if not state.collections:
        raise JstexQueryError("Select at least one collection before searching.")
    body: dict[str, Any] = {
        "collections": list(state.collections),
        "limit": state.page_size,
    }
    dt = state.datetime or {}
    if dt.get("from") or dt.get("to"):
        body["datetime"] = f"{dt.get('from') or OPEN_START}/{dt.get('to') or OPEN_END}"
    geom = _intersects(state.aois)
    if geom is not None:
        body["intersects"] = geom
    cql = build_cql2(state.filters)
    if cql is not None:
        body["filter"] = cql
        body["filter-lang"] = "cql2-json"
    return body


# ── GET search link ─────────────────────────────────────────────────


def _compact_json(value: Any) -> str:
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False)


def _get_url(stac_url: str, body: dict[str, Any]) -> str:
    params = {"collections": ",".join(body["collections"]), "limit": str(body["limit"])}
    if "datetime" in body:
        params["datetime"] = body["datetime"]
    if "intersects" in body:
        params["intersects"] = _compact_json(_round_geometry(body["intersects"]))
    if "bbox" in body:
        params["bbox"] = ",".join(str(_num(_js_round(v))) for v in body["bbox"])
    if "filter" in body:
        params["filter"] = _compact_json(body["filter"])
        params["filter-lang"] = body["filter-lang"]
    return f"{stac_url}search?{urlencode(params, safe=',:/', quote_via=quote)}"


def search_get_url(
    state: QueryState, stac_url: str, max_length: int = MAX_GET_URL_LENGTH
) -> str:
    """The search as a STAC ``GET /search`` URL (same parameters as the POST body).

    Coordinates are rounded to 6 decimals. When the area makes the URL longer
    than ``max_length``, the area's bbox is sent instead (a superset of the
    results) and a warning says so.
    """
    body = to_search_body(state)
    url = _get_url(stac_url, body)
    if len(url) > max_length and "intersects" in body:
        body["bbox"] = list(shape(body.pop("intersects")).bounds)
        url = _get_url(stac_url, body)
        warnings.warn(
            f"The area makes the search URL longer than {max_length} characters; "
            "the link searches the area's bbox instead and may return extra items.",
            UserWarning,
            stacklevel=2,
        )
    if len(url) > max_length:
        warnings.warn(
            f"The search URL is {len(url)} characters long; some servers (e.g. CDSE) "
            f"reject GET URLs over {max_length} characters.",
            UserWarning,
            stacklevel=2,
        )
    return url
