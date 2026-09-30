"""Extract translatable strings into jstex/locale/jstex.pot (JupyterLab i18n standard).

jupyterlab-translate scans every **/*.ts under the repo root and only ignores
the top-level node_modules/, so ui-tests/node_modules (JupyterLab's own
sources) would flood the template. Run the extractor on a copy that holds only
jstex's own sources, then copy the .pot back.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCES = ["js", "src", "package.json", "pyproject.toml"]


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="jstex-i18n-") as tmp:
        stage = Path(tmp)
        for name in SOURCES:
            src = ROOT / name
            if src.is_dir():
                shutil.copytree(
                    src,
                    stage / name,
                    ignore=shutil.ignore_patterns("__tests__", "node_modules"),
                )
            else:
                shutil.copy2(src, stage / name)
        # Python sources only (no built labextension / widget bundle).
        shutil.copytree(
            ROOT / "jstex",
            stage / "jstex",
            ignore=shutil.ignore_patterns(
                "labextension", "static", "tests", "__pycache__", "locale"
            ),
        )
        subprocess.run(
            ["jupyterlab-translate", "extract", str(stage), "jstex"],
            check=True,
            cwd=stage,
        )
        target = ROOT / "jstex" / "locale"
        target.mkdir(exist_ok=True)
        shutil.copy2(stage / "jstex" / "locale" / "jstex.pot", target / "jstex.pot")
    print(f"wrote {target / 'jstex.pot'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
