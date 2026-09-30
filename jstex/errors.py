"""Exception types raised by jstex."""

from __future__ import annotations


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
