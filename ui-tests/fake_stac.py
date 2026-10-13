"""Tiny deterministic STAC API for the Galata e2e tests (stdlib only).

GET  /v1/collections                      -> three collections (with description / license / extent)
GET  /v1/collections/<id>/queryables      -> number, enum and integer fields
POST /v1/search                           -> three items with IDENTICAL footprints
GET  /v1/collections/<c>/items/<id>       -> one item
GET  /__last_search                       -> the last POST /v1/search body (for assertions)
"""

from __future__ import annotations

import base64
import json
import time
from urllib.parse import parse_qs
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = 8765
BASE = f"http://127.0.0.1:{PORT}/v1/"
COLLECTION = "sentinel-2-l2a"
GEOMETRY = {"type": "Polygon", "coordinates": [[[10, 45], [11, 45], [11, 46], [10, 46], [10, 45]]]}
IDS = ["S2A_T32TPS_20240712", "S2B_T32TPS_20240717", "S2A_T32TPS_20240722"]
last_search: dict = {}
ISSUER = f"http://127.0.0.1:{PORT}/oidc/realms/test"
OIDC = "/oidc/realms/test"
oidc_state = {"approved": False}
RESTRICTED = {"id": "restricted-l2a", "title": "Restricted L2A", "description": "Needs a login."}


def _jwt(claims: dict) -> str:
    def seg(obj: dict) -> str:
        return base64.urlsafe_b64encode(json.dumps(obj).encode()).rstrip(b"=").decode()

    return f"{seg({'alg': 'none'})}.{seg(claims)}.sig"


def signed_in_by_fake(header: str) -> bool:
    """True for 'Bearer <jwt>' whose payload names this fake issuer."""
    parts = header.removeprefix("Bearer ").split(".")
    if not header.startswith("Bearer ") or len(parts) != 3:
        return False
    payload = parts[1] + "=" * (-len(parts[1]) % 4)
    try:
        return json.loads(base64.urlsafe_b64decode(payload)).get("iss") == ISSUER
    except ValueError:
        return False


def tokens() -> dict:
    access = _jwt({"iss": ISSUER, "sub": "u1", "preferred_username": "alice", "exp": time.time() + 300})
    return {"access_token": access, "expires_in": 300, "refresh_token": "R", "refresh_expires_in": 1800}
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
        if path == f"{OIDC}/.well-known/openid-configuration":
            return self._json({
                "issuer": ISSUER,
                "token_endpoint": f"{ISSUER}/protocol/openid-connect/token",
                "device_authorization_endpoint": f"{ISSUER}/protocol/openid-connect/auth/device",
            })
        if path == "/__approve":
            oidc_state["approved"] = True
            return self._json({"approved": True})
        if path == "/__reset":
            oidc_state["approved"] = False
            return self._json({"approved": False})
        if path == "/v1/collections":
            signed_in = signed_in_by_fake(self.headers.get("Authorization", ""))
            return self._json({"collections": COLLECTIONS + ([RESTRICTED] if signed_in else []), "links": []})
        if path in ("/v1", "/v1/"):
            self._json({"type": "Catalog", "id": "fake", "links": []})
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
        raw = self.rfile.read(length) or b""
        path = self.path.split("?")[0]
        if path == f"{OIDC}/protocol/openid-connect/auth/device":
            return self._json({
                "device_code": "DC", "user_code": "WDJB-MJHT",
                "verification_uri": f"{ISSUER}/device",
                "verification_uri_complete": f"{ISSUER}/device?user_code=WDJB-MJHT",
                "expires_in": 300, "interval": 1,
            })
        if path == f"{OIDC}/protocol/openid-connect/token":
            form = {k: v[0] for k, v in parse_qs(raw.decode()).items()}
            grant = form.get("grant_type", "")
            if grant.endswith("device_code"):
                if oidc_state["approved"]:
                    return self._json(tokens())
                return self._json({"error": "authorization_pending"}, 400)
            if grant == "password":
                if (form.get("username"), form.get("password")) == ("alice", "secret"):
                    return self._json(tokens())
                return self._json({"error": "invalid_grant", "error_description": "Invalid user credentials"}, 401)
            if grant == "refresh_token":
                return self._json(tokens())
            return self._json({"error": "unsupported_grant_type"}, 400)
        last_search = json.loads(raw or b"{}")
        if path == "/v1/search":
            self._json({"type": "FeatureCollection", "features": [item(i) for i in IDS], "links": [], "numberMatched": 3})
        else:
            self._json({"detail": "not found"}, 404)

    def log_message(self, *args: object) -> None:
        pass


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
