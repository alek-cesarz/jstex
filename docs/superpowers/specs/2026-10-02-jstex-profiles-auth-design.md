# Design — jstex profiles, login and S3 keys (v0.2 base)

**Date:** 2026-10-02 · **Status:** approved in conversation, awaiting written review
**Extends:** `2026-09-29-jstex-jupyterlab-design.md` (§6 S3, §13 v0.2 split).
**Target:** jupyterlab-jstex `v0.2.0` (base part).

## 1. Goal

Users choose a ready-made **profile** (CDSE, CREODIAS, CODE-DE) instead of
setting a dozen environment variables, can override any value or define their
own profile (e.g. a private STAC catalogue with its own S3 storage), and get a
token without JupyterHub (local JupyterLab) through jstex's own login.
S3 key management (§6 of the main spec) is built on top.

**Out of scope:** a browser-redirect (STEX-like) login, downloads, eosdk
components (§8), switching profiles from the widget UI.

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| P1 | The term is **profile** (not "platform"). | A user may point jstex at a private catalogue + S3 storage; "platform" means nothing there. |
| P2 | Profile values are merged per field: **GitHub profile → discovery document → manual config** (later wins). | Discovery (`eo-services.json`) is authoritative where a platform publishes it (CDSE today); the GitHub file fills the gaps until CREODIAS and CODE-DE publish theirs. |
| P3 | The GitHub file uses the **`eo-services.json` structure** plus a `jstex` block. | One vocabulary with CloudFerro's eosdk and the platforms' own discovery documents. |
| P4 | Two CDSE profiles: `cdse` (discovery catalogue `stac.dataspace.copernicus.eu/v1`) and `cdse-opensearch` (pinned `stac.opensearch.dataspace.copernicus.eu/v1`). Default profile: **`cdse-opensearch`**. | The catalogues differ (item ids, collections, queryables); the default keeps v0.1 behaviour. |
| P5 | Token chain: **manual token → JupyterHub → stored session → device code → password → anonymous**. Device code and password run only on user action. | User decision; hub and manual paths stay zero-click, interactive login never blocks a cell unasked. |
| P6 | Device code uses a **device-enabled public client** (device grant + PKCE + refresh) whose id may differ per realm. It is a field of its own, `login_client_id`, resolved from the GitHub profile, the discovery document (`services.auth.device_client_id`), manual config, or entered interactively at sign-in (§4.2). It is never taken from `services.auth.client_id`. Password uses `services.auth.client_id` (e.g. `cdse-public`). | `cdse-public`/`code-de3-public` refuse the device grant (`unauthorized_client`, verified 2026-10-01); CDSE's discovery names `cdse-public`. The operator chooses the device client's name. |
| P8 | v0.2 ships **sample notebooks**: downloading data (selected assets, complete product), Sentinel-2 NDVI with GDAL, working with xarray (§11). | Show the intended end-to-end use: find with jstex, then work with the data in code. |
| P7 | S3 keys: **own port of the STEX policy** (option b); no eosdk components until they manage credentials better (§8). | eosdk sets no key lifetime, has no renewal, no cross-process lock and no re-mint on rejection. |

## 3. Profiles

### 3.1 Registry file (GitHub)

`jstex/data/profiles.json` in the jstex repository — package data, so the
same file is also the offline fallback. Default registry URL:
`https://raw.githubusercontent.com/alek-cesarz/jstex/main/jstex/data/profiles.json`.

```json
{
  "version": "1.0",
  "profiles": {
    "cdse-opensearch": {
      "discovery": "https://discover.dataspace.copernicus.eu",
      "pinned": ["services.catalogue.stac.url"],
      "platform": { "name": "cdse", "description": "Copernicus Data Space Ecosystem (OpenSearch STAC)" },
      "services": {
        "catalogue": { "stac": { "url": "https://stac.opensearch.dataspace.copernicus.eu/v1" } },
        "data_access": {
          "s3": {
            "endpoint": "https://eodata.dataspace.copernicus.eu",
            "region": "default",
            "credentials": { "url": "https://s3-keys-manager.cloudferro.com/api/user" }
          }
        },
        "auth": {
          "issuer": "https://identity.dataspace.copernicus.eu/auth/realms/CDSE",
          "client_id": "cdse-public"
        }
      },
      "jstex": {
        "login_client_id": "<device-enabled client id for the CDSE realm>",
        "password_login": true,
        "s3_bucket": "eodata",
        "stex_url": null
      }
    },
    "cdse": { "…": "as above, without `pinned`; STAC from discovery (stac.dataspace.copernicus.eu/v1)" },
    "creodias": {
      "…": "no discovery yet; STAC https://stac.creodias.eu/v1, issuer https://identity.cloudferro.com/auth/realms/Creodias-new; S3 values from the maintainer (§10)"
    },
    "codede": {
      "…": "no discovery yet; STAC https://stac.code-de.org/v1, issuer https://identity.cloudferro.com/auth/realms/CODE-DE3, password client code-de3-public; S3 values from the maintainer (§10)"
    }
  }
}
```

- `discovery` (optional): root URL; jstex reads `<root>/.well-known/eo-services.json`.
- `pinned` (optional): dotted paths discovery may not override (used for P4).
- `jstex` block — fields the current `eo-services.json` schema does not define:
  `login_client_id` (device code; discovery may supply it as
  `services.auth.device_client_id`, §4.2), `password_login` (bool; whether
  `services.auth.client_id` allows the password grant), `s3_bucket`,
  `stex_url`, `offline_access` (bool, default false; request the
  `offline_access` scope so stored sessions outlive the SSO session —
  only where the realm allows it), `basemap` (optional `{light, dark}`,
  same shape as the existing basemap config).
- Any field may be missing; the feature that needs it reports what is missing.

### 3.2 Effective configuration

Fields jstex uses, and their sources:

| Field | eo-services path / jstex block | Env var |
|---|---|---|
| `stac_url` | `services.catalogue.stac.url` | `JSTEX_STAC_URL` (exists) |
| `issuer` | `services.auth.issuer` | `JSTEX_OIDC_ISSUER` |
| `password_client_id` | `services.auth.client_id` | `JSTEX_PASSWORD_CLIENT_ID` |
| `login_client_id` | `services.auth.device_client_id` (discovery), `jstex.login_client_id` (GitHub) | `JSTEX_LOGIN_CLIENT_ID` |
| `password_login` | `jstex.password_login` | `JSTEX_PASSWORD_LOGIN` |
| `offline_access` | `jstex.offline_access` | `JSTEX_OFFLINE_ACCESS` |
| `s3_endpoint` | `services.data_access.s3.endpoint` | `JSTEX_S3_ENDPOINT` |
| `s3_region` | `services.data_access.s3.region` | `JSTEX_S3_REGION` |
| `s3_keys_url` | `services.data_access.s3.credentials.url` | `JSTEX_S3_KEYS_URL` |
| `s3_bucket` | `jstex.s3_bucket` | `JSTEX_S3_BUCKET` |
| `stex_url` | `jstex.stex_url` | `JSTEX_STEX_URL` (exists) |
| basemaps | `jstex.basemap` | `JSTEX_BASEMAP_{LIGHT,DARK}_*` (exist) |

Merge order per field (later wins):

1. GitHub profile (registry → cache → packaged copy, §3.4);
2. discovery document, except `pinned` paths;
3. `/etc/jstex/config.toml`, then `~/.config/jstex/config.toml`;
4. `JSTEX_*` environment variables;
5. Python arguments (`jstex.Explorer(profile=…, stac_url=…)`, `jstex.item(…, profile=…)`).

URLs are normalised (STAC URL with a trailing slash).

### 3.3 Selecting a profile and manual config

Profile: `profile=` argument → `JSTEX_PROFILE` → `profile =` in the config
files → default `cdse-opensearch`. `profile = "none"` loads no ready-made
profile; then at least `stac_url` must come from manual config.

Manual config uses **flat field names** (table in §3.2):

```toml
# ~/.config/jstex/config.toml
profile = "my-catalogue"

[profiles.my-catalogue]            # own profile; may also set `discovery`
stac_url = "https://stac.example.org/v1/"
issuer = "https://id.example.org/auth/realms/example"
login_client_id = "my-device-client"
s3_endpoint = "https://s3.example.org"
s3_keys_url = "https://keys.example.org/api/user"
s3_bucket = "data"

[profiles.cdse-opensearch]         # same name as a ready-made one: overrides its fields
stex_url = "https://stex.example.org/"
```

TOML is read with `tomllib` (`tomli` on Python 3.10, new dependency
`tomli; python_version < "3.11"`).

### 3.4 Fetching, caching, validation

- Registry and discovery are fetched at most once per kernel, 3 s timeout each,
  without blocking the widget's first render (fetched in the worker that loads
  collections).
- Disk cache `~/.cache/jstex/` (`profiles.json`, `discovery/<sha256(url)>.json`),
  reused for 24 h and used as fallback when a fetch fails; last fallback for the
  registry is the packaged file. Discovery has no packaged fallback (the GitHub
  profile is the baseline).
- Validation: JSON Schema for the registry (shipped, used in tests and CI) and a
  light runtime check; every URL must be `https`. An invalid profile or
  discovery document is skipped with one warning, never fatal.
- `JSTEX_PROFILES_URL`: other registry URL, or `builtin` for no network
  (packaged registry only, no discovery).

### 3.5 `jstex.show_config()` and `jstex.list_profiles()`

- `jstex.list_profiles()` (not `jstex.profiles()`: that name is the `jstex.profiles` submodule) lists available profile names with their description and
  source (registry, cache, packaged, config file).
- `jstex.show_config(profile=None)` (not `jstex.config()`: that name is the `jstex.config` submodule) returns the effective configuration; its
  notebook repr is a table of field, value, source (`github`, `cache`,
  `packaged`, `discovery`, `/etc/…`, `~/.config/…`, `env`, `argument`) and
  where the registry and discovery were loaded from. Secrets are never shown.

### 3.6 Token safety

The user's token is attached only to requests whose origin equals the
effective `stac_url`, `issuer` or `s3_keys_url` origin (extends v0.1's
"configured STAC host only" rule). The S3 gateway never sees the token.

## 4. Login (token chain)

For the active profile's `issuer`:

| # | Source | When |
|---|---|---|
| 1 | Manual token: `JSTEX_ACCESS_TOKEN` or `jstex.login(token=…)` | automatic |
| 2 | JupyterHub `auth_state` — only if the JWT `iss` claim equals `issuer` | automatic |
| 3 | Stored session (refresh token from an earlier device/password login) | automatic |
| 4 | Device code with `login_client_id` (§4.2) | user action |
| 5 | Password, if `password_login` and `password_client_id` are set | user action; also after step 4 fails with `unauthorized_client` |
| 6 | Anonymous | — |

- **Issuer match (step 2):** the hub token's `iss` is read from the JWT payload
  without signature verification (routing decision only; the services verify
  it). Mismatch ⇒ the hub token is not used for this profile, and the widget
  offers "Sign in".
- **Stored sessions (step 3):** `~/.local/share/jstex/sessions.json`, mode
  0600 (dir 0700), atomic writes, keyed by `issuer` + client id; holds the
  refresh token and its expiry only. The access token lives in memory. A
  refresh that returns a new refresh token replaces it; `invalid_grant` drops
  the session and the status falls back to anonymous with a "session expired"
  note.
- **Device code (step 4):** RFC 8628 with PKCE S256 against the issuer's
  `device_authorization_endpoint` (from its `.well-known/openid-configuration`),
  scope `openid` (+ `offline_access` if `offline_access`). Honours `interval`
  and `slow_down`; gives up after `expires_in` or 5 min. Shows
  `verification_uri_complete` (else `verification_uri`) and `user_code`.
  `unauthorized_client` ⇒ go to step 5 if allowed, else a message naming
  `login_client_id`.
- **Password (step 5):** resource-owner password grant with
  `password_client_id`. The password is sent once to the token endpoint and
  never stored or logged; only the refresh token is stored. Errors map to
  "wrong username or password" and "this account needs a browser login
  (MFA/social login) — use device login".
- **Refresh and retry:** access tokens are refreshed 60 s before expiry; a 401
  still triggers one refresh and one retry (v0.1 behaviour).
- **Python API:**
  - `jstex.login(profile=None, *, token=None, method=None, username=None,
    client_id=None, save=False)` —
    `method` in `"device" | "password"`; default: device if possible, else
    password. Device code is shown as updating HTML in the cell output;
    password is asked with `getpass` unless the widget supplies it.
  - `jstex.logout(profile=None)` — drops the stored session (and the
    in-memory token) for the profile's issuer; revokes the refresh token at the
    issuer's revocation endpoint when it advertises one.
  - `jstex.whoami(profile=None)` — source (`token`, `hub`, `session`, `device`,
    `password`, `anonymous`), user name from the token, expiry.
  - `jstex.access_token(profile=None)` — the user's current access token (or
    `None`) for their own HTTP requests, e.g. downloading an HTTPS asset. jstex
    itself still sends the token only to the profile's services (§3.6); where
    else it goes is the user's decision.
- **Thread safety:** one lock per issuer around refresh and session-file
  writes; a second login while one is running is refused with a message.

### 4.2 Device-login client id

The device-enabled client may have any name (operator's choice). Sources, in
the general merge order of §3.2 (later wins):

1. GitHub profile `jstex.login_client_id`;
2. discovery `services.auth.device_client_id` — a proposed addition to the
   `eo-services.json` schema (to be suggested to CloudFerro); discovery's
   `services.auth.client_id` is never used for device login;
3. manual config `login_client_id` (`config.toml`, `JSTEX_LOGIN_CLIENT_ID`,
   `login_client_id=` argument);
4. **interactively**: when none is resolved (or the resolved one is refused
   with `unauthorized_client`), Sign in / `jstex.login(client_id=…)` asks for a
   client id. A client id entered this way that completes a login is remembered
   with the stored session (keyed by issuer) and reused for later refreshes and
   logins; `jstex.login(client_id=…, save=True)` also writes it to
   `~/.config/jstex/config.toml` under the active profile.

If no client id is available and the user gives none, Sign in offers the
password path (if allowed) or explains what to configure.

### 4.1 Widget

- Panel footer sign-in line: "Signed in (hub · token · session · device login ·
  password) as <name> — Sign out" or "Not signed in — restricted collections are
  hidden. **Sign in**" (button only when step 4 or 5 is possible). The active
  profile's name is shown next to it.
- Sign in opens an inline area in the panel footer:
  - device: when no client id is resolved, first a "Device-login client id"
    field (§4.2); then the link (opens in a new tab), the code in large
    monospace with a copy button, countdown, Cancel; on success the area closes, `auth_source`
    updates and collections reload (restricted collections appear);
  - password (when chosen, or after the device client is refused): username +
    masked password, Sign in, Cancel; a warning when the page is not served
    over HTTPS ("your password crosses the network unencrypted").
- Protocol additions (JS → Py): `login_start {method, client_id?}`, `login_password
  {req_id, username, password}`, `login_cancel`, `logout`. (Py → JS): `login
  {state: "device", uri, code, expires_in}`, `login {state: "done"}`, `login
  {state: "error", message}`. Trait `auth_source` gains `session`, `device`,
  `password`, `token`; new trait `auth_user` (display name).
- All strings through `js/strings.ts` (i18n); the password never enters a
  trait, the store, logs or error messages.

## 5. S3 keys (v0.2 base)

Main spec §6 applies, with these changes:

- Settings come from the profile: `s3_keys_url`, `s3_endpoint`, `s3_region`,
  `s3_bucket`. A profile without them makes `jstex.s3.*` raise "S3 is not
  configured for profile <name>".
- Enablement: installing `jupyterlab-jstex[s3]` (boto3, filelock) is the
  opt-in; the separate `JSTEX_S3_ENABLED` flag is dropped.
- Policy (port of STEX `cdse.ts` + `s3-credentials.ts`): keys created with an
  8 h `expiration_date`; renewed when < 1 h remains and the superseded key
  deleted; on `InvalidAccessKeyId` from a non-fresh key: drop, create once,
  retry; after creating, wait until a signed `ListObjectsV2`
  (`max-keys=1`, `delimiter=/`) on `s3_bucket` stops answering
  `InvalidAccessKeyId` (budget 10 s); key-cap refusal (403 "Max number of
  credentials") ⇒ `JstexS3Error("S3 key limit reached — remove unused keys")`,
  negative-cached 30 s.
- Cache `~/.config/jstex/s3-credentials.json` (0600), keyed by `s3_keys_url`
  and the token's `sub`; a `filelock` around create/renew so concurrent
  kernels create one key.
- API unchanged from §6: `jstex.s3.client(asset=None)`, `location(...)`,
  `session()`, `storage_options()`, `gdal_env()`, `write_aws_profile(name)`,
  and the per-asset "copy boto3 snippet".

## 6. Code structure

- `jstex/data/profiles.json` + `profiles.schema.json` (package data; not `jstex/profiles/`, which would clash with the `jstex/profiles.py` module).
- `jstex/profiles.py` — registry and discovery loading, caching, validation,
  merge (`load_profile(name) -> Profile` with per-field sources).
- `jstex/config.py` — `load_config()` builds on the merged profile + config
  files + env + kwargs; keeps today's `Config`/`Basemap` and adds the §3.2
  fields.
- `jstex/auth.py` — the token chain (steps 1–3, refresh, session store,
  issuer match); `jstex/interactive.py` (not `login.py`: `jstex.login` is the function) — device and password flows (steps 4–5) and
  their notebook display.
- `jstex/s3.py` — §5.
- `jstex/stac.py` — token scoping by origin set (§3.6).
- Widget: `js/ui/signin.ts` (footer sign-in area), protocol in
  `js/backend.ts` / `jstex/widget.py`, strings in `js/strings.ts`.

## 7. Testing

- **Python (pytest + responses):**
  - merge order and `pinned`; registry fallback chain (network → cache →
    packaged); invalid registry/discovery skipped; HTTPS-only;
  - TOML config, env vars, kwargs, `profile = "none"`;
  - token chain order; hub issuer mismatch; session store permissions,
    rotation and `invalid_grant`;
  - device flow (`authorization_pending`, `slow_down`, `expired_token`,
    `unauthorized_client` → password), PKCE parameters;
  - password flow errors; the password never appears in logs, traits or
    exceptions;
  - token scoping across the origin set;
  - S3: renewal, re-mint on rejection, propagation wait, key cap, file lock
    with two processes (moto or a fake keys manager).
- **JS (vitest):** sign-in area states (device, password, error, HTTPS
  warning), protocol messages, status line.
- **Device client id:** each source of §4.2 (GitHub, discovery, config, env,
  argument, interactive), precedence, remembering an interactively entered id,
  `save=True` writing the config file.
- **E2E (Galata):** `ui-tests/fake_stac.py` gains a fake OIDC provider
  (discovery, device and token endpoints, auto-approval switch) and a
  discovery document; tests: device sign-in from the widget, password sign-in,
  restricted collection appears after sign-in. (Discovery overrides are unit-tested only: the local fake is `http://`, which discovery documents may not use.)

## 8. eosdk (CloudFerro SDK) — stance

Reviewed `CloudFerro/eosdk` v0.5.0 (2026-10-01, Apache-2.0, alpha). Adopted:
the `eo-services.json` discovery format (P2, P3). Not used for now:
`S3KeysProvider` (labels are client-side only; no key lifetime, renewal,
cross-process lock or re-mint on rejection; full key listing on each use) and
`S3Downloader` (product downloads are outside jstex's scope). To revisit when
eosdk adds key lifetime, renewal and locking; jstex will propose these
upstream.

## 9. Security notes

- Profiles and discovery documents decide where the token goes: HTTPS only,
  registry changes via reviewed PRs, `JSTEX_PROFILES_URL=builtin` for
  air-gapped or strict setups.
- Hub tokens are never sent to another issuer's services (§4 step 2).
- Session and key files are 0600 in 0700 directories; nothing secret in
  traits, logs or `jstex.show_config()`.
- The password grant is a fallback (deprecated by OAuth 2.0 security best
  practice); the UI prefers device login and warns on plain HTTP.

## 10. Prerequisites and open items

| Item | Owner | Needed for |
|---|---|---|
| A device-enabled public client (device code + PKCE + refresh token, no secret; any name) in realms CDSE, CODE-DE3, Creodias-new, recorded in the GitHub profiles (or published as `device_client_id` in discovery) | CloudFerro / maintainer | device login without typing a client id |
| Propose `services.auth.device_client_id` for the `eo-services.json` schema | jstex → CloudFerro | discovery-sourced device client |
| S3 endpoint, region, keys source and bucket for CREODIAS and CODE-DE | maintainer | S3 in those profiles |
| Check whether `code-de3-public` and a CREODIAS public client allow the password grant; set `password_login` | jstex (probe) | password login |
| Check whether `offline_access` is allowed per realm | jstex (probe) | long-lived sessions |
| `eo-services.json` for CREODIAS and CODE-DE | CloudFerro | discovery beyond CDSE |
| Verify `cdse` profile (stac.dataspace.copernicus.eu) with collections, queryables, CQL2 and item links | jstex | `cdse` profile |

## 11. Sample notebooks (v0.2 base)

Notebooks in the jstex repository under `examples/`, linked from the README.
Each uses only jstex's public API plus the named libraries, runs on the
default profile with a CDSE account (hub token, stored session or Sign in),
starts with a short "what you need" cell (packages, account, S3 extra), and
selects data with `jstex.Explorer()` (and a code-only path with
`ex.query = …; ex.search(wait=True)` so it can run top to bottom).

1. **`01-download.ipynb` — downloading data**
   - selected assets: from `ex.selected_item`, choose asset keys and download
     them over S3 (`jstex.s3.client(asset)` + `jstex.s3.location(asset)`) and,
     for assets with HTTPS hrefs, over HTTPS with the user's token
     (`jstex.access_token()`);
   - complete product: list every object under the product's S3 prefix and
     download them, keeping the product's directory layout, with progress and
     skipping files already present with the same size.
2. **`02-ndvi-gdal.ipynb` — Sentinel-2 NDVI with GDAL**
   - a Sentinel-2 L2A item over a small AOI; read the red (B04) and NIR (B08)
     bands with the GDAL Python bindings through `/vsis3/` under
     `jstex.s3.gdal_env()`, windowed to the AOI;
   - NDVI = (B08 − B04) / (B08 + B04) with the product's scale/offset and
     nodata handled; write a Cloud-Optimised GeoTIFF; show a quick plot.
3. **`03-xarray.ipynb` — working with xarray**
   - open the bands of several items lazily with xarray (`rioxarray`, with
     `jstex.s3.storage_options()` / `gdal_env()`), clip to the AOI, stack over
     time, mask clouds with the SCL band, compute an NDVI time series and plot
     it; note when to use Dask.

Requirements:

- Notebooks are committed **without outputs** (stripped in CI by a check), so
  no token, key or user data can leak; the README shows a rendered screenshot
  of each result.
- CI checks they are valid and lint-clean (`nbqa ruff`); they are executed
  manually against CDSE before each release (credentials needed), and the
  release checklist in CONTRIBUTING lists this step.
- Dependencies stay out of the package: an `examples/requirements.txt`
  (`rioxarray`, `xarray`, `matplotlib`, `dask`), with GDAL installed from the
  image or conda (noted in the first cell).
