import inspect

from jstex import config as config_module
from jstex.config import (
    DEFAULT_BASEMAP_ATTRIBUTION,
    DEFAULT_BASEMAP_URL,
    DEFAULT_STAC_URL,
    Basemap,
    load_config,
)


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
