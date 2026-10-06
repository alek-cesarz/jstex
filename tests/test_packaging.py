import json
import pathlib
from importlib.metadata import distribution

import jstex

ROOT = pathlib.Path(__file__).parent.parent


def test_distribution_and_labextension_are_named_jupyterlab_jstex():
    package = json.loads((ROOT / "package.json").read_text())
    install = json.loads((ROOT / "install.json").read_text())
    assert distribution("jupyterlab-jstex").metadata["Name"] == "jupyterlab-jstex"
    assert package["name"] == "jupyterlab-jstex"
    assert install["packageName"] == "jupyterlab-jstex"
    assert jstex._jupyter_labextension_paths() == [
        {"src": "labextension", "dest": "jupyterlab-jstex"}
    ]


def test_import_name_stays_jstex():
    assert hasattr(jstex, "Explorer") and hasattr(jstex, "item")


def test_licensed_gpl3_or_later_and_uploadable():
    meta = distribution("jupyterlab-jstex").metadata
    package = json.loads((ROOT / "package.json").read_text())
    assert meta["License-Expression"] == "GPL-3.0-or-later"
    assert package["license"] == "GPL-3.0-or-later"
    assert "Private :: Do Not Upload" not in (meta.get_all("Classifier") or [])
    assert (
        (ROOT / "LICENSE").read_text().lstrip().startswith("GNU GENERAL PUBLIC LICENSE")
    )
