"""All HTTP to the STAC API. Stateless: pagination state travels in ``Page``.

Uses pystac-client's StacApiIO so ``rel=next`` links are followed exactly
(method, body and ``merge`` included) and urllib3 retries handle 429/5xx.
The user's token is injected per request, so a token refreshed mid-session
is picked up without rebuilding the client.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit

import pystac
from pystac import Link
from pystac_client.exceptions import APIError
from pystac_client.stac_api_io import StacApiIO
from requests import Request
from urllib3.util.retry import Retry

from . import auth
from .errors import JstexStacError
from .query import QueryState, to_search_body

MAX_COLLECTION_PAGES = 50
# Queryables that the widget does not offer as attribute filters: space and time
# have their own controls, the rest are bookkeeping.
NOT_FILTERABLE = {
    "geometry",
    "bbox",
    "datetime",
    "start_datetime",
    "end_datetime",
    "collection",
    "stac_version",
}
FILTER_TYPES = {"string", "number", "integer", "boolean"}


def default_retry() -> Retry:
    return Retry(
        total=4,
        backoff_factor=1.0,
        status_forcelist=(429, 502, 503, 504),
        allowed_methods=None,  # retry POST /search too
        raise_on_status=False,  # hand the final response to pystac-client
        respect_retry_after_header=True,
    )


@dataclass
class Page:
    items: list[dict]
    next_link: dict | None
    search_body: dict
    matched: int | None


def _next_link(doc: dict) -> dict | None:
    return next(
        (link for link in doc.get("links", []) if link.get("rel") == "next"), None
    )


def _message(err: APIError, status: int | None) -> str:
    if status in (401, 403):
        return f"Not authorised for this STAC resource (HTTP {status})."
    if status == 429:
        return "Rate limited by the STAC API; try again shortly."
    detail = str(err).strip()[:300]
    return (
        f"STAC request failed (HTTP {status}): {detail}"
        if status
        else f"STAC request failed: {detail}"
    )


def _origin(url: str) -> tuple[str, str, int | None]:
    parts = urlsplit(url)
    scheme = parts.scheme.lower()
    return (
        scheme,
        (parts.hostname or "").lower(),
        parts.port or {"https": 443, "http": 80}.get(scheme),
    )


class StacBackend:
    def __init__(self, url: str, *, retry: Retry | None = None, timeout: float = 30):
        self.url = url
        self.io = StacApiIO(
            request_modifier=self._add_auth,
            timeout=timeout,
            max_retries=retry or default_retry(),
        )
        self._queryables: dict[str, dict] = {}

    def _add_auth(self, request: Request) -> Request:
        # Only the configured STAC host gets the user's token: item self links
        # and rel=next hrefs are server data and may point anywhere.
        if _origin(request.url) != _origin(self.url):
            return request
        token = auth.get_token()
        if token:
            request.headers["Authorization"] = f"Bearer {token}"
        return request

    def _read(
        self,
        source: str | Link,
        method: str | None = None,
        parameters: dict | None = None,
    ) -> dict:
        for attempt in (0, 1):
            try:
                if isinstance(source, Link):
                    text = self.io.read_text(source, parameters=parameters or {})
                else:
                    text = self.io.request(source, method=method, parameters=parameters)
                try:
                    return json.loads(text)
                except ValueError as err:
                    # e.g. CDSE's firewall: HTTP 200 text/html "Request Rejected"
                    raise JstexStacError(
                        "The STAC API returned a non-JSON response (the request may have been rejected)."
                    ) from err
            except APIError as err:
                status = getattr(err, "status_code", None)
                if status == 401 and attempt == 0:
                    auth.current(force_refresh=True)
                    continue
                raise JstexStacError(_message(err, status), status) from err
        raise AssertionError("unreachable")

    def list_collections(self) -> list[dict[str, Any]]:
        """Collections the token can see: id, title, description, license, start, end (sorted by title)."""
        found: dict[str, dict[str, Any]] = {}
        source: str | Link | None = self.url + "collections"
        for _ in range(MAX_COLLECTION_PAGES):
            if source is None:
                break
            doc = self._read(source)
            for c in doc.get("collections", []):
                interval = (
                    (((c.get("extent") or {}).get("temporal") or {}).get("interval"))
                    or [[None, None]]
                )[0]
                found.setdefault(
                    c["id"],
                    {
                        "id": c["id"],
                        "title": c.get("title") or c["id"],
                        "description": c.get("description") or "",
                        "license": c.get("license") or "",
                        "start": (interval + [None, None])[0],
                        "end": (interval + [None, None])[1],
                    },
                )
            nxt = _next_link(doc)
            source = Link.from_dict(nxt) if nxt else None
        return sorted(found.values(), key=lambda c: c["title"].lower())

    def queryables(self, collection_id: str) -> dict[str, Any]:
        if collection_id not in self._queryables:
            self._queryables[collection_id] = self._read(
                f"{self.url}collections/{collection_id}/queryables"
            )
        return self._queryables[collection_id]

    def merged_queryables(self, collection_ids: list[str]) -> list[dict[str, Any]]:
        """Filterable fields shared by ALL given collections (intersection).

        Each field: ``{"name", "title", "type", "enum"?, "minimum"?, "maximum"?}``.
        A field whose type differs between collections is dropped; an enum is
        kept only when every collection lists the same values.
        """
        if not collection_ids:
            return []
        schemas = [
            (self.queryables(cid).get("properties") or {}) for cid in collection_ids
        ]
        fields = []
        for name in sorted(schemas[0]):
            if name in NOT_FILTERABLE or not all(name in s for s in schemas):
                continue
            first = schemas[0][name]
            kind = first.get("type")
            if kind not in FILTER_TYPES or any(
                s[name].get("type") != kind for s in schemas[1:]
            ):
                continue
            field: dict[str, Any] = {
                "name": name,
                "title": first.get("title") or name,
                "type": kind,
            }
            enum = first.get("enum")
            if enum and all(s[name].get("enum") == enum for s in schemas[1:]):
                field["enum"] = enum
            for bound in ("minimum", "maximum"):
                if bound in first:
                    field[bound] = first[bound]
            fields.append(field)
        return fields

    def _page(self, doc: dict, body: dict) -> Page:
        matched = doc.get("numberMatched", (doc.get("context") or {}).get("matched"))
        return Page(doc.get("features", []), _next_link(doc), body, matched)

    def search_page(self, state: QueryState) -> Page:
        body = to_search_body(state)
        return self._page(self._read(self.url + "search", "POST", body), body)

    def next_page(self, next_link: dict, search_body: dict) -> Page:
        return self._page(
            self._read(Link.from_dict(next_link), parameters=search_body), search_body
        )

    def read_item(self, href: str) -> pystac.Item:
        item = pystac.Item.from_dict(self._read(href))
        if not item.get_self_href():
            item.set_self_href(href)
        return item
