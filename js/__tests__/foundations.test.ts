import { describe, expect, it, vi } from 'vitest';
import { CommBackend } from '../backend';
import {
  boxAreaKm2,
  bboxTo3857,
  dateInputToIso,
  formatItemDate,
  formatIso,
  formatValue,
  geometryAreaKm2,
  geometryBbox,
  itemFeatures,
  shortId,
  unionBbox
} from '../format';
import { applyPage, bindModel, stateFromModel } from '../model-sync';
import { neighbour, scrollWithin, toggleId } from '../selection';
import { pythonItemSnippet } from '../snippets';
import { createStore } from '../store';
import { basemapLayer, DEFAULT_BASEMAP, isDark, watchTheme } from '../theme';
import { BOX, FakeModel, FIELDS, item, setupView } from './helpers';

describe('store', () => {
  it('notifies subscribers with state and prev; unsubscribe stops it', () => {
    const s = createStore({ a: 1, b: 2 });
    const seen: Array<[number, number]> = [];
    const off = s.subscribe((st, prev) => seen.push([st.a, prev.a]));
    s.set({ a: 5 });
    off();
    s.set({ a: 6 });
    expect(seen).toEqual([[5, 1]]);
    expect(s.get()).toEqual({ a: 6, b: 2 });
  });
});

describe('CommBackend', () => {
  it('correlates replies by req_id', async () => {
    const m = new FakeModel();
    const b = new CommBackend(m, { onPage: vi.fn() });
    const p1 = b.listCollections();
    const p2 = b.listCollections();
    expect(m.sent).toEqual([
      { type: 'collections', req_id: 1 },
      { type: 'collections', req_id: 2 }
    ]);
    m.emit('msg:custom', {
      type: 'reply',
      req_id: 2,
      ok: false,
      error: 'nope'
    });
    m.emit('msg:custom', {
      type: 'reply',
      req_id: 1,
      ok: true,
      data: [{ id: 'c', title: 'C' }]
    });
    await expect(p1).resolves.toEqual([{ id: 'c', title: 'C' }]);
    await expect(p2).rejects.toThrow('nope');
  });

  it('routes pages and sends search/cancel/sync', () => {
    const m = new FakeModel();
    const onPage = vi.fn();
    const b = new CommBackend(m, { onPage });
    m.emit('msg:custom', { type: 'page', items: [], matched: 0 });
    expect(onPage).toHaveBeenCalledOnce();
    b.search({ collections: ['c'] } as never);
    b.cancel();
    b.sync();
    expect(m.sent.map(x => (x as { type: string }).type)).toEqual([
      'search',
      'cancel',
      'sync'
    ]);
  });

  it('dispose rejects pending requests and stops listening', async () => {
    const m = new FakeModel();
    const onPage = vi.fn();
    const b = new CommBackend(m, { onPage });
    const p = b.listCollections();
    b.dispose();
    await expect(p).rejects.toThrow('disposed');
    m.emit('msg:custom', { type: 'page', items: [], matched: 0 });
    expect(onPage).not.toHaveBeenCalled();
  });
});

describe('model sync', () => {
  it('stateFromModel restores query and selection but no items (re-rendered view)', () => {
    const m = new FakeModel({
      query: {
        collections: ['c1'],
        datetime: { from: '2024-01-01T00:00:00Z' }
      },
      selected_ids: ['a'],
      active_id: 'a',
      status: 'idle',
      auth_source: 'hub',
      can_cancel: true,
      map_height: 300
    });
    const s = stateFromModel(m);
    expect(s.query.collections).toEqual(['c1']);
    expect(s.query.aois).toEqual([]);
    expect(s.query.pageSize).toBe(50);
    expect(s.items).toEqual([]);
    expect(s.searched).toBe(false);
    expect([s.activeId, s.authSource, s.mapHeight]).toEqual(['a', 'hub', 300]);
  });

  it('stateFromModel tolerates an empty model', () => {
    const s = stateFromModel(new FakeModel());
    expect(s.status).toBe('idle');
    expect(s.activeId).toBeNull();
    expect(s.canCancel).toBe(true);
  });

  it('bindModel mirrors Python trait changes', () => {
    const m = new FakeModel({ query: {} });
    const store = createStore(stateFromModel(m));
    const unbind = bindModel(m, store);
    m.pyset('status', 'searching');
    m.pyset('active_id', null);
    m.pyset('query', { collections: ['x'] });
    expect(store.get().status).toBe('searching');
    expect(store.get().activeId).toBeNull();
    expect(store.get().query.collections).toEqual(['x']);
    expect(store.get().query.sort.direction).toBe('desc');
    unbind();
    m.pyset('status', 'error');
    expect(store.get().status).toBe('searching');
  });

  it('applyPage keeps only selection that is still loaded', () => {
    const store = createStore(stateFromModel(new FakeModel()));
    store.set({ selectedIds: ['a', 'gone'], activeId: 'gone' });
    applyPage(store, {
      type: 'page',
      items: [item('a'), item('b')],
      matched: 9
    });
    expect(store.get().selectedIds).toEqual(['a']);
    expect(store.get().activeId).toBeNull();
    expect(store.get().matched).toBe(9);
    expect(store.get().searched).toBe(true);
  });
});

describe('actions', () => {
  it('push query, selection, active id and panel state to the model', () => {
    const { model: m, store, actions: a, backend } = setupView({ query: {} });
    a.setQuery({ collections: ['c1'] });
    a.setAoi(BOX);
    a.toggleSelected('x');
    a.activate('x');
    a.setPanelCollapsed(true);
    expect((m.values.query as { collections: string[] }).collections).toEqual([
      'c1'
    ]);
    expect((m.values.query as { aois: unknown[] }).aois).toHaveLength(1);
    expect(m.values.selected_ids).toEqual(['x']);
    expect(m.values.active_id).toBe('x');
    expect(m.values.panel_collapsed).toBe(true);
    a.setAoi(null);
    expect(store.get().query.aois).toEqual([]);
    store.set({ error: 'old', drawMode: 'Box' });
    a.search();
    expect(store.get().error).toBe('');
    expect(store.get().drawMode).toBeNull();
    expect(backend.search).toHaveBeenCalledWith(store.get().query);
  });

  it('a new area replaces the old one and ends drawing', () => {
    const { store, actions: a } = setupView();
    a.setDrawMode('Polygon');
    a.setAoi(BOX);
    a.setAoi({
      ...BOX,
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 0]
        ]
      ]
    });
    expect(store.get().query.aois).toHaveLength(1);
    expect(store.get().drawMode).toBeNull();
  });

  it('uploadAoi sets and zooms to the area, or reports the file error and keeps the old area', async () => {
    const { store, actions: a, backend } = setupView();
    await a.uploadAoi(new File(['{}'], 'area.geojson'));
    expect(store.get().query.aois[0].geometry).toEqual(BOX);
    expect(store.get().zoomToAoi).toBe(1);
    backend.uploadAoi.mockRejectedValueOnce(
      new Error('Only EPSG:4326 (WGS84 lon/lat) supported.')
    );
    await a.uploadAoi(new File(['{}'], 'utm.geojson'));
    expect(store.get().aoiError).toBe(
      'utm.geojson: Only EPSG:4326 (WGS84 lon/lat) supported. The previous area is unchanged.'
    );
    expect(store.get().query.aois[0].geometry).toEqual(BOX);
  });

  it('filter rows: valid rows become query filters, invalid rows get an error, empty rows are ignored', async () => {
    const { store, actions: a } = setupView();
    a.setQuery({ collections: ['c1'] });
    await a.loadFields();
    a.addFilterRow();
    a.addFilterRow();
    const [r1, r2] = store.get().filterRows;
    a.updateFilterRow(r1.id, {
      field: 'eo:cloud_cover',
      op: '<=',
      value: '20'
    });
    a.updateFilterRow(r2.id, {
      field: 'sat:relative_orbit',
      op: '>=',
      value: 'abc'
    });
    expect(store.get().query.filters).toEqual([
      { field: 'eo:cloud_cover', op: '<=', value: 20 }
    ]);
    expect(store.get().filterRows[1].error).toBe('Enter a number.');
    a.updateFilterRow(r2.id, { value: '' });
    expect(store.get().filterRows[1].error).toBe('');
    a.removeFilterRow(r1.id);
    expect(store.get().query.filters).toEqual([]);
  });

  it('loadFields ignores a stale answer when the selection changed meanwhile', async () => {
    const { store, actions: a, backend } = setupView();
    let release!: (f: typeof FIELDS) => void;
    backend.queryables.mockImplementationOnce(
      () => new Promise(r => (release = r))
    );
    a.setQuery({ collections: ['slow'] });
    const first = a.loadFields();
    a.setQuery({ collections: ['fast'] });
    await a.loadFields();
    release([FIELDS[0]]);
    await first;
    expect(store.get().fields).toEqual(FIELDS);
  });

  it('rows for fields that vanish after a collection change are flagged', async () => {
    const { store, actions: a, backend } = setupView();
    a.setQuery({ collections: ['c1'] });
    await a.loadFields();
    a.addFilterRow();
    a.updateFilterRow(store.get().filterRows[0].id, {
      field: 'platform',
      value: 'sentinel-2a'
    });
    backend.queryables.mockResolvedValueOnce([FIELDS[0]]);
    a.setQuery({ collections: ['c1', 'c2'] });
    await a.loadFields();
    expect(store.get().filterRows[0].error).toBe(
      'Not available for the selected collections.'
    );
    expect(store.get().query.filters).toEqual([]);
  });
});

describe('format', () => {
  it('shortId keeps start and end', () => {
    const id = 'S2B_MSIL2A_20240712T103031_N0510_R108_T32TPS_20240712T134417';
    expect(shortId(id)).toBe('S2B_MSIL2A_20240712T103…40712T134417');
    expect(shortId(id).length).toBe(36);
    expect(shortId('short')).toBe('short');
  });

  it('formatItemDate handles datetime, ranges and missing values', () => {
    expect(formatItemDate(item('a'))).toBe('2024-07-12 10:30Z');
    expect(
      formatItemDate(
        item('m', {
          properties: {
            datetime: null,
            start_datetime: '2021-01-01T00:00:00Z',
            end_datetime: '2021-12-31T23:59:59Z'
          }
        })
      )
    ).toBe('2021-01-01 – 2021-12-31');
    expect(formatItemDate(item('n', { properties: {} }))).toBe('—');
    expect(formatIso('not a date')).toBe('not a date');
  });

  it('formatValue stringifies objects compactly', () => {
    expect(formatValue({ a: [1, 2] })).toBe('{"a":[1,2]}');
    expect(formatValue(null)).toBe('null');
    expect(formatValue(3.5)).toBe('3.5');
  });

  it('bbox, area and projection', () => {
    const b = geometryBbox({
      type: 'Polygon',
      coordinates: [
        [
          [10, 45],
          [11, 45],
          [11, 46],
          [10, 45]
        ]
      ]
    })!;
    expect(b).toEqual([10, 45, 11, 46]);
    expect(Math.round(boxAreaKm2(b))).toBe(8666);
    expect(geometryBbox(null)).toBeNull();
    expect(unionBbox([b, null, [0, 0, 1, 1]])).toEqual([0, 0, 11, 46]);
    const ext = bboxTo3857([0, 0, 1, 1], 0);
    expect(ext[0]).toBeCloseTo(0);
    expect(ext[2]).toBeCloseTo(111319.49, 1);
  });

  it('geometryAreaKm2 matches the exact box area and subtracts holes', () => {
    expect(Math.round(geometryAreaKm2(BOX))).toBe(
      Math.round(boxAreaKm2([10, 45, 11, 46]))
    );
    const withHole: GeoJSON.Polygon = {
      type: 'Polygon',
      coordinates: [
        BOX.coordinates[0],
        [
          [10.25, 45.25],
          [10.75, 45.25],
          [10.75, 45.75],
          [10.25, 45.75],
          [10.25, 45.25]
        ]
      ]
    };
    expect(geometryAreaKm2(withHole)).toBeLessThan(geometryAreaKm2(BOX) * 0.8);
    const multi: GeoJSON.MultiPolygon = {
      type: 'MultiPolygon',
      coordinates: [BOX.coordinates, BOX.coordinates]
    };
    expect(Math.round(geometryAreaKm2(multi))).toBe(
      Math.round(2 * geometryAreaKm2(BOX))
    );
  });

  it('dateInputToIso', () => {
    expect(dateInputToIso('2024-07-01', false)).toBe('2024-07-01T00:00:00Z');
    expect(dateInputToIso('2024-07-01', true)).toBe('2024-07-01T23:59:59Z');
    expect(dateInputToIso('', true)).toBeUndefined();
  });

  it('itemFeatures skips null geometries', () => {
    const f = itemFeatures([item('a'), item('b', { geometry: null })]);
    expect(f.map(x => x.id)).toEqual(['a']);
  });
});

describe('selection', () => {
  it('neighbour stops at the ends', () => {
    const items = [item('a'), item('b')];
    expect(neighbour(items, 'a', 1)).toBe('b');
    expect(neighbour(items, 'b', 1)).toBeNull();
    expect(neighbour(items, 'a', -1)).toBeNull();
    expect(neighbour(items, null, 1)).toBe('a');
    expect(neighbour([], null, 1)).toBeNull();
  });

  it('toggleId', () => {
    expect(toggleId(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleId(['a', 'b'], 'a')).toEqual(['b']);
  });

  it('scrollWithin moves only the container', () => {
    const c = document.createElement('div');
    const r = document.createElement('tr');
    c.scrollTop = 100;
    c.getBoundingClientRect = () => ({ top: 0, bottom: 200 }) as DOMRect;
    r.getBoundingClientRect = () => ({ top: 250, bottom: 280 }) as DOMRect;
    scrollWithin(c, r);
    expect(c.scrollTop).toBe(180);
    r.getBoundingClientRect = () => ({ top: 10, bottom: 40 }) as DOMRect;
    scrollWithin(c, r, 30);
    expect(c.scrollTop).toBe(160);
  });
});

describe('snippets and theme', () => {
  it('python snippet is valid literal', () => {
    expect(pythonItemSnippet('https://x/items/a"b')).toBe(
      'import jstex\n\nitem = jstex.item("https://x/items/a\\"b")'
    );
  });

  it('isDark follows JupyterLab, then VS Code, then Colab', () => {
    document.body.dataset.jpThemeLight = 'false';
    expect(isDark()).toBe(true);
    document.body.dataset.jpThemeLight = 'true';
    expect(isDark()).toBe(false);
    delete document.body.dataset.jpThemeLight;
    document.body.classList.add('vscode-dark');
    expect(isDark()).toBe(true);
    document.body.classList.remove('vscode-dark');
    document.body.classList.add('vscode-light');
    expect(isDark()).toBe(false);
    document.body.classList.remove('vscode-light');
    document.documentElement.setAttribute('theme', 'dark');
    expect(isDark()).toBe(true);
    document.documentElement.removeAttribute('theme');
  });

  it('watchTheme fires when JupyterLab switches theme', async () => {
    let calls = 0;
    const stop = watchTheme(() => calls++);
    document.body.dataset.jpThemeLight = 'false';
    await Promise.resolve();
    stop();
    document.body.dataset.jpThemeLight = 'true';
    await Promise.resolve();
    expect(calls).toBe(1);
    delete document.body.dataset.jpThemeLight;
  });

  it('basemapLayer picks the themed source', () => {
    const cfg = {
      light: { url: 'L/{z}/{x}/{y}', attribution: 'a' },
      dark: { url: 'D/{z}/{x}/{y}', attribution: 'b' }
    };
    expect(basemapLayer(cfg, true).source).toEqual({
      type: 'XYZ',
      url: 'D/{z}/{x}/{y}',
      attributions: 'b'
    });
    expect((basemapLayer(cfg, false).source as { url: string }).url).toBe(
      'L/{z}/{x}/{y}'
    );
  });

  it('stateFromModel falls back to the STEX default basemaps', () => {
    expect(stateFromModel(new FakeModel()).basemap).toEqual(DEFAULT_BASEMAP);
    const custom = stateFromModel(
      new FakeModel({
        basemap: {
          light: { url: 'L', attribution: '' },
          dark: { url: 'D', attribution: '' }
        }
      })
    );
    expect(custom.basemap.dark.url).toBe('D');
  });
});
