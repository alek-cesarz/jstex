import calendar
import configparser
import datetime as dt
import json
import os
import stat
import threading
import time

import boto3
import pystac
import pytest
import responses

from jstex import s3
from jstex.config import load_config
from jstex.s3 import KEY_TTL_S, JstexS3Error, KeyManager, S3Key, keys_path
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


class FakeManager:
    def __init__(self, created_at=None):
        self.key = S3Key(
            "AK", "SK", time.time() + 7 * 3600, created_at or time.time() - 3600
        )
        self.invalidated = []

    def credentials(self):
        return self.key

    def invalidate(self, key):
        self.invalidated.append(key.access_key)
        self.key = S3Key("AK2", "SK2", time.time() + 8 * 3600, time.time())
        return self.key


@pytest.fixture
def fake(monkeypatch):
    m = FakeManager()
    monkeypatch.setattr(s3, "manager", lambda cfg: m)
    return m


def test_location_from_hrefs_alternates_and_dicts():
    assert s3.location("s3://eodata/Sentinel-2/a.jp2") == {
        "Bucket": "eodata",
        "Key": "Sentinel-2/a.jp2",
    }
    assert s3.location("/eodata/Sentinel-2/a.jp2") == {
        "Bucket": "eodata",
        "Key": "Sentinel-2/a.jp2",
    }
    asset = pystac.Asset(
        "https://download.example/a.jp2",
        extra_fields={"alternate": {"s3": {"href": "s3://eodata/x/a.jp2"}}},
    )
    assert s3.location(asset) == {"Bucket": "eodata", "Key": "x/a.jp2"}
    assert s3.location({"href": "s3://b/k"}) == {"Bucket": "b", "Key": "k"}
    with pytest.raises(s3.JstexS3Error, match="S3"):
        s3.location("https://download.example/a.jp2")


def test_endpoint_from_storage_schemes():
    cfg = load_config()
    item = pystac.Item(
        "i",
        None,
        None,
        dt.datetime(2024, 1, 1, tzinfo=dt.timezone.utc),
        {
            "storage:schemes": {
                "cdse": {"type": "custom-s3", "platform": "https://eodata.example.eu"}
            }
        },
    )
    asset = pystac.Asset("s3://eodata/k", extra_fields={"storage:refs": ["cdse"]})
    item.add_asset("B04", asset)
    assert s3.endpoint_for(asset, cfg) == "https://eodata.example.eu"
    assert s3.endpoint_for(pystac.Asset("s3://eodata/k"), cfg) == cfg.s3_endpoint


def test_gdal_env_and_storage_options(fake):
    env = s3.gdal_env()
    assert env["AWS_ACCESS_KEY_ID"] == "AK" and env["AWS_SECRET_ACCESS_KEY"] == "SK"
    assert env["AWS_S3_ENDPOINT"] == "eodata.dataspace.copernicus.eu"
    assert env["AWS_VIRTUAL_HOSTING"] == "FALSE" and env["AWS_HTTPS"] == "YES"
    opts = s3.storage_options()
    assert (
        opts["key"] == "AK"
        and opts["client_kwargs"]["endpoint_url"]
        == "https://eodata.dataspace.copernicus.eu"
    )


def test_client_reads_with_refreshing_credentials(fake, monkeypatch):
    from moto import mock_aws

    monkeypatch.setenv(
        "MOTO_S3_CUSTOM_ENDPOINTS", "https://eodata.dataspace.copernicus.eu"
    )
    monkeypatch.setenv(
        "JSTEX_S3_REGION", "us-east-1"
    )  # moto needs a real AWS region name
    with mock_aws():
        raw = boto3.client(
            "s3",
            endpoint_url="https://eodata.dataspace.copernicus.eu",
            region_name="us-east-1",
        )
        raw.create_bucket(Bucket="eodata")
        raw.put_object(Bucket="eodata", Key="x/a.txt", Body=b"hello")
        c = s3.client()
        assert (
            c.get_object(**s3.location("s3://eodata/x/a.txt"))["Body"].read()
            == b"hello"
        )


def test_unknown_key_on_an_old_key_re_mints_once(fake):
    handler = s3._retry_unknown_key(fake, s3._credentials(fake))
    response = (None, {"Error": {"Code": "InvalidAccessKeyId"}})
    assert handler(response=response, attempts=1) == 0  # retry now, with a new key
    assert fake.invalidated == ["AK"]
    assert handler(response=response, attempts=2) is None  # only once


def test_unknown_key_on_a_fresh_key_is_not_re_minted(monkeypatch):
    m = FakeManager(created_at=time.time())
    handler = s3._retry_unknown_key(m, s3._credentials(m))
    assert (
        handler(response=(None, {"Error": {"Code": "InvalidAccessKeyId"}}), attempts=1)
        is None
    )
    assert m.invalidated == []


def test_write_aws_profile_keeps_other_profiles(fake, tmp_path, monkeypatch):
    creds_file, conf_file = tmp_path / "credentials", tmp_path / "config"
    monkeypatch.setenv("AWS_SHARED_CREDENTIALS_FILE", str(creds_file))
    monkeypatch.setenv("AWS_CONFIG_FILE", str(conf_file))
    creds_file.write_text("[other]\naws_access_key_id = X\naws_secret_access_key = Y\n")
    s3.write_aws_profile("jstex")
    creds = configparser.ConfigParser()
    creds.read(creds_file)
    assert creds["other"]["aws_access_key_id"] == "X"
    assert creds["jstex"]["aws_access_key_id"] == "AK"
    conf = configparser.ConfigParser()
    conf.read(conf_file)
    assert (
        conf["profile jstex"]["endpoint_url"]
        == "https://eodata.dataspace.copernicus.eu"
    )
    assert stat.S_IMODE(os.stat(creds_file).st_mode) == 0o600
