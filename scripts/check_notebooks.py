"""Example notebooks are committed without outputs, so no token, key or user
data can reach git. Fails (exit 1) on outputs, execution counts or invalid
notebooks."""

import pathlib
import sys

import nbformat

bad: list[str] = []
paths = sorted(pathlib.Path("examples").glob("*.ipynb"))
if not paths:
    bad.append("no notebooks in examples/")
for path in paths:
    nb = nbformat.read(path, as_version=4)
    try:
        nbformat.validate(nb)
    except nbformat.ValidationError as err:
        bad.append(f"{path}: invalid ({err.message})")
    for i, cell in enumerate(nb.cells):
        if cell.cell_type == "code" and (cell.get("outputs") or cell.get("execution_count") is not None):
            bad.append(f"{path}: cell {i} has outputs")
if bad:
    print("Example notebooks must be valid and committed without outputs:\n" + "\n".join(bad))
    sys.exit(1)
print(f"{len(paths)} notebooks ok")
