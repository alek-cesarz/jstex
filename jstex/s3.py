"""S3 access (spec 2026-10-02 §5). Keys come from the profile's keys manager
with the user's token; the policy is ported from STEX (platforms/cdse.ts,
s3-credentials.ts): 8 h keys, renewal below 1 h, superseded keys deleted,
one re-mint on InvalidAccessKeyId, propagation wait, key-cap back-off, and a
file lock so concurrent kernels share one key. Needs `jupyterlab-jstex[s3]`.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import tempfile
import threading
import time
from collections.abc import Callable
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlsplit

import requests

from . import auth, oidc
from .config import Config, load_config
from .errors import JstexError

KEY_TTL_S = 8 * 3600
RENEW_BELOW_S = 3600
PROPAGATION_BUDGET_S = 10
CAP_NEGATIVE_CACHE_S = 30
HTTP_TIMEOUT_S = 30


class JstexS3Error(JstexError):
    """S3 access is not possible (configuration, login, key limit, ...)."""


@dataclass(frozen=True)
class S3Key:
    access_key: str
    secret_key: str = field(repr=False)
    expires_at: float
    created_at: float


def keys_path() -> Path:
    base = os.environ.get("XDG_CONFIG_HOME") or str(Path.home() / ".config")
    return Path(base) / "jstex" / "s3-credentials.json"


def _parse_iso(value: str | None) -> float | None:
    if not value:
        return None
    try:
        parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed.timestamp()


class KeyManager:
    def __init__(
        self,
        cfg: Config,
        *,
        path: Path | None = None,
        now: Callable[[], float] | None = None,
        sleep: Callable[[float], None] | None = None,
        probe: Callable[[S3Key], str] | None = None,
    ):
        if not (cfg.s3_keys_url and cfg.s3_endpoint and cfg.s3_bucket):
            raise JstexS3Error(
                f"S3 is not configured for profile {cfg.profile!r} (needs s3_keys_url, s3_endpoint and s3_bucket)."
            )
        self.cfg = cfg
        self.path = path or keys_path()
        self._now = now or time.time
        self._sleep = sleep or time.sleep
        self._probe = probe or self._probe_s3
        self._cap_until = 0.0
        self._base = cfg.s3_keys_url.rstrip("/")

    # -- storage ---------------------------------------------------------
    def _token(self) -> str:
        token = auth.get_token(self.cfg)
        if not token:
            raise JstexS3Error(
                "Sign in first: S3 keys need a login (jstex.login() or the Sign in button)."
            )
        return token

    def _slot(self) -> str:
        sub = oidc.claims(self._token()).get("sub", "unknown")
        return f"{self._base}|{sub}"

    def _load(self) -> dict:
        try:
            data = json.loads(self.path.read_text())
            return data if isinstance(data, dict) else {}
        except (OSError, ValueError):
            return {}

    def _save(self, data: dict) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=self.path.parent, suffix=".tmp")  # 0600
        try:
            with os.fdopen(fd, "w") as fh:
                json.dump(data, fh)
            os.replace(tmp, self.path)
        except BaseException:
            Path(tmp).unlink(missing_ok=True)
            raise

    def _lock(self):
        from filelock import FileLock

        return FileLock(str(self.path) + ".lock", timeout=60)

    # -- policy ----------------------------------------------------------
    def credentials(self) -> S3Key:
        superseded = None
        with self._lock():
            data = self._load()
            slot = self._slot()
            entry = data.get(slot)
            now = self._now()
            if entry and entry.get("expires_at", 0) - now > RENEW_BELOW_S:
                return S3Key(**entry)
            key = self._create(now)
            data[slot] = asdict(key)
            self._save(data)
            superseded = entry.get("access_key") if entry else None
        if superseded:
            self._delete_quietly(superseded)
        return key

    def invalidate(self, key: S3Key) -> S3Key:
        """S3 rejected `key` (InvalidAccessKeyId): drop it and create one new key."""
        with self._lock():
            data = self._load()
            slot = self._slot()
            if (data.get(slot) or {}).get("access_key") == key.access_key:
                del data[slot]
                self._save(data)
        return self.credentials()

    def _create(self, now: float) -> S3Key:
        if now < self._cap_until:
            raise JstexS3Error(self._cap_message())
        expires = dt.datetime.fromtimestamp(now + KEY_TTL_S, dt.timezone.utc).strftime(
            "%Y-%m-%dT%H:%M:%SZ"
        )
        try:
            resp = requests.post(
                f"{self._base}/credentials",
                json={"expiration_date": expires},
                headers={"Authorization": f"Bearer {self._token()}"},
                timeout=HTTP_TIMEOUT_S,
            )
        except requests.RequestException as err:
            raise JstexS3Error(
                f"S3 keys manager unreachable ({type(err).__name__})."
            ) from err
        if (
            resp.status_code in (400, 403, 409)
            and "number of credentials" in resp.text.lower()
        ):
            self._cap_until = now + CAP_NEGATIVE_CACHE_S
            raise JstexS3Error(self._cap_message())
        if resp.status_code in (401, 403):
            raise JstexS3Error(
                f"The S3 keys manager refused the request (HTTP {resp.status_code}); check that you are signed in to this profile."
            )
        if not resp.ok:
            raise JstexS3Error(f"S3 key request failed (HTTP {resp.status_code}).")
        body = resp.json()
        key = S3Key(
            str(body["access_id"]),
            str(body["secret"]),
            _parse_iso(body.get("expiration_date")) or now + KEY_TTL_S,
            now,
        )
        self._wait_until_active(key)
        return key

    def _cap_message(self) -> str:
        return "S3 key limit reached — remove unused keys in your platform's S3 keys manager, then retry."

    def _wait_until_active(self, key: S3Key) -> None:
        deadline = self._now() + PROPAGATION_BUDGET_S
        while self._probe(key) == "InvalidAccessKeyId":
            if self._now() >= deadline:
                return  # still unknown: the first real request re-mints once
            self._sleep(0.5)

    def _probe_s3(self, key: S3Key) -> str:
        """Signed ListObjectsV2 (max 1 key, top level) on the bucket; returns the error code or 'ok'."""
        import boto3
        from botocore.config import Config as BotoConfig
        from botocore.exceptions import BotoCoreError, ClientError

        client = boto3.client(
            "s3",
            endpoint_url=self.cfg.s3_endpoint,
            region_name=self.cfg.s3_region,
            aws_access_key_id=key.access_key,
            aws_secret_access_key=key.secret_key,
            config=BotoConfig(
                s3={"addressing_style": "path"}, retries={"max_attempts": 1}
            ),
        )
        try:
            client.list_objects_v2(Bucket=self.cfg.s3_bucket, MaxKeys=1, Delimiter="/")
            return "ok"
        except ClientError as err:
            return str(err.response.get("Error", {}).get("Code", ""))
        except BotoCoreError:
            return "error"

    def _delete_quietly(self, access_key: str) -> None:
        try:
            requests.delete(
                f"{self._base}/credentials/access_id/{quote(access_key, safe='')}",
                headers={"Authorization": f"Bearer {self._token()}"},
                timeout=HTTP_TIMEOUT_S,
            )
        except (requests.RequestException, JstexS3Error):
            pass  # an undeleted key frees its slot when it expires (8 h)


_managers: dict[tuple[str, str], KeyManager] = {}
_managers_lock = threading.Lock()


def manager(cfg: Config) -> KeyManager:
    with _managers_lock:
        key = (cfg.s3_keys_url or "", cfg.profile)
        if key not in _managers:
            _managers[key] = KeyManager(cfg)
        return _managers[key]


FRESH_KEY_S = 60  # a key this young that S3 does not know is still propagating


def _href(asset_or_href: Any) -> str | None:
    if isinstance(asset_or_href, str):
        return asset_or_href
    if isinstance(asset_or_href, dict):
        href, extra = asset_or_href.get("href"), asset_or_href
    else:  # pystac.Asset
        href, extra = asset_or_href.href, asset_or_href.extra_fields
    if href and href.startswith(("s3://", "/")):
        return href
    alt = ((extra.get("alternate") or {}).get("s3") or {}).get("href")
    return alt or href


def location(asset_or_href: Any) -> dict[str, str]:
    href = _href(asset_or_href) or ""
    if href.startswith("s3://"):
        path = href[5:]
    elif href.startswith("/"):
        path = href[1:]
    else:
        raise JstexS3Error(
            f"Not an S3 location: {href!r} (the asset has no s3:// href or alternate)."
        )
    bucket, _, key = path.partition("/")
    return {"Bucket": bucket, "Key": key}


def endpoint_for(asset: Any, cfg: Config) -> str:
    refs = (
        getattr(asset, "extra_fields", None)
        or (asset if isinstance(asset, dict) else {})
    ).get("storage:refs") or []
    owner = getattr(asset, "owner", None)
    schemes = (getattr(owner, "properties", None) or {}).get("storage:schemes") or {}
    for ref in refs:
        platform = (schemes.get(ref) or {}).get("platform", "")
        if (
            isinstance(platform, str)
            and platform.startswith("https://")
            and "{" not in platform
        ):
            return platform
    return str(cfg.s3_endpoint)


def _credentials(mgr):
    """botocore RefreshableCredentials fed by the KeyManager (refresh 1 h before expiry)."""
    from botocore.credentials import RefreshableCredentials

    def fetch() -> dict:
        key = mgr.credentials()
        return {
            "access_key": key.access_key,
            "secret_key": key.secret_key,
            "token": None,
            "expiry_time": dt.datetime.fromtimestamp(
                key.expires_at - RENEW_BELOW_S, dt.timezone.utc
            ).isoformat(),
        }

    return RefreshableCredentials.create_from_metadata(fetch(), fetch, "jstex")


def _force_refresh(creds) -> None:
    # botocore has no public "refresh now"; this is its own mandatory-refresh path.
    creds._protected_refresh(is_mandatory=True)


def _retry_unknown_key(mgr, creds):
    """needs-retry handler: on InvalidAccessKeyId from a non-fresh key, re-mint once."""

    def handler(response=None, attempts: int = 0, **_: Any):
        if response is None or attempts != 1:
            return None
        code = (response[1] or {}).get("Error", {}).get("Code")
        key = mgr.credentials()
        if code != "InvalidAccessKeyId" or time.time() - key.created_at < FRESH_KEY_S:
            return None
        mgr.invalidate(key)
        _force_refresh(creds)
        return 0  # retry immediately

    return handler


def session(*, profile: str | None = None):
    import boto3
    import botocore.session

    cfg = load_config(profile=profile)
    core = botocore.session.get_session()
    core._credentials = _credentials(manager(cfg))  # boto3 has no public setter
    return boto3.Session(botocore_session=core, region_name=cfg.s3_region)


def client(asset: Any = None, *, profile: str | None = None):
    from botocore.config import Config as BotoConfig

    cfg = load_config(profile=profile)
    mgr = manager(cfg)
    sess = session(profile=profile)
    c = sess.client(
        "s3",
        endpoint_url=endpoint_for(asset, cfg) if asset is not None else cfg.s3_endpoint,
        config=BotoConfig(s3={"addressing_style": "path"}, retries={"max_attempts": 3}),
    )
    c.meta.events.register(
        "needs-retry.s3", _retry_unknown_key(mgr, sess._session._credentials)
    )
    return c


def storage_options(asset: Any = None, *, profile: str | None = None) -> dict:
    """fsspec/s3fs options (static key, valid up to 8 h — call again for a new one)."""
    cfg = load_config(profile=profile)
    key = manager(cfg).credentials()
    endpoint = endpoint_for(asset, cfg) if asset is not None else cfg.s3_endpoint
    return {
        "key": key.access_key,
        "secret": key.secret_key,
        "client_kwargs": {"endpoint_url": endpoint, "region_name": cfg.s3_region},
        "config_kwargs": {"s3": {"addressing_style": "path"}},
    }


def gdal_env(asset: Any = None, *, profile: str | None = None) -> dict[str, str]:
    """GDAL/rasterio settings for /vsis3/ (static key, valid up to 8 h)."""
    cfg = load_config(profile=profile)
    key = manager(cfg).credentials()
    endpoint = endpoint_for(asset, cfg) if asset is not None else str(cfg.s3_endpoint)
    parts = urlsplit(endpoint)
    return {
        "AWS_ACCESS_KEY_ID": key.access_key,
        "AWS_SECRET_ACCESS_KEY": key.secret_key,
        "AWS_S3_ENDPOINT": parts.netloc,
        "AWS_HTTPS": "YES" if parts.scheme == "https" else "NO",
        "AWS_VIRTUAL_HOSTING": "FALSE",
        "AWS_DEFAULT_REGION": cfg.s3_region,
        "GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR",
    }


def write_aws_profile(name: str = "jstex", *, profile: str | None = None) -> Path:
    """Write the current key as AWS profile `name` (for R, Julia and the AWS CLI).
    The key is valid up to 8 h; call again for a new one. Other profiles are kept."""
    import configparser

    cfg = load_config(profile=profile)
    key = manager(cfg).credentials()
    creds_path = Path(
        os.environ.get("AWS_SHARED_CREDENTIALS_FILE")
        or Path.home() / ".aws" / "credentials"
    )
    conf_path = Path(
        os.environ.get("AWS_CONFIG_FILE") or Path.home() / ".aws" / "config"
    )
    creds_path.parent.mkdir(parents=True, exist_ok=True)
    conf_path.parent.mkdir(parents=True, exist_ok=True)
    creds = configparser.ConfigParser()
    creds.read(creds_path)
    creds[name] = {
        "aws_access_key_id": key.access_key,
        "aws_secret_access_key": key.secret_key,
    }
    fd = os.open(creds_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as fh:
        creds.write(fh)
    os.chmod(creds_path, 0o600)
    conf = configparser.ConfigParser()
    conf.read(conf_path)
    conf[f"profile {name}"] = {
        "endpoint_url": str(cfg.s3_endpoint),
        "region": cfg.s3_region,
        "s3": "\naddressing_style = path",
    }
    with conf_path.open("w") as fh:
        conf.write(fh)
    return creds_path
