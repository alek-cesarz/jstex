try:
    from ._version import __version__
except ImportError:
    # Fallback when using the package in dev mode without installing
    # in editable mode with pip. It is highly recommended to install
    # the package from a stable release or in editable mode: https://pip.pypa.io/en/stable/topics/local-project-installs/#editable-installs
    import warnings

    warnings.warn("Importing 'jstex' outside a proper installation.")
    __version__ = "dev"
from typing import Any

from .routes import setup_route_handlers

__all__ = [
    "Explorer",
    "__version__",
    "access_token",
    "item",
    "list_profiles",
    "login",
    "logout",
    "s3",
    "show_config",
    "use_profile",
    "whoami",
]


def __getattr__(name: str) -> Any:
    if name == "Explorer":
        from .widget import Explorer

        return Explorer
    if name in (
        "access_token",
        "item",
        "list_profiles",
        "login",
        "logout",
        "show_config",
        "use_profile",
        "whoami",
    ):
        from . import api

        return getattr(api, name)
    if name == "s3":
        import importlib

        return importlib.import_module(".s3", __name__)
    raise AttributeError(f"module 'jstex' has no attribute {name!r}")


def _jupyter_labextension_paths():
    return [{"src": "labextension", "dest": "jupyterlab-jstex"}]


def _jupyter_server_extension_points():
    return [{"module": "jstex"}]


def _load_jupyter_server_extension(server_app):
    """Registers the API handler to receive HTTP requests from the frontend extension.

    Parameters
    ----------
    server_app: jupyterlab.labapp.LabApp
        JupyterLab application instance
    """
    setup_route_handlers(server_app.web_app)
    name = "jstex"
    server_app.log.info(f"Registered {name} server extension")
