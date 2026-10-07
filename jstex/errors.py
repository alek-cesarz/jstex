"""Exception and warning types of jstex."""

from __future__ import annotations

import os
import warnings
from collections.abc import Callable


class JstexError(Exception):
    """Base class for all jstex errors.

    In IPython/Jupyter a jstex error shows as one line, `JstexQueryError:
    message`, instead of a traceback through jstex's code: IPython uses an
    exception's `_render_traceback_()` when it has one. Set JSTEX_TRACEBACK=1
    for the full traceback (the attribute then does not exist).
    """

    @property
    def _render_traceback_(self) -> Callable[[], list[str]]:
        if os.environ.get("JSTEX_TRACEBACK", "").strip().lower() in (
            "1",
            "true",
            "yes",
            "on",
        ):
            raise AttributeError(
                "_render_traceback_"
            )  # hasattr() is False: normal traceback
        return lambda: [f"\x1b[0;31m{type(self).__name__}\x1b[0m: {self}"]


class JstexAuthError(JstexError):
    """The user's access token could not be obtained."""


class JstexStacError(JstexError):
    """A STAC API request failed."""

    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status


class JstexSettingError(JstexError, TypeError):
    """An unknown setting was passed (still a TypeError, as for any bad argument)."""


class JstexQueryError(JstexError):
    """A query could not be decoded or turned into a search request."""


class JstexWarning(UserWarning):
    """A notice for the user (fallbacks, ignored settings). Shown as just its
    message, without the file, line and source that Python adds by default."""


def _install_plain_format() -> None:
    previous = warnings.formatwarning
    if getattr(previous, "_jstex", False):
        return

    def formatwarning(message, category, filename, lineno, line=None):
        if isinstance(category, type) and issubclass(category, JstexWarning):
            return f"{message}\n"
        return previous(message, category, filename, lineno, line)

    formatwarning._jstex = True  # type: ignore[attr-defined]
    warnings.formatwarning = formatwarning


_install_plain_format()
