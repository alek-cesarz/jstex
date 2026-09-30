import pytest

from jstex.errors import JstexQueryError, JstexStacError
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
    assert ex.auth_source == "env"


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


def test_query_url(monkeypatch):
    monkeypatch.setenv("JSTEX_STEX_URL", "https://stex.example.org/")
    ex, _ = make(FakeBackend())
    assert ex.query_url() == "https://stex.example.org/?q=e30"


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
    monkeypatch.setenv("JSTEX_BASEMAP_DARK_KEY", "K")
    ex, _ = make(FakeBackend())
    assert (
        ex.basemap["light"]["url"]
        == "https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png"
    )
    assert ex.basemap["dark"]["url"].endswith(
        "alidade_smooth_dark/{z}/{x}/{y}@2x.png?api_key=K"
    )
    assert "CARTO" in ex.basemap["light"]["attribution"]


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
