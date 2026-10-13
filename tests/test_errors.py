"""Known jstex errors show in notebooks as one line: `JstexQueryError: message`."""

import pytest

import jstex
from jstex.config import load_config
from jstex.errors import JstexError, JstexQueryError


def test_jstex_errors_render_as_one_line_in_ipython():
    err = JstexQueryError("Select at least one collection before searching.")
    lines = err._render_traceback_()
    assert len(lines) == 1
    assert "JstexQueryError" in lines[0]
    assert lines[0].endswith(": Select at least one collection before searching.")


def test_every_user_facing_error_class_is_short():
    from jstex.aoi import JstexAoiError
    from jstex.interactive_login import LoginError
    from jstex.oidc import OidcError
    from jstex.profiles import JstexProfileError
    from jstex.s3 import JstexS3Error

    for cls in (JstexAoiError, LoginError, JstexProfileError, JstexS3Error):
        assert hasattr(cls("x"), "_render_traceback_"), cls
    assert hasattr(OidcError("invalid_grant", "x"), "_render_traceback_")


def test_full_traceback_on_request(monkeypatch):
    monkeypatch.setenv("JSTEX_TRACEBACK", "1")
    assert not hasattr(JstexError("x"), "_render_traceback_")  # IPython's normal view


def test_unknown_setting_is_a_short_jstex_error_and_still_a_type_error():
    with pytest.raises(JstexError) as err:
        load_config(nope=1)
    assert isinstance(err.value, TypeError)
    assert "nope" in err.value._render_traceback_()[0]


def test_jstex_error_is_exported():
    assert jstex.JstexError is JstexError
