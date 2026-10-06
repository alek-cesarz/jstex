import calendar
import json
import os
import stat
import threading
import time

import pytest
import responses

from jstex.config import load_config
from jstex.s3 import KEY_TTL_S, JstexS3Error, KeyManager, keys_path
from tests.conftest import make_jwt

KEYS = "https://s3-keys-manager.cloudferro.com/api/user"


@pytest.fixture
def cfg(monkeypatch):
    monkeypatch.setenv("JSTEX_ACCESS_TOKEN", make_jwt(time.time() + 3600))
    return load_config()  # cdse-opensearch: keys manager, endpoint, bucket


def created(access="AK1", hours=8):
    exp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + hours * 3600))
    return {"access_id": access, "secret": "SECRET-" + access, "expiration_date": exp}


def mgr(cfg, **kw):
    kw.setdefault("probe", lambda key: "ok")
    kw.setdefault("sleep", lambda s: None)
    return KeyManager(cfg, **kw)


@responses.activate
def test_key_is_created_for_8_hours_and_reused(cfg):
    responses.post(KEYS + "/credentials", json=created())
    m = mgr(cfg)
    key = m.credentials()
    assert key.access_key == "AK1" and "SECRET" not in repr(key)
    sent = json.loads(responses.calls[0].request.body)
    asked = calendar.timegm(
        time.strptime(sent["expiration_date"], "%Y-%m-%dT%H:%M:%SZ")
    )
    assert abs(asked - (time.time() + KEY_TTL_S)) < 60
    assert responses.calls[0].request.headers["Authorization"].startswith("Bearer ")
    assert m.credentials() == key
    assert len(responses.calls) == 1
    assert stat.S_IMODE(os.stat(keys_path()).st_mode) == 0o600


@responses.activate
def test_key_close_to_expiry_is_renewed_and_the_old_one_deleted(cfg):
    responses.post(KEYS + "/credentials", json=created("AK1", hours=0.5))
    responses.delete(KEYS + "/credentials/access_id/AK1", status=204)
    first = mgr(cfg).credentials()
    responses.replace(responses.POST, KEYS + "/credentials", json=created("AK2"))
    second = mgr(cfg).credentials()
    assert (first.access_key, second.access_key) == ("AK1", "AK2")
    assert any(c.request.method == "DELETE" for c in responses.calls)


@responses.activate
def test_key_that_expired_overnight_is_renewed_before_use(cfg):
    responses.post(KEYS + "/credentials", json=created("AK1"))
    m = mgr(cfg)
    m.credentials()
    data = json.loads(keys_path().read_text())
    for entry in data.values():
        entry["expires_at"] = time.time() - 60
    keys_path().write_text(json.dumps(data))
    responses.replace(responses.POST, KEYS + "/credentials", json=created("AK2"))
    responses.delete(KEYS + "/credentials/access_id/AK1", status=404)
    assert mgr(cfg).credentials().access_key == "AK2"


@responses.activate
def test_key_cap_is_reported_and_negative_cached(cfg):
    responses.post(
        KEYS + "/credentials",
        status=403,
        json={"detail": "Max number of credentials reached."},
    )
    m = mgr(cfg)
    with pytest.raises(JstexS3Error, match="limit"):
        m.credentials()
    with pytest.raises(JstexS3Error, match="limit"):
        m.credentials()
    assert len(responses.calls) == 1


@responses.activate
def test_new_key_waits_for_propagation(cfg):
    responses.post(KEYS + "/credentials", json=created())
    answers = iter(["InvalidAccessKeyId", "InvalidAccessKeyId", "ok"])
    sleeps = []
    mgr(cfg, probe=lambda key: next(answers), sleep=sleeps.append).credentials()
    assert len(sleeps) == 2


@responses.activate
def test_invalidate_drops_the_key_and_creates_one_new(cfg):
    responses.post(KEYS + "/credentials", json=created("AK1"))
    m = mgr(cfg)
    old = m.credentials()
    responses.replace(responses.POST, KEYS + "/credentials", json=created("AK2"))
    assert m.invalidate(old).access_key == "AK2"


def test_unconfigured_profile_and_anonymous_user(monkeypatch):
    with pytest.raises(JstexS3Error, match="not configured"):
        KeyManager(load_config(profile="codede"))
    with pytest.raises(JstexS3Error, match="Sign in"):
        mgr(load_config()).credentials()


@responses.activate
def test_concurrent_kernels_create_one_key(cfg):
    responses.post(KEYS + "/credentials", json=created())
    results = []

    def run():
        results.append(mgr(cfg).credentials().access_key)

    threads = [threading.Thread(target=run) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert results == ["AK1"] * 4
    assert len([c for c in responses.calls if c.request.method == "POST"]) == 1
