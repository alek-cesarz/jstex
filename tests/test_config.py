import inspect

import pytest

from jstex import config as config_mod
from jstex import config as config_module
from jstex.config import (
    DEFAULT_BASEMAP_ATTRIBUTION,
    DEFAULT_BASEMAP_URL,
    DEFAULT_STAC_URL,
    Basemap,
    ConfigView,
    load_config,
    save_login_client_id,
    user_config_path,
)
from jstex.errors import JstexError
from jstex.profiles import JstexProfileError


def test_defaults():
    cfg = load_config()
    assert (
        cfg.stac_url
        == DEFAULT_STAC_URL
        == "https://stac.opensearch.dataspace.copernicus.eu/v1/"
    )
    assert cfg.stex_url is None
    # OpenFreeMap Positron (vector style, no key) in both themes.
    assert (
        cfg.basemap_light.url
        == cfg.basemap_dark.url
        == DEFAULT_BASEMAP_URL
        == "https://tiles.openfreemap.org/styles/positron"
    )
    assert cfg.basemap_light.kind == cfg.basemap_dark.kind == "style"
    assert "OpenFreeMap" in DEFAULT_BASEMAP_ATTRIBUTION
    assert cfg.basemap_light.attribution == DEFAULT_BASEMAP_ATTRIBUTION


def test_no_carto_or_stadia_defaults_left():
    source = inspect.getsource(config_module).lower()
    assert "carto" not in source and "stadia" not in source


def test_env_overrides_default_and_gets_trailing_slash(monkeypatch):
    monkeypatch.setenv("JSTEX_STAC_URL", "https://stac.example.org/api")
    monkeypatch.setenv("JSTEX_STEX_URL", "https://stex.example.org/")
    cfg = load_config()
    assert cfg.stac_url == "https://stac.example.org/api/"
    assert cfg.stex_url == "https://stex.example.org/"


def test_kwargs_override_env(monkeypatch):
    monkeypatch.setenv("JSTEX_STAC_URL", "https://env.example.org/")
    assert (
        load_config(stac_url="https://kw.example.org/").stac_url
        == "https://kw.example.org/"
    )


def test_basemap_kind_and_key():
    xyz = Basemap(
        "https://t.example.org/{z}/{x}/{y}{r}.png?style=a", key="K", key_param="api_key"
    )
    assert xyz.kind == "xyz"
    assert (
        xyz.tile_url(retina=False)
        == "https://t.example.org/{z}/{x}/{y}.png?style=a&api_key=K"
    )
    assert (
        xyz.tile_url() == "https://t.example.org/{z}/{x}/{y}@2x.png?style=a&api_key=K"
    )
    style = Basemap("https://maps.example.org/styles/basic/style.json", key="K")
    assert style.kind == "style"
    assert style.tile_url() == "https://maps.example.org/styles/basic/style.json?key=K"
    assert "K" not in repr(xyz)


def test_basemap_env(monkeypatch):
    monkeypatch.setenv(
        "JSTEX_BASEMAP_DARK_URL", "https://tiles.example.org/{z}/{x}/{y}.png"
    )
    monkeypatch.setenv("JSTEX_BASEMAP_DARK_KEY", "secret")
    monkeypatch.setenv("JSTEX_BASEMAP_DARK_KEY_PARAM", "api_key")
    monkeypatch.setenv("JSTEX_BASEMAP_DARK_ATTRIBUTION", "© Example")
    cfg = load_config()
    assert cfg.basemap_dark.kind == "xyz"
    assert (
        cfg.basemap_dark.tile_url()
        == "https://tiles.example.org/{z}/{x}/{y}.png?api_key=secret"
    )
    assert cfg.basemap_dark.attribution == "© Example"
    assert cfg.basemap_light.url == DEFAULT_BASEMAP_URL


CDSE_ISSUER = "https://identity.dataspace.copernicus.eu/auth/realms/CDSE"


def write_user_config(text: str):
    path = user_config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    return path


def test_default_profile_is_cdse_opensearch():
    cfg = load_config()
    assert cfg.profile == "cdse-opensearch"
    assert cfg.stac_url == DEFAULT_STAC_URL
    assert cfg.issuer == CDSE_ISSUER
    assert cfg.password_client_id == "cdse-public" and cfg.password_login is True
    assert cfg.s3_bucket == "eodata"
    assert cfg.sources["stac_url"] == "packaged"


def test_profile_from_env_and_unknown_profile(monkeypatch):
    monkeypatch.setenv("JSTEX_PROFILE", "codede")
    cfg = load_config()
    assert cfg.stac_url == "https://stac.code-de.org/v1/"
    assert cfg.issuer == "https://identity.cloudferro.com/auth/realms/CODE-DE3"
    with pytest.raises(JstexProfileError, match="Available"):
        load_config(profile="nope")


def test_own_profile_in_user_config_may_use_http():
    write_user_config(
        'profile = "lab"\n[profiles.lab]\nstac_url = "http://localhost:8080/v1"\ns3_bucket = "data"\n'
    )
    cfg = load_config()
    assert (cfg.profile, cfg.stac_url, cfg.s3_bucket) == (
        "lab",
        "http://localhost:8080/v1/",
        "data",
    )
    assert cfg.issuer is None
    assert cfg.sources["stac_url"].endswith("config.toml")


def test_user_file_overrides_a_ready_made_profile_and_system_file(
    monkeypatch, tmp_path
):
    system = tmp_path / "etc-config.toml"
    system.write_text(
        '[profiles.cdse-opensearch]\nstex_url = "https://sys.example/"\ns3_bucket = "sys"\n'
    )
    monkeypatch.setattr(config_mod, "SYSTEM_CONFIG", system)
    write_user_config('[profiles.cdse-opensearch]\nstex_url = "https://me.example/"\n')
    cfg = load_config()
    assert cfg.stex_url == "https://me.example/"
    assert cfg.s3_bucket == "sys"
    assert cfg.issuer == CDSE_ISSUER  # untouched fields still come from the profile


def test_env_beats_files_and_arguments_beat_env(monkeypatch):
    write_user_config('[profiles.cdse-opensearch]\ns3_bucket = "file"\n')
    monkeypatch.setenv("JSTEX_S3_BUCKET", "env")
    monkeypatch.setenv("JSTEX_PASSWORD_LOGIN", "0")
    assert load_config().s3_bucket == "env"
    assert load_config().password_login is False
    cfg = load_config(s3_bucket="arg")
    assert cfg.s3_bucket == "arg" and cfg.sources["s3_bucket"] == "argument"


def test_profile_none_needs_a_stac_url(monkeypatch):
    with pytest.raises(JstexError, match="stac_url"):
        load_config(profile="none")
    monkeypatch.setenv("JSTEX_STAC_URL", "https://stac.example.org/v1")
    cfg = load_config(profile="none")
    assert cfg.profile == "none" and cfg.issuer is None


def test_broken_config_file_is_ignored_with_one_warning():
    write_user_config("profile = \n")
    with pytest.warns(UserWarning, match="config.toml"):
        cfg = load_config()
    assert cfg.profile == "cdse-opensearch"


def test_unknown_override_is_a_type_error():
    with pytest.raises(TypeError, match="colour"):
        load_config(colour="red")


def test_save_login_client_id():
    path = save_login_client_id("cdse-opensearch", "dev-client")
    assert 'login_client_id = "dev-client"' in path.read_text()
    assert load_config().login_client_id == "dev-client"
    save_login_client_id("codede", "other")  # appends a new table
    assert load_config(profile="codede").login_client_id == "other"
    with pytest.raises(JstexError, match="edit"):
        save_login_client_id(
            "codede", "third"
        )  # table exists: never rewrite a user's file


def test_config_view_shows_values_and_sources():
    view = ConfigView(load_config(s3_bucket="x"))
    rows = {name: (value, source) for name, value, source in view.rows()}
    assert rows["s3_bucket"] == ("x", "argument")
    assert rows["stac_url"][1] == "packaged"
    assert "s3_bucket" in repr(view) and "<table" in view._repr_html_()


def test_stac_override_on_another_host_drops_the_profile_identity(monkeypatch):
    # Review I-3: the CDSE token must not follow a STAC override to another host.
    with pytest.warns(UserWarning, match="identity service"):
        cfg = load_config(stac_url="https://earth-search.aws.element84.com/v1")
    assert cfg.issuer is None
    same_host = load_config(
        stac_url="https://stac.opensearch.dataspace.copernicus.eu/v1/other"
    )
    assert same_host.issuer is not None
    explicit = load_config(
        stac_url="https://stac.example.org/v1", issuer="https://id.example.org/r"
    )
    assert explicit.issuer == "https://id.example.org/r"
    monkeypatch.setenv("JSTEX_STAC_URL", "https://stac.example.org/v1")
    monkeypatch.setenv("JSTEX_OIDC_ISSUER", "https://id.example.org/r")
    assert load_config().issuer == "https://id.example.org/r"
