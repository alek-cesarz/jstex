/**
 * All user-visible widget strings. English source strings, translated through
 * the JupyterLab gettext bundle for domain "jstex" when one is available.
 * Keep every call a literal `trans.__('…')` / `trans._n(…)` (extraction rule).
 */
import { getTranslation, type TranslationBundle } from './i18n';

export function createStrings(trans: TranslationBundle) {
  return {
    // ── search panel ──
    collapsePanel: trans.__('Collapse search panel'),
    expandPanel: trans.__('Expand search panel'),
    resizePanel: trans.__(
      'Resize the search panel (drag, or use the arrow keys)'
    ),
    // ── map ──
    map: trans.__('Map'),
    hideMap: trans.__('Hide map'),
    showMap: trans.__('Show map'),
    // collections
    collections: trans.__('Collections'),
    collectionsSearch: trans.__('Search collections…'),
    clearSearch: trans.__('Clear search'),
    onlySelected: trans.__('Only selected'),
    collectionsCount: (shown: number, total: number) =>
      trans.__('%1 of %2', shown, total),
    collectionsLoading: trans.__('Loading collections…'),
    collectionsEmpty: trans.__('No collections available.'),
    collectionsNoMatch: trans.__('No collections match.'),
    collectionInfo: trans.__('About this collection'),
    timeRange: (start: string, end: string) => trans.__('%1 → %2', start, end),
    ongoing: trans.__('ongoing'),
    license: (license: string) => trans.__('License: %1', license),
    // dates
    dates: trans.__('Dates'),
    utc: trans.__('(UTC)'),
    from: trans.__('From'),
    to: trans.__('To'),
    open: trans.__('open'),
    clearDates: trans.__('Clear dates'),
    datesHint: trans.__('Either end may stay empty; the time is optional.'),
    invalidDate: (field: string) =>
      trans.__('%1: use YYYY-MM-DD or YYYY-MM-DD HH:MM (UTC).', field),
    fromAfterTo: trans.__('From is after To.'),
    today: trans.__('Today'),
    clear: trans.__('Clear'),
    // area of interest (one area)
    aoi: trans.__('Area of interest'),
    polygon: trans.__('Polygon'),
    box: trans.__('Box'),
    upload: trans.__('Upload'),
    uploadTitle: trans.__('Upload a GeoJSON file (EPSG:4326)'),
    aoiEmptyHint: trans.__('Draw on the map or upload a GeoJSON file.'),
    drawPolygonHint: trans.__(
      'Click to add points, double-click to finish · Esc cancels'
    ),
    drawBoxHint: trans.__('Click two opposite corners · Esc cancels'),
    aoiPolygon: trans.__('Polygon'),
    aoiMultiPolygon: trans.__('Multipolygon'),
    zoomToAoi: trans.__('Zoom to area'),
    removeAoi: trans.__('Remove area'),
    uploadRejected: (file: string, message: string) =>
      trans.__('%1: %2 The previous area is unchanged.', file, message),
    // filters
    filters: trans.__('Filters'),
    addFilter: trans.__('Add filter'),
    removeFilter: trans.__('Remove filter'),
    field: trans.__('Field'),
    operator: trans.__('Operator'),
    value: trans.__('Value'),
    inPlaceholder: trans.__('a, b, c'),
    chooseValue: trans.__('Choose…'),
    fieldsLoading: trans.__('Loading fields…'),
    fieldsNeedCollection: trans.__(
      'Select a collection to filter by its attributes.'
    ),
    fieldsShared: (n: number) =>
      trans._n(
        'Fields of the selected collection.',
        'Fields shared by all %1 collections.',
        n,
        n
      ),
    fieldsNone: trans.__('No filterable fields.'),
    errOperator: (op: string, field: string) =>
      trans.__('%1 is not allowed for %2.', op, field),
    errInList: trans.__('Enter one or more values, comma-separated.'),
    errNumber: trans.__('Enter a number.'),
    errInteger: trans.__('Enter a whole number.'),
    errMin: (n: number) => trans.__('Must be at least %1.', n),
    errMax: (n: number) => trans.__('Must be at most %1.', n),
    errBoolean: trans.__('Choose true or false.'),
    errEnum: trans.__('Choose one of the listed values.'),
    errValue: trans.__('Enter a value.'),
    errFieldUnavailable: trans.__(
      'Not available for the selected collections.'
    ),
    // footer
    search: trans.__('Search'),
    cancel: trans.__('Cancel'),
    needCollection: trans.__('Select at least one collection.'),
    fixFilters: trans.__('Fix the filters above to search.'),
    noConstraint: (n: number) =>
      trans.__('No area or dates set — showing the first %1 matches.', n),
    signIn: trans.__('Sign in'),
    signOut: trans.__('Sign out'),
    signedInVia: (how: string) => trans.__('Signed in (%1)', how),
    signedInAs: (how: string, user: string) =>
      trans.__('Signed in (%1) as %2', how, user),
    authLabels: {
      hub: trans.__('hub'),
      token: trans.__('token'),
      session: trans.__('session'),
      device: trans.__('device login'),
      password: trans.__('password'),
      anonymous: ''
    } as Record<string, string>,
    profileTitle: (name: string) => trans.__('Profile: %1', name),
    signingIn: trans.__('Signing in…'),
    deviceStep: trans.__('Open the sign-in page and confirm this code:'),
    openSignIn: trans.__('Open sign-in page'),
    expiresIn: (min: number, sec: number) =>
      trans.__('Code valid for %1:%2', min, String(sec).padStart(2, '0')),
    clientIdLabel: trans.__('Device-login client id'),
    clientIdHint: trans.__(
      'Ask your platform operator for it; it is remembered after a successful sign-in.'
    ),
    continueBtn: trans.__('Continue'),
    usePassword: trans.__('Use password instead'),
    enterClientId: trans.__('Enter a client id'),
    username: trans.__('Username'),
    password: trans.__('Password'),
    insecurePassword: trans.__(
      'This page is not served over HTTPS: your password would cross the network unencrypted.'
    ),
    tryAgain: trans.__('Try again'),
    anonymousNote: trans.__(
      'Not signed in — restricted collections are hidden.'
    ),
    anonymousHint: trans.__(
      'No access token — restricted collections are hidden. Ask your hub admin to enable auth_state (see jstex README).'
    ),
    retry: trans.__('Retry'),
    dismiss: trans.__('Dismiss'),
    // ── results ──
    select: trans.__('Select'),
    results: trans.__('Results'),
    resultsIdle: trans.__('Run a search to see items.'),
    resultsSearching: trans.__('Searching…'),
    resultsNone: trans.__('No items match this query.'),
    loaded: (n: number) => trans._n('%1 loaded', '%1 loaded', n, n),
    selected: (n: number) => trans._n('%1 selected', '%1 selected', n, n),
    matched: (n: number) =>
      trans._n('%1 matched', '%1 matched', n, n.toLocaleString('en')),
    colId: trans.__('ID'),
    colDatetime: trans.__('Datetime'),
    colCollection: trans.__('Collection'),
    colCloud: trans.__('Cloud %'),
    // ── item details ──
    details: trans.__('Item details'),
    detailsEmpty: trans.__('Click a result or a footprint to see its details.'),
    prev: trans.__('Prev'),
    next: trans.__('Next'),
    prevItem: trans.__('Previous item'),
    nextItem: trans.__('Next item'),
    copySelf: trans.__('Copy self link'),
    copyId: trans.__('Copy id'),
    copyPython: trans.__('Copy Python'),
    copyBoto3: trans.__('Copy boto3 snippet'),
    copy: trans.__('Copy'),
    copied: trans.__('Copied'),
    copyFailed: trans.__('Copy failed'),
    properties: trans.__('Properties'),
    assets: trans.__('Assets'),
    links: trans.__('Links'),
    pythonHint: trans.__(
      'In Python, .selected_item on your Explorer returns this item as a pystac.Item.'
    ),
    // ── map ──
    overlapping: (n: number) =>
      trans._n('%1 overlapping item', '%1 overlapping items', n, n),
    close: trans.__('Close')
  };
}

export type Strings = ReturnType<typeof createStrings>;

/**
 * Built when the bundle is evaluated — anywidget evaluates it when an
 * Explorer is created, i.e. after the labextension published the bundle.
 */
export const S: Strings = createStrings(getTranslation());
