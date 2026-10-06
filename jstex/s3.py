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
from urllib.parse import quote

import requests

from . import auth, oidc
from .config import Config
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
