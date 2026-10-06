"""Stored login sessions: one refresh token per issuer (spec §4)."""

from __future__ import annotations

import json
import os
import tempfile
from dataclasses import asdict, dataclass, field
from pathlib import Path


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
        data = self._load()
        data[issuer.rstrip("/")] = asdict(session)
        self._save(data)

    def drop(self, issuer: str) -> None:
        data = self._load()
        if data.pop(issuer.rstrip("/"), None) is not None:
            self._save(data)
