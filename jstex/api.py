"""Small public helpers used by snippets the widget copies to the clipboard."""

from __future__ import annotations

import datetime as dt
import getpass
import html
import time

import pystac

from . import auth
from .config import (
    Config,
    ConfigView,
    _files,
    load_config,
    profiles_in_use,
    save_login_client_id,
    set_kernel_profile,
)
from .interactive_login import (
    LABELS,
    LoginError,
    _CellDisplay,
    device_login,
    exclusive,
    login_client_id,
    password_login,
    status_text,
)
from .profiles import load_registry
from .stac import StacBackend


def item(
    href: str, *, profile: str | None = None, stac_url: str | None = None
) -> pystac.Item:
    """Open a STAC item by URL with the user's token (restricted collections work)."""
    return _item(load_config(profile=profile, stac_url=stac_url), href)


def _item(cfg: Config, href: str) -> pystac.Item:
    return StacBackend(cfg.stac_url, auth_config=cfg).read_item(href)


def use_profile(name: str | None) -> None:
    """Make `name` this kernel's default profile: the jstex.* functions and new
    explorers without profile= use it (it beats JSTEX_PROFILE and config.toml).
    use_profile(None) goes back to the configured default. An explorer keeps
    the profile it was created with."""
    if name is not None:
        load_config(profile=name)  # unknown names raise here, nothing changes
    set_kernel_profile(name)


def show_config(profile: str | None = None, **overrides) -> ConfigView:
    """The effective settings for `profile` and where each value came from."""
    return ConfigView(load_config(profile=profile, **overrides))


def list_profiles() -> list[dict[str, str]]:
    """Ready-made profiles (registry) and own profiles (config files)."""
    reg = load_registry()
    out = [
        {
            "name": n,
            "description": (p.get("platform") or {}).get("description", ""),
            "source": reg.source,
        }
        for n, p in sorted(reg.profiles.items())
    ]
    for label, data in _files():
        for n in sorted(data.get("profiles") or {}):
            if n not in reg.profiles:
                out.append({"name": n, "description": "", "source": label})
    return out


def login(
    profile: str | None = None,
    *,
    token: str | None = None,
    method: str | None = None,
    username: str | None = None,
    client_id: str | None = None,
    save: bool = False,
) -> str:
    """Sign in for `profile` (default: the active one) and return a status line.

    token=...        use this access token (manual)
    method="device"  device code: open a link, confirm a code (default when possible)
    method="password" username and password (where the profile allows it)
    client_id=...    device-login client id; asked for when none is configured
    save=True        also write that client id to ~/.config/jstex/config.toml
    """
    return _login(
        load_config(profile=profile),
        token=token,
        method=method,
        username=username,
        client_id=client_id,
        save=save,
    )


def _login(
    cfg: Config,
    *,
    token: str | None = None,
    method: str | None = None,
    username: str | None = None,
    client_id: str | None = None,
    save: bool = False,
) -> str:
    if token:
        return status_text(auth.set_manual_token(cfg, token))
    if method is None and auth.current(cfg).source != "anonymous":
        return status_text(auth.current(cfg))
    with exclusive():
        if method in (None, "device"):
            cid = client_id or login_client_id(cfg)
            if cid is None and (
                method == "device"
                or not (cfg.password_login and cfg.password_client_id)
            ):
                cid = input("Device-login client id: ").strip() or None
            if cid is not None:
                display = _CellDisplay()
                try:
                    info = device_login(cfg, client_id=cid, show=display.show)
                except LoginError as err:
                    if (
                        err.reason != "client_refused"
                        or method == "device"
                        or not cfg.password_login
                    ):
                        raise
                else:
                    if save:
                        save_login_client_id(cfg.profile, cid)
                    display.done(status_text(info))
                    return status_text(info)
        return _password(cfg, username)


def _password(cfg, username: str | None) -> str:
    if not (cfg.password_login and cfg.password_client_id):
        raise LoginError(
            "No sign-in method available: set login_client_id (device login) or pass client_id=.",
            "need_client_id",
        )
    user = username or input("Username: ").strip()
    info = password_login(cfg, username=user, password=getpass.getpass("Password: "))
    return status_text(info)


def logout(profile: str | None = None) -> str:
    """Forget the stored login for `profile`'s identity service."""
    return _logout(load_config(profile=profile))


def _logout(cfg: Config) -> str:
    auth.logout(cfg)
    return "Signed out."


class SignInStatus(dict):
    """`jstex.whoami()` result: a plain dict that a notebook shows as a list."""

    _expires_ts: float = 0.0

    def _rows(self) -> list[tuple[str, str]]:
        rows = [("Profile", str(self["profile"]))]
        if self["source"] == "anonymous":
            rows.append(("Signed in", "no"))
        else:
            rows.append(("Signed in", LABELS.get(self["source"], self["source"])))
            if self["user"]:
                rows.append(("User", self["user"]))
            if self["expires_at"]:
                rows.append(("Expires", f"{self['expires_at']} ({self._left()})"))
        others = self.get("other_profiles") or []
        if others:
            rows.append(
                (
                    "Also in use",
                    f"{', '.join(others)} (see jstex.whoami({others[0]!r}) or ex.whoami())",
                )
            )
        return rows

    def _left(self) -> str:
        minutes = int((self._expires_ts - time.time()) // 60)
        if minutes < 0:
            return "expired"
        hours, minutes = divmod(minutes, 60)
        return f"in {hours} h {minutes} min" if hours else f"in {minutes} min"

    def __repr__(self) -> str:
        rows = self._rows()
        width = max(11, *(len(label) + 1 for label, _ in rows))
        return "\n".join(f"{label + ':':<{width}} {value}" for label, value in rows)

    def _repr_html_(self) -> str:
        rows = "".join(
            f"<tr><th style='text-align:left'>{html.escape(label)}</th>"
            f"<td style='text-align:left'>{html.escape(value)}</td></tr>"
            for label, value in self._rows()
        )
        return f"<table>{rows}</table>"


def _local_time(ts: float) -> str:
    return dt.datetime.fromtimestamp(ts).astimezone().strftime("%Y-%m-%d %H:%M:%S %Z")


def whoami(profile: str | None = None) -> SignInStatus:
    """How jstex is signed in for `profile`: profile, source, user name and when
    the access token expires (local time; None when not signed in). A dict;
    notebooks show it as a short list. Without `profile`, it also names the
    other profiles this kernel's explorers use (`other_profiles`)."""
    cfg = load_config(profile=profile)
    others = sorted(profiles_in_use() - {cfg.profile}) if profile is None else []
    return _whoami(cfg, others)


def _whoami(cfg: Config, others: list[str] | None = None) -> SignInStatus:
    info = auth.current(cfg)
    signed_in = info.source != "anonymous"
    status = SignInStatus(
        profile=cfg.profile,
        source=info.source,
        user=info.user,
        expires_at=_local_time(info.expires_at) if signed_in else None,
        other_profiles=others or [],
    )
    status._expires_ts = info.expires_at
    return status


def access_token(profile: str | None = None) -> str | None:
    """The current access token for `profile` (None when anonymous), for your
    own HTTP requests. jstex sends it only to the profile's own services; where
    else you send it is your decision."""
    return _access_token(load_config(profile=profile))


def _access_token(cfg: Config) -> str | None:
    return auth.get_token(cfg)


README_URL = "https://github.com/alek-cesarz/jstex#readme"

# (section, [(call, what it does)]) — keep in step with README "Using results in
# Python"; tests/test_help.py checks that every public name is listed.
HELP: list[tuple[str, list[tuple[str, str]]]] = [
    (
        "The explorer",
        [
            (
                "jstex.Explorer(profile=None, stac_url=None, height=600)",
                "The widget: search panel, map, results and item details",
            ),
            ("ex.results", "All loaded items (pystac.ItemCollection)"),
            ("ex.selected_items", "The checked result rows (pystac.Item list)"),
            ("ex.selected_item", "The item shown in Item details (None if none)"),
            ("ex.query", "The current query (dict); assign to change the panel"),
            (
                "ex.search(wait=False)",
                "Run the query; wait=True blocks until results are in",
            ),
            ("ex.cancel()", "Drop the running search; previous results stay"),
            ("ex.query_url()", "Clickable STAC GET /search URL for the query"),
            ("ex.stex_url()", "Clickable STEX link that opens the query"),
            ("ex.config", "This explorer's effective settings"),
        ],
    ),
    (
        "This explorer's profile",
        [
            ("ex.whoami()", "How this explorer's profile is signed in"),
            (
                "ex.login(...)",
                "Sign in for this explorer's profile (options as jstex.login)",
            ),
            ("ex.logout()", "Forget the stored login for this explorer's profile"),
            ("ex.access_token()", "The current access token, for your own requests"),
            ("ex.item(href)", "Open a STAC item URL with this explorer's settings"),
            (
                "ex.s3.client(asset)",
                "S3 helpers for this explorer's profile (as jstex.s3.*)",
            ),
        ],
    ),
    (
        "Profiles and sign-in (kernel default profile, or profile=)",
        [
            ("jstex.list_profiles()", "Ready-made and your own profiles"),
            (
                "jstex.show_config(profile=None)",
                "Effective settings and where each came from",
            ),
            ("jstex.use_profile(name)", "Make name the kernel's default profile"),
            (
                "jstex.login(profile=None, ...)",
                "Sign in: device login, password or token=",
            ),
            ("jstex.logout(profile=None)", "Forget the stored login"),
            (
                "jstex.whoami(profile=None)",
                "How you are signed in; other profiles in use",
            ),
            (
                "jstex.access_token(profile=None)",
                "The current access token, for your own requests",
            ),
            (
                "jstex.item(href, profile=None)",
                "Open any STAC item URL with your token",
            ),
        ],
    ),
    (
        'S3 access (pip install "jupyterlab-jstex[s3]")',
        [
            ("jstex.s3.client(asset=None)", "boto3 S3 client; keys renew themselves"),
            ("jstex.s3.session()", "boto3 Session; keys renew themselves"),
            ("jstex.s3.location(asset)", "{'Bucket': …, 'Key': …} of an S3 asset"),
            (
                "jstex.s3.storage_options(asset=None)",
                "fsspec/s3fs options (key valid up to 8 h)",
            ),
            (
                "jstex.s3.gdal_env(asset=None)",
                "GDAL/rasterio /vsis3/ settings (key valid up to 8 h)",
            ),
            (
                "jstex.s3.write_s3_profile(name='jstex')",
                "S3 profile for R, Julia, GDAL and other tools",
            ),
        ],
    ),
    ("Help", [("jstex.help()", "This list")]),
]


class Help:
    """`jstex.help()` result: a table in notebooks, aligned text elsewhere."""

    def __repr__(self) -> str:
        width = max(len(call) for _, rows in HELP for call, _ in rows)
        lines = []
        for section, rows in HELP:
            lines += ["", section]
            lines += [f"  {call:<{width}}  {what}" for call, what in rows]
        lines += ["", f"More: {README_URL}"]
        return "\n".join(lines).lstrip("\n")

    def _repr_html_(self) -> str:
        left = "style='text-align:left'"
        body = ""
        for section, rows in HELP:
            body += f"<tr><th colspan='2' {left}>{html.escape(section)}</th></tr>"
            body += "".join(
                f"<tr><td {left}><code>{html.escape(call)}</code></td>"
                f"<td {left}>{html.escape(what)}</td></tr>"
                for call, what in rows
            )
        link = f'<a href="{README_URL}" target="_blank" rel="noopener">{README_URL}</a>'
        return f"<table>{body}</table><p>More: {link}</p>"


def show_help() -> Help:
    """All jstex functions with a short description, and a link to the README."""
    return Help()
