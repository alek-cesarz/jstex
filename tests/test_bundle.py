"""Checks on the built widget bundle (skipped until `jlpm build:widget` ran)."""

import pathlib

import pytest

BUNDLE = pathlib.Path(__file__).parent.parent / "jstex" / "static" / "widget.js"


@pytest.mark.skipif(not BUNDLE.exists(), reason="widget bundle not built")
def test_bundle_uses_production_builds_of_dependencies():
    # A NODE_ENV=development shell once made Vite pick Lit's development
    # build (slower, console warnings). vite.config.ts pins the conditions.
    assert "Lit is in dev mode" not in BUNDLE.read_text(encoding="utf-8")
