"""anywidget front door for jstex (completed in a later task)."""

from __future__ import annotations

import pathlib

import anywidget

STATIC = pathlib.Path(__file__).parent / "static"


class Explorer(anywidget.AnyWidget):
    _esm = STATIC / "widget.js"
    _css = STATIC / "widget.css"
