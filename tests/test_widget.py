import threading

import pytest

from jstex import auth
from jstex.config import DEFAULT_BASEMAP_ATTRIBUTION
from jstex.errors import JstexError, JstexQueryError, JstexStacError
from jstex.interactive import DeviceCode, LoginError
from jstex.stac import Page
from jstex.widget import Explorer, sync_runner

URL = "https://stac.test/v1/"


def item(i: str) -> dict:
    return {
        "type": "Feature",
        "stac_version": "1.0.0",
        "id": i,
        "geometry": None,
        "properties": {"datetime": "2024-07-01T10:00:00Z"},
        "links": [{"rel": "self", "href": f"{URL}collections/c1/items/{i}"}],
        "assets": {"B04": {"href": f"s3://eodata/{i}/B04.jp2"}},
    }


class FakeBackend:
    def __init__(self, pages=None, error=None):
        self.pages = list(pages or [])
        self.error = error
        self.searched = []

    def list_collections(self):
        if self.error:
            raise self.error
        return [{"id": "c1", "title": "C1"}]

    def merged_queryables(self, ids):
        if self.error:
            raise self.error
        return (
            [{"name": "eo:cloud_cover", "title": "Cloud", "type": "number"}]
            if ids
            else []
        )

    def search_page(self, state):
        self.searched.append(state)
        if self.error:
            raise self.error
        return self.pages.pop(0)


def page(*ids, matched=None):
    return Page([item(i) for i in ids], None, {}, matched)


def make(backend, runner=sync_runner):
    ex = Explorer(backend=backend, runner=runner)
    sent = []
    ex.send = lambda content, buffers=None: sent.append(content)
    return ex, sent


def search_msg(collections=("c1",)):
    return {
        "type": "search",
        "query": {
            "collections": list(collections),
            "datetime": None,
            "aois": [],
            "filters": [],
            "sort": {"field": "properties.datetime", "direction": "desc"},
            "pageSize": 50,
        },
    }


def test_collections_reply_and_auth_source(monkeypatch):
    monkeypatch.setenv("JSTEX_ACCESS_TOKEN", "T")
    ex, sent = make(FakeBackend())
    ex._on_msg(ex, {"type": "collections", "req_id": 7}, [])
    assert sent == [
        {
            "type": "reply",
            "req_id": 7,
            "ok": True,
            "data": [{"id": "c1", "title": "C1"}],
        }
    ]
    assert ex.auth_source == "token"


def test_collections_error_reply():
    ex, sent = make(FakeBackend(error=JstexStacError("boom", 500)))
    ex._on_msg(ex, {"type": "collections", "req_id": 1}, [])
    assert sent[0]["ok"] is False and "boom" in sent[0]["error"]
    assert ex.auth_source == "anonymous"


def test_search_message_sets_query_sends_deduped_page():
    ex, sent = make(FakeBackend([page("a", "b", "a", matched=3)]))
    ex._on_msg(ex, search_msg(), [])
    assert ex.query["collections"] == ["c1"]
    assert sent == [{"type": "page", "items": [item("a"), item("b")], "matched": 3}]
    assert ex.status == "idle" and ex.error == ""


def test_accessors_return_pystac_objects():
    ex, _ = make(FakeBackend([page("a", "b")]))
    ex._on_msg(ex, search_msg(), [])
    ex.selected_ids = ["b"]
    ex.active_id = "a"
    assert [i.id for i in ex.results] == ["a", "b"]
    assert [i.id for i in ex.selected_items] == ["b"]
    assert ex.selected_item.get_self_href() == f"{URL}collections/c1/items/a"
    assert ex.selected_item.assets["B04"].href == "s3://eodata/a/B04.jp2"


def test_new_search_clears_selection():
    ex, _ = make(FakeBackend([page("a"), page("b")]))
    ex._on_msg(ex, search_msg(), [])
    ex.selected_ids, ex.active_id = ["a"], "a"
    ex._on_msg(ex, search_msg(), [])
    assert ex.selected_ids == [] and ex.active_id is None


def test_stac_error_sets_error_status_and_keeps_results():
    backend = FakeBackend([page("a")])
    ex, sent = make(backend)
    ex._on_msg(ex, search_msg(), [])
    backend.error = JstexStacError(
        "Rate limited by the STAC API; try again shortly.", 429
    )
    ex._on_msg(ex, search_msg(), [])
    assert ex.status == "error" and "Rate limited" in ex.error
    assert [i.id for i in ex.results] == ["a"]
    assert len(sent) == 1


def test_cancel_drops_stale_result_and_keeps_previous():
    deferred = []
    backend = FakeBackend([page("a"), page("b")])
    ex, sent = make(backend, runner=lambda fn, *a: deferred.append((fn, a)))
    ex._on_msg(ex, search_msg(), [])
    fn, a = deferred.pop()
    fn(*a)  # first search completes
    ex._on_msg(ex, search_msg(), [])
    assert ex.status == "searching"
    ex._on_msg(ex, {"type": "cancel"}, [])
    assert ex.status == "idle"
    fn, a = deferred.pop()
    fn(*a)  # stale completion
    assert [m["items"][0]["id"] for m in sent] == ["a"]
    assert [i.id for i in ex.results] == ["a"]


def test_search_without_collection():
    ex, sent = make(FakeBackend())
    with pytest.raises(JstexQueryError):
        ex.search()
    ex._on_msg(ex, search_msg(collections=()), [])
    assert ex.status == "error" and "collection" in ex.error and sent == []


def test_python_search_wait_populates_results():
    ex, _ = make(
        FakeBackend([page("a")]), runner=lambda fn, *a: None
    )  # runner never runs
    ex.query = {**ex.query, "collections": ["c1"]}
    ex.search(wait=True)
    assert [i.id for i in ex.results] == ["a"]


def test_instances_are_independent():
    ex1, _ = make(FakeBackend([page("a")]))
    ex2, _ = make(FakeBackend([page("b")]))
    ex1._on_msg(ex1, search_msg(), [])
    ex2._on_msg(ex2, search_msg(), [])
    assert [i.id for i in ex1.results] == ["a"] and [i.id for i in ex2.results] == ["b"]


def test_sync_runner_disables_cancel():
    assert make(FakeBackend(), runner=sync_runner)[0].can_cancel is False
    assert make(FakeBackend(), runner=lambda fn, *a: None)[0].can_cancel is True


def test_query_url_is_a_clickable_get_search_url(monkeypatch):
    monkeypatch.setenv("JSTEX_STAC_URL", URL)
    ex, _ = make(FakeBackend())
    ex.query = {**ex.query, "collections": ["c1"]}
    url = ex.query_url()
    assert url == f"{URL}search?collections=c1&limit=50"
    assert isinstance(url, str)
    assert url._repr_html_() == (
        f'<a href="{URL}search?collections=c1&amp;limit=50" target="_blank" '
        f'rel="noopener">{URL}search?collections=c1&amp;limit=50</a>'
    )


def test_stex_url(monkeypatch):
    monkeypatch.setenv("JSTEX_STEX_URL", "https://stex.example.org/")
    ex, _ = make(FakeBackend())
    url = ex.stex_url()
    assert url == "https://stex.example.org/?q=e30"
    assert url._repr_html_().startswith('<a href="https://stex.example.org/?q=e30"')


def test_stex_url_needs_jstex_stex_url(monkeypatch):
    monkeypatch.delenv("JSTEX_STEX_URL", raising=False)
    ex, _ = make(FakeBackend())
    with pytest.raises(JstexError, match="JSTEX_STEX_URL"):
        ex.stex_url()


def test_sync_resends_current_page_without_clearing_selection():
    ex, sent = make(FakeBackend([page("a", "b", matched=2)]))
    ex._on_msg(ex, {"type": "sync"}, [])
    assert sent == []  # nothing searched yet
    ex._on_msg(ex, search_msg(), [])
    ex.selected_ids, ex.active_id = ["b"], "b"
    ex._on_msg(ex, {"type": "sync"}, [])
    assert sent[-1] == {"type": "page", "items": [item("a"), item("b")], "matched": 2}
    assert ex.selected_ids == ["b"] and ex.active_id == "b"


def test_basemap_trait_from_config(monkeypatch):
    positron = {
        "url": "https://tiles.openfreemap.org/styles/positron",
        "attribution": DEFAULT_BASEMAP_ATTRIBUTION,
        "kind": "style",
    }
    ex, _ = make(FakeBackend())
    assert ex.basemap == {"light": positron, "dark": positron}
    monkeypatch.setenv(
        "JSTEX_BASEMAP_DARK_URL", "https://t.example.org/{z}/{x}/{y}.png"
    )
    monkeypatch.setenv("JSTEX_BASEMAP_DARK_KEY", "K")
    ex, _ = make(FakeBackend())
    assert ex.basemap["dark"] == {
        "url": "https://t.example.org/{z}/{x}/{y}.png?key=K",
        "attribution": DEFAULT_BASEMAP_ATTRIBUTION,
        "kind": "xyz",
    }


def test_queryables_message_replies_merged_fields():
    ex, sent = make(FakeBackend())
    ex._on_msg(ex, {"type": "queryables", "req_id": 4, "collections": ["c1", "c2"]}, [])
    assert sent == [
        {
            "type": "reply",
            "req_id": 4,
            "ok": True,
            "data": [{"name": "eo:cloud_cover", "title": "Cloud", "type": "number"}],
        }
    ]


def test_queryables_error_is_a_failed_reply():
    ex, sent = make(FakeBackend(error=JstexStacError("down", 503)))
    ex._on_msg(ex, {"type": "queryables", "req_id": 5, "collections": ["c1"]}, [])
    assert sent[0]["ok"] is False and "down" in sent[0]["error"]


def test_aoi_upload_validates_without_touching_the_query():
    ex, sent = make(FakeBackend())
    good = '{"type":"Feature","geometry":{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,0]]]}}'
    ex._on_msg(ex, {"type": "aoi_upload", "req_id": 1, "text": good}, [])
    assert sent[-1]["ok"] is True and sent[-1]["data"]["type"] == "Polygon"
    ex._on_msg(
        ex,
        {
            "type": "aoi_upload",
            "req_id": 2,
            "text": '{"type":"Point","coordinates":[0,0]}',
        },
        [],
    )
    assert sent[-1] == {
        "type": "reply",
        "req_id": 2,
        "ok": False,
        "error": "No polygon geometry found",
    }
    assert ex.query["aois"] == []


def test_panel_collapsed_defaults_to_open():
    assert make(FakeBackend())[0].panel_collapsed is False


def test_layout_traits_default_and_sync():
    ex = make(FakeBackend())[0]
    assert (ex.panel_width, ex.map_collapsed) == (300, False)
    assert {"panel_width", "map_collapsed"} <= set(ex.keys)


class Boom(FakeBackend):
    def list_collections(self):
        raise RuntimeError("unexpected")

    def search_page(self, state):
        raise RuntimeError("unexpected")


def test_unexpected_errors_never_leave_the_widget_stuck():
    ex, sent = make(Boom())
    ex._on_msg(ex, {"type": "collections", "req_id": 3}, [])
    assert sent[-1]["ok"] is False and "unexpected" in sent[-1]["error"]
    ex._on_msg(ex, search_msg(), [])
    assert ex.status == "error" and "unexpected" in ex.error


def test_explorer_uses_the_selected_profile():
    ex = Explorer(profile="codede", backend=FakeBackend(), runner=sync_runner)
    assert ex.profile_name == "codede"
    assert ex.config.stac_url == "https://stac.code-de.org/v1/"


def test_explorer_default_profile_name():
    ex, _ = make(FakeBackend())
    assert ex.profile_name == "cdse-opensearch"


def signed_in(source="device"):
    return auth.TokenInfo("T", source, 9e9, "alice")


def test_login_methods_follow_the_profile():
    ex, _ = make(FakeBackend())
    assert ex.login_methods == ["device", "password"]  # cdse-opensearch
    ex2 = Explorer(
        profile="none",
        stac_url="https://s/v1",
        backend=FakeBackend(),
        runner=sync_runner,
    )
    assert ex2.login_methods == []


def test_device_sign_in_without_client_id_asks_for_one():
    ex, sent = make(FakeBackend())
    ex._on_msg(ex, {"type": "login_start", "method": "device"}, [])
    assert sent[-1] == {"type": "login", "state": "need_client_id"}


def test_device_sign_in_shows_the_code_then_finishes(monkeypatch):
    ex, sent = make(FakeBackend())

    def fake_device(cfg, *, client_id, show, cancel):
        assert client_id == "dev"
        show(DeviceCode("https://id/device", "ABCD", 600))
        return signed_in()

    monkeypatch.setattr("jstex.widget.device_login", fake_device)
    ex._on_msg(ex, {"type": "login_start", "method": "device", "client_id": "dev"}, [])
    assert sent[-2:] == [
        {
            "type": "login",
            "state": "device",
            "uri": "https://id/device",
            "code": "ABCD",
            "expires_in": 600,
        },
        {"type": "login", "state": "done"},
    ]
    assert (ex.auth_source, ex.auth_user) == ("device", "alice")


def test_refused_device_client_points_to_password(monkeypatch):
    ex, sent = make(FakeBackend())

    def refused(cfg, **kw):
        raise LoginError(
            "Client 'x' is not allowed to use device login.", "client_refused"
        )

    monkeypatch.setattr("jstex.widget.device_login", refused)
    ex._on_msg(ex, {"type": "login_start", "method": "device", "client_id": "x"}, [])
    assert sent[-1]["state"] == "error" and sent[-1]["next"] == "password"


def test_password_is_never_echoed(monkeypatch):
    ex, sent = make(FakeBackend())

    def bad(cfg, *, username, password):
        raise LoginError("Wrong username or password.", "bad_credentials")

    monkeypatch.setattr("jstex.widget.password_login", bad)
    ex._on_msg(
        ex, {"type": "login_password", "username": "alice", "password": "s3cret"}, []
    )
    assert sent[-1] == {
        "type": "login",
        "state": "error",
        "message": "Wrong username or password.",
    }
    assert "s3cret" not in repr(sent) and "s3cret" not in repr(ex.get_state())


def test_cancel_and_logout(monkeypatch):
    ex, sent = make(FakeBackend())
    ex._login_cancel = threading.Event()
    ex._on_msg(ex, {"type": "login_cancel"}, [])
    assert ex._login_cancel.is_set()
    monkeypatch.setattr("jstex.widget.auth.logout", lambda cfg: None)
    monkeypatch.setattr(
        "jstex.widget.auth.current",
        lambda cfg=None, force_refresh=False: auth.TokenInfo(None, "anonymous", 0),
    )
    ex._on_msg(ex, {"type": "logout"}, [])
    assert sent[-1] == {"type": "login", "state": "signed_out"}
    assert ex.auth_source == "anonymous" and ex.auth_user == ""
