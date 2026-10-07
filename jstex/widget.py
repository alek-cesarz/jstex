"""``jstex.Explorer`` — the in-cell widget.

Python owns all STAC traffic and the token; the JS side is a view that sends
``collections`` / ``queryables`` / ``aoi_upload`` / ``search`` / ``cancel`` /
``sync`` messages and renders what comes back.
Search results travel as custom messages (a page of CDSE items can be several
MB — too big to live in a synced traitlet).
"""

from __future__ import annotations

import html
import pathlib
import threading
from collections.abc import Callable
from typing import Any

import anywidget
import pystac
import traitlets

from . import auth
from .aoi import parse_aoi_upload
from .config import Config, load_config
from .errors import JstexError
from .interactive_login import (
    LoginError,
    device_login,
    exclusive,
    login_client_id,
    password_login,
)
from .query import QueryState, search_get_url, share_url, to_search_body
from .stac import Page, StacBackend

STATIC = pathlib.Path(__file__).parent / "static"

Runner = Callable[..., None]


def thread_runner(fn: Callable[..., None], *args: Any) -> None:
    threading.Thread(target=fn, args=args, daemon=True).start()


def sync_runner(fn: Callable[..., None], *args: Any) -> None:
    fn(*args)


# Set from the Task 2 spike (DEVELOPMENT.md "THREAD_SEND_OK"):
# thread_runner if worker-thread sends are reliable, else sync_runner.
DEFAULT_RUNNER: Runner = thread_runner


class Url(str):
    """A URL string that notebooks show as a clickable link."""

    def _repr_html_(self) -> str:
        href = html.escape(self, quote=True)
        return f'<a href="{href}" target="_blank" rel="noopener">{href}</a>'


class Explorer(anywidget.AnyWidget):
    """Map-based STAC search in a notebook cell.

    After a search, ``ex.results`` holds every loaded item, ``ex.selected_items``
    the checked ones and ``ex.selected_item`` the one shown in Item details —
    all as ``pystac`` objects.
    """

    _esm = STATIC / "widget.js"
    _css = STATIC / "widget.css"

    query = traitlets.Dict().tag(sync=True)
    selected_ids = traitlets.List(traitlets.Unicode()).tag(sync=True)
    active_id = traitlets.Unicode(None, allow_none=True).tag(sync=True)
    status = traitlets.Unicode("idle").tag(sync=True)  # idle | searching | error
    error = traitlets.Unicode("").tag(sync=True)
    auth_source = traitlets.Unicode("anonymous").tag(sync=True)
    map_height = traitlets.Int(600).tag(sync=True)
    can_cancel = traitlets.Bool(True).tag(sync=True)
    basemap = traitlets.Dict().tag(
        sync=True
    )  # {"light": {url, attribution, kind: "style"|"xyz"}, "dark": {...}}
    profile_name = traitlets.Unicode("").tag(sync=True)  # active profile
    auth_user = traitlets.Unicode("").tag(sync=True)
    login_methods = traitlets.List(traitlets.Unicode()).tag(sync=True)
    panel_collapsed = traitlets.Bool(False).tag(
        sync=True
    )  # search panel folded to a rail
    panel_width = traitlets.Int(300).tag(sync=True)  # search panel width (px)
    map_collapsed = traitlets.Bool(False).tag(sync=True)  # map folded to a rail

    def __init__(
        self,
        *,
        profile: str | None = None,
        stac_url: str | None = None,
        height: int = 600,
        backend: StacBackend | None = None,
        runner: Runner | None = None,
        **kwargs: Any,
    ):
        run = runner or DEFAULT_RUNNER
        config = load_config(profile=profile, stac_url=stac_url)
        super().__init__(
            query=QueryState().to_dict(),
            map_height=height,
            can_cancel=run is not sync_runner,
            profile_name=config.profile,
            basemap={
                theme: {
                    "url": b.tile_url(),
                    "attribution": b.attribution,
                    "kind": b.kind,
                }
                for theme, b in (
                    ("light", config.basemap_light),
                    ("dark", config.basemap_dark),
                )
            },
            **kwargs,
        )
        self._config = config
        self._backend = backend or StacBackend(config.stac_url, auth_config=config)
        self._run = run
        self._items: dict[str, dict] = {}
        self._page: Page | None = None
        self._gen = 0
        self._lock = threading.Lock()
        methods = ["device"] if config.issuer else []
        if config.password_login and config.password_client_id and config.issuer:
            methods.append("password")
        self.login_methods = methods
        self._login_cancel = threading.Event()
        self.on_msg(self._on_msg)

    # ── messages from JS ────────────────────────────────────────────

    def _on_msg(self, _widget: Any, content: dict, _buffers: Any) -> None:
        kind = content.get("type")
        if kind == "collections":
            self._run(self._reply_collections, content.get("req_id"))
        elif kind == "queryables":
            self._run(
                self._reply_queryables,
                content.get("req_id"),
                list(content.get("collections") or []),
            )
        elif kind == "aoi_upload":
            self._reply_aoi_upload(
                content.get("req_id"), str(content.get("text") or "")
            )
        elif kind == "search":
            if isinstance(content.get("query"), dict):
                self.query = content["query"]
            try:
                self.search()
            except JstexError as err:
                self.error, self.status = str(err), "error"
        elif kind == "cancel":
            self.cancel()
        elif kind == "login_start":
            self._login_cancel = threading.Event()
            self._run(
                self._login_device
                if content.get("method") == "device"
                else self._login_ask_password,
                str(content.get("client_id") or "") or None,
            )
        elif kind == "login_password":
            # Local variables only: never stored, logged or echoed.
            self._run(
                self._login_password,
                str(content.get("username") or ""),
                str(content.get("password") or ""),
            )
        elif kind == "login_cancel":
            self._login_cancel.set()
        elif kind == "logout":
            self._run(self._logout)
        elif kind == "sync":
            self._send_page()  # a (re-)rendered view asks for the current results

    def _reply_collections(self, req_id: Any) -> None:
        info = auth.current(self._config)
        self.auth_source, self.auth_user = info.source, info.user
        self._reply(req_id, self._backend.list_collections)

    # ── sign-in (spec 2026-10-02 §4.1) ──────────────────────────────

    def _login_send(self, state: str, **extra: Any) -> None:
        self.send({"type": "login", "state": state, **extra})

    def _signed_in(self, info: auth.TokenInfo) -> None:
        self.auth_source, self.auth_user = info.source, info.user
        self._login_send("done")

    def _login_failed(self, err: LoginError) -> None:
        extra: dict[str, str] = {}
        if err.reason == "client_refused":
            extra["next"] = (
                "password" if "password" in self.login_methods else "client_id"
            )
        self._login_send("error", message=str(err), **extra)

    def _login_device(self, client_id: str | None) -> None:
        cid = client_id or login_client_id(self._config)
        if cid is None:
            self._login_send("need_client_id")
            return
        try:
            with exclusive():
                info = device_login(
                    self._config,
                    client_id=cid,
                    show=lambda c: self._login_send(
                        "device", uri=c.uri, code=c.code, expires_in=c.expires_in
                    ),
                    cancel=self._login_cancel,
                )
        except LoginError as err:
            self._login_failed(err)
            return
        except Exception as err:  # noqa: BLE001 - the UI must leave the busy state
            self._login_send("error", message=str(err) or type(err).__name__)
            return
        self._signed_in(info)

    def _login_ask_password(self, _client_id: str | None) -> None:
        self._login_send("password")

    def _login_password(self, username: str, password: str) -> None:
        try:
            with exclusive():
                info = password_login(
                    self._config, username=username, password=password
                )
        except LoginError as err:
            self._login_failed(err)
            return
        except Exception:  # noqa: BLE001 - never include anything that could hold the password
            self._login_send("error", message="Password login failed.")
            return
        self._signed_in(info)

    def _logout(self) -> None:
        auth.logout(self._config)
        info = auth.current(self._config)
        self.auth_source, self.auth_user = info.source, info.user
        self._login_send("signed_out")

    def _reply(self, req_id: Any, fn: Callable[[], Any]) -> None:
        try:
            data = fn()
        except Exception as err:  # noqa: BLE001 - every request must get a reply, or the UI waits forever
            self.send(
                {
                    "type": "reply",
                    "req_id": req_id,
                    "ok": False,
                    "error": str(err) or type(err).__name__,
                }
            )
            return
        self.send({"type": "reply", "req_id": req_id, "ok": True, "data": data})

    def _reply_queryables(self, req_id: Any, collections: list[str]) -> None:
        self._reply(req_id, lambda: self._backend.merged_queryables(collections))

    def _reply_aoi_upload(self, req_id: Any, text: str) -> None:
        # Validation only: the JS side replaces the AOI when this succeeds, so a
        # rejected file never changes the current area.
        self._reply(req_id, lambda: parse_aoi_upload(text))

    # ── search ──────────────────────────────────────────────────────

    def search(self, wait: bool = False) -> None:
        """Run the current ``query``. With ``wait=True`` block until results are in ``.results``."""
        state = QueryState.from_dict(self.query)
        to_search_body(state)  # validate now so Python callers get the error
        with self._lock:
            self._gen += 1
            gen = self._gen
        self.error, self.status = "", "searching"
        if wait:
            self._do_search(gen, state)
        else:
            self._run(self._do_search, gen, state)

    def cancel(self) -> None:
        """Drop the in-flight search; previous results stay."""
        with self._lock:
            self._gen += 1
        if self.status == "searching":
            self.status = "idle"

    def _is_current(self, gen: int) -> bool:
        with self._lock:
            return gen == self._gen

    def _do_search(self, gen: int, state: QueryState) -> None:
        try:
            page = self._backend.search_page(state)
        except Exception as err:  # noqa: BLE001 - never leave the UI in "searching"
            if self._is_current(gen):
                self.error, self.status = str(err) or type(err).__name__, "error"
            return
        if not self._is_current(gen):
            return
        items: dict[str, dict] = {}
        for it in page.items:
            items.setdefault(it["id"], it)
        self._items, self._page = items, page
        self.selected_ids, self.active_id = [], None
        self._send_page()
        self.status = "idle"

    def _send_page(self) -> None:
        if self._page is not None:
            self.send(
                {
                    "type": "page",
                    "items": list(self._items.values()),
                    "matched": self._page.matched,
                }
            )

    @property
    def config(self) -> Config:
        """The effective settings of this explorer (see jstex.show_config())."""
        return self._config

    # ── Python accessors ────────────────────────────────────────────

    @property
    def results(self) -> pystac.ItemCollection:
        return pystac.ItemCollection(
            [pystac.Item.from_dict(d) for d in self._items.values()]
        )

    @property
    def selected_items(self) -> list[pystac.Item]:
        return [
            pystac.Item.from_dict(self._items[i])
            for i in self.selected_ids
            if i in self._items
        ]

    @property
    def selected_item(self) -> pystac.Item | None:
        d = self._items.get(self.active_id or "")
        return pystac.Item.from_dict(d) if d else None

    def query_url(self) -> Url:
        """The current query as a STAC ``GET /search`` URL (opens the results as JSON).

        The link carries no token: restricted collections need a signed-in
        client. A complex area is replaced by its bbox (with a warning) to keep
        the URL short enough for the server.
        """
        return Url(
            search_get_url(QueryState.from_dict(self.query), self._config.stac_url)
        )

    def stex_url(self) -> Url:
        """A STEX link that opens the current query (needs ``JSTEX_STEX_URL``)."""
        if not self._config.stex_url:
            raise JstexError(
                "Set JSTEX_STEX_URL to the STEX address to get STEX links."
            )
        return Url(share_url(QueryState.from_dict(self.query), self._config.stex_url))
