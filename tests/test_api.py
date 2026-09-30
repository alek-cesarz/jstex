import responses
from responses import matchers

import jstex


@responses.activate
def test_item_opens_with_bearer_token(monkeypatch):
    monkeypatch.setenv("JSTEX_ACCESS_TOKEN", "T")
    href = "https://stac.test/v1/collections/c1/items/a"
    responses.get(
        href,
        json={
            "type": "Feature",
            "stac_version": "1.0.0",
            "id": "a",
            "geometry": None,
            "properties": {
                "datetime": None,
                "start_datetime": "2024-01-01T00:00:00Z",
                "end_datetime": "2024-12-31T23:59:59Z",
            },
            "links": [],
            "assets": {},
        },
        match=[matchers.header_matcher({"Authorization": "Bearer T"})],
    )
    it = jstex.item(href)
    assert it.id == "a" and it.get_self_href() == href


def test_import_is_light():
    # The Jupyter server imports jstex via the jupyterlab.locale entry point to
    # find translations; that must not pull in the widget stack.
    import subprocess
    import sys

    code = "import jstex, sys; print(any(m in sys.modules for m in ('jstex.widget', 'anywidget', 'pystac_client')))"
    out = subprocess.run(
        [sys.executable, "-c", code], capture_output=True, text=True, check=True
    )
    assert out.stdout.strip() == "False"
