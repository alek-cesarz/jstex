"""Tiny deterministic STAC API for the Galata e2e tests (stdlib only).

GET  /v1/collections                      -> three collections (with description / license / extent)
GET  /v1/collections/<id>/queryables      -> number, enum and integer fields
POST /v1/search                           -> three items with IDENTICAL footprints
GET  /v1/collections/<c>/items/<id>       -> one item
GET  /__last_search                       -> the last POST /v1/search body (for assertions)
"""

from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = 8765
BASE = f"http://127.0.0.1:{PORT}/v1/"
COLLECTION = "sentinel-2-l2a"
GEOMETRY = {"type": "Polygon", "coordinates": [[[10, 45], [11, 45], [11, 46], [10, 46], [10, 45]]]}
IDS = ["S2A_T32TPS_20240712", "S2B_T32TPS_20240717", "S2A_T32TPS_20240722"]
last_search: dict = {}
COLLECTIONS = [
    {
        "id": COLLECTION,
        "title": "Sentinel-2 L2A",
        "description": "Surface reflectance, 10-60 m.",
        "license": "other",
        "extent": {"temporal": {"interval": [["2015-06-27T10:25:31Z", None]]}},
    },
    {"id": "sentinel-2-l1c", "title": "Sentinel-2 L1C", "description": "Top-of-atmosphere reflectance."},
    {"id": "sentinel-1-grd", "title": "Sentinel-1 GRD", "description": "SAR ground range detected."},
]
QUERYABLES = {
    "properties": {
        "eo:cloud_cover": {"title": "Cloud cover", "type": "number", "minimum": 0, "maximum": 100},
        "platform": {"title": "Platform", "type": "string", "enum": ["sentinel-2a", "sentinel-2b"]},
        "sat:relative_orbit": {"title": "Relative orbit", "type": "integer"},
        "datetime": {"type": "string"},
        "geometry": {"type": "object"},
    }
}


def item(i: str) -> dict:
    return {
        "type": "Feature",
        "stac_version": "1.0.0",
        "id": i,
        "collection": COLLECTION,
        "geometry": GEOMETRY,
        "bbox": [10, 45, 11, 46],
        "properties": {"datetime": f"{i[-8:-4]}-{i[-4:-2]}-{i[-2:]}T10:30:00Z", "eo:cloud_cover": 12.5},
        "assets": {"B04": {"href": f"s3://eodata/{i}/B04.jp2", "type": "image/jp2", "title": "Red"}},
        "links": [{"rel": "self", "href": f"{BASE}collections/{COLLECTION}/items/{i}"}],
    }


class Handler(BaseHTTPRequestHandler):
    def _json(self, body: object, status: int = 200) -> None:
        raw = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self) -> None:  # noqa: N802
        path = self.path.split("?")[0]
        if path in ("/v1", "/v1/"):
            self._json({"type": "Catalog", "id": "fake", "links": []})
        elif path == "/v1/collections":
            self._json({"collections": COLLECTIONS, "links": []})
        elif path.endswith("/queryables"):
            self._json({"type": "object", **QUERYABLES})
        elif path.startswith(f"/v1/collections/{COLLECTION}/items/"):
            self._json(item(path.rsplit("/", 1)[1]))
        elif path == "/__last_search":
            self._json(last_search)
        else:
            self._json({"detail": "not found"}, 404)

    def do_POST(self) -> None:  # noqa: N802
        global last_search
        length = int(self.headers.get("Content-Length", 0))
        last_search = json.loads(self.rfile.read(length) or b"{}")
        if self.path.split("?")[0] == "/v1/search":
            self._json({"type": "FeatureCollection", "features": [item(i) for i in IDS], "links": [], "numberMatched": 3})
        else:
            self._json({"detail": "not found"}, 404)

    def log_message(self, *args: object) -> None:
        pass


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
