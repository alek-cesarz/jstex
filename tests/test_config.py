from jstex.config import (
    DEFAULT_BASEMAP_DARK_URL,
    DEFAULT_BASEMAP_LIGHT_URL,
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
    assert cfg.basemap_light.url == DEFAULT_BASEMAP_LIGHT_URL
    assert cfg.basemap_dark.url == DEFAULT_BASEMAP_DARK_URL


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


def test_basemap_tile_url_matches_stex_rules():
    assert (
        load_config().basemap_light.tile_url()
        == "https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png"
    )
    b = Basemap(
        "https://t.example.org/{z}/{x}/{y}{r}.png?style=a", key="K", key_param="api_key"
    )
    assert (
        b.tile_url(retina=False)
        == "https://t.example.org/{z}/{x}/{y}.png?style=a&api_key=K"
    )
    assert "K" not in repr(b)


def test_basemap_env(monkeypatch):
    monkeypatch.setenv("JSTEX_BASEMAP_DARK_KEY", "secret")
    monkeypatch.setenv(
        "JSTEX_BASEMAP_LIGHT_URL", "https://tiles.example.org/{z}/{x}/{y}.png"
    )
    cfg = load_config()
    assert cfg.basemap_dark.tile_url().endswith("@2x.png?api_key=secret")
    assert cfg.basemap_light.tile_url() == "https://tiles.example.org/{z}/{x}/{y}.png"
