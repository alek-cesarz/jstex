"""Stored login sessions: one refresh token per issuer (spec §4)."""

from __future__ import annotations

import json
import os
import tempfile
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import asdict, dataclass, field
from pathlib import Path

try:
    import fcntl
except ImportError:  # Windows: kernels are serialised within a process only
    fcntl = None  # type: ignore[assignment]


def data_dir() -> Path:
    base = os.environ.get("XDG_DATA_HOME") or str(Path.home() / ".local" / "share")
    return Path(base) / "jstex"


@dataclass
class Session:
    client_id: str
    refresh_token: str = field(repr=False)
    refresh_expires_at: float | None
    method: str  # "device" | "password"


class SessionStore:
    def __init__(self, path: Path | None = None):
        self.path = path or data_dir() / "sessions.json"
        self._rlock = threading.RLock()
        self._depth = 0
        self._fh = None

    @contextmanager
    def locked(self) -> Iterator[None]:
        """Exclusive access across kernels (an flock on `sessions.json.lock`);
        re-entrant within this store, so put/drop work inside it."""
        with self._rlock:
            if self._depth == 0:
                self.path.parent.mkdir(parents=True, exist_ok=True)
                os.chmod(self.path.parent, 0o700)
                fh = open(str(self.path) + ".lock", "a")  # noqa: SIM115 - held until unlock
                if fcntl is not None:
                    fcntl.flock(fh, fcntl.LOCK_EX)
                self._fh = fh
            self._depth += 1
            try:
                yield
            finally:
                self._depth -= 1
                if self._depth == 0 and self._fh is not None:
                    if fcntl is not None:
                        fcntl.flock(self._fh, fcntl.LOCK_UN)
                    self._fh.close()
                    self._fh = None

    def _load(self) -> dict:
        try:
            data = json.loads(self.path.read_text())
            return data if isinstance(data, dict) else {}
        except (OSError, ValueError):
            return {}

    def _save(self, data: dict) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        os.chmod(self.path.parent, 0o700)
        fd, tmp = tempfile.mkstemp(dir=self.path.parent, suffix=".tmp")  # created 0600
        try:
            with os.fdopen(fd, "w") as fh:
                json.dump(data, fh)
            os.replace(tmp, self.path)
        except BaseException:
            Path(tmp).unlink(missing_ok=True)
            raise

    def get(self, issuer: str) -> Session | None:
        entry = self._load().get(issuer.rstrip("/"))
        try:
            return Session(**entry) if isinstance(entry, dict) else None
        except TypeError:
            return None

    def put(self, issuer: str, session: Session) -> None:
        with self.locked():
            data = self._load()
            data[issuer.rstrip("/")] = asdict(session)
            self._save(data)

    def drop(self, issuer: str, *, refresh_token: str | None = None) -> None:
        """Forget the session; with `refresh_token`, only if it is still that one
        (another kernel may have stored a newer one meanwhile)."""
        with self.locked():
            data = self._load()
            entry = data.get(issuer.rstrip("/"))
            if entry is None:
                return
            if refresh_token is not None and (
                not isinstance(entry, dict)
                or entry.get("refresh_token") != refresh_token
            ):
                return
            del data[issuer.rstrip("/")]
            self._save(data)
