"""jstex.help(): every public function, method and S3 helper, with a link to the README."""

import inspect

import jstex
from jstex.widget import Explorer


def test_help_lists_every_public_name():
    text = repr(jstex.help())
    for name in jstex.__all__:
        if name not in ("__version__", "s3"):
            assert f"jstex.{name}" in text, name
    for name in (
        "client",
        "session",
        "location",
        "storage_options",
        "gdal_env",
        "write_s3_profile",
    ):
        assert f"jstex.s3.{name}" in text, name
    for name in (
        "results",
        "selected_items",
        "selected_item",
        "query",
        "search",
        "cancel",
        "query_url",
        "stex_url",
        "whoami",
        "login",
        "logout",
        "access_token",
        "item",
        "s3",
        "config",
    ):
        assert f"ex.{name}" in text, name
        assert hasattr(Explorer, name), name
    assert "jstex.help()" in text


def test_help_links_to_the_readme_and_renders_html():
    h = jstex.help()
    assert "https://github.com/alek-cesarz/jstex#readme" in repr(h)
    html = h._repr_html_()
    assert (
        "<table" in html
        and 'href="https://github.com/alek-cesarz/jstex#readme"' in html
    )
    assert "<code>ex.whoami()</code>" in html


def test_help_does_not_replace_the_builtin_on_star_import():
    assert "help" not in jstex.__all__
    assert inspect.isfunction(jstex.help)
