# jstex

[![Github Actions Status](https://github.com/alek-cesarz/jstex/workflows/Build/badge.svg)](https://github.com/alek-cesarz/jstex/actions/workflows/build.yml)

STEX-light: STAC explorer widget for JupyterLab

This extension is composed of a Python package named `jstex`
for the server extension and a NPM package named `@jstex/labextension`
for the frontend extension.

## Requirements

- JupyterLab >= 4.0.0

## Install

To install the extension, execute:

```bash
pip install jstex
```

## Uninstall

To remove the extension, execute:

```bash
pip uninstall jstex
```

## Troubleshoot

If you are seeing the frontend extension, but it is not working, check
that the server extension is enabled:

```bash
jupyter server extension list
```

If the server extension is installed and enabled, but you are not seeing
the frontend extension, check the frontend extension is installed:

```bash
jupyter labextension list
```

## Contributing

If you would like to contribute to this extension, please refer to the [Contributing Guide](CONTRIBUTING.md).
