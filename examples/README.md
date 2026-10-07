# jstex examples

Notebooks that use jstex to find Sentinel-2 L2A data over Lake Garda (July 2024) and work with it. Each starts the same way: open the explorer, check how you are signed in (`ex.whoami()`), then either pick an item in the widget or run the search cell.

- **[01-download.ipynb](01-download.ipynb)**: download selected assets over S3 (`ex.s3.client()`) and over HTTPS with your access token (`ex.access_token()`), then a complete product (every file under its S3 folder). Needs `jupyterlab-jstex[s3]`.
- **[02-ndvi-gdal.ipynb](02-ndvi-gdal.ipynb)**: Sentinel-2 NDVI with GDAL. Reads the red and near-infrared bands directly from S3 through `/vsis3/` (`ex.s3.gdal_env()`), crops them to the area of interest, applies the STAC scale and offset, and writes a Cloud-Optimised GeoTIFF. Needs the GDAL Python bindings, numpy and matplotlib.
- **[03-xarray.ipynb](03-xarray.ipynb)**: opens bands lazily with rioxarray, masks clouds with the scene classification (SCL), and plots an NDVI time series and a median map. Needs rioxarray, xarray, pandas and matplotlib (dask for larger areas).

The notebooks are stored **without outputs**, so no token, key or personal data reaches git; CI checks this with `python scripts/check_notebooks.py`.

## Running them

```bash
pip install -r examples/requirements.txt   # plus GDAL for 02, see below
jupyter lab examples/
```

GDAL's Python bindings (`osgeo`, notebook 02) are not on PyPI as wheels. Use
conda (`conda install -c conda-forge gdal`), or build them against the
system GDAL:

```bash
sudo apt install libgdal-dev python3-dev
pip install --no-build-isolation "gdal==$(gdal-config --version)"
```

S3 and HTTPS downloads need a CDSE account. On a JupyterHub that signs you in with CDSE there is nothing to do; elsewhere click **Sign in** in the widget or run `jstex.login()`.
