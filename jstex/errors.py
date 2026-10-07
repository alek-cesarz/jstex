"""Exception and warning types of jstex."""

from __future__ import annotations

import warnings


class JstexError(Exception):
    """Base class for all jstex errors."""


class JstexAuthError(JstexError):
    """The user's access token could not be obtained."""


class JstexStacError(JstexError):
    """A STAC API request failed."""

    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status


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
