import { vi } from 'vitest';
import { createActions } from '../actions';
import { stateFromModel } from '../model-sync';
import { createStore } from '../store';
import { S } from '../strings';
import type {
  AoiGeometry,
  FilterField,
  MinimalModel,
  StacItem
} from '../types';

export class FakeModel implements MinimalModel {
  values: Record<string, unknown>;
  sent: unknown[] = [];
  saves = 0;
  private handlers = new Map<string, Set<(...args: any[]) => void>>();

  constructor(values: Record<string, unknown> = {}) {
    this.values = { ...values };
  }
  get(key: string) {
    return this.values[key];
  }
  set(key: string, value: unknown) {
    this.values[key] = value;
  }
  save_changes() {
    this.saves++;
  }
  on(event: string, cb: (...args: any[]) => void) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(cb);
  }
  off(event?: string | null, cb?: ((...args: any[]) => void) | null) {
    if (event && cb) this.handlers.get(event)?.delete(cb);
  }
  send(content: unknown) {
    this.sent.push(content);
  }
  /** Simulate Python: a custom message or a trait change. */
  emit(event: string, ...args: unknown[]) {
    this.handlers.get(event)?.forEach(cb => cb(...args));
  }
  pyset(key: string, value: unknown) {
    this.values[key] = value;
    this.emit(`change:${key}`);
  }
}

export function item(id: string, extra: Partial<StacItem> = {}): StacItem {
  return {
    id,
    collection: 'sentinel-2-l2a',
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [10, 45],
          [11, 45],
          [11, 46],
          [10, 46],
          [10, 45]
        ]
      ]
    },
    properties: {
      datetime: '2024-07-12T10:30:41.024Z',
      'eo:cloud_cover': 4.12
    },
    assets: {
      B04: {
        href: `s3://eodata/${id}/B04.jp2`,
        type: 'image/jp2',
        title: 'Red',
        roles: ['data']
      }
    },
    links: [
      {
        rel: 'self',
        href: `https://stac.test/v1/collections/sentinel-2-l2a/items/${id}`
      }
    ],
    ...extra
  };
}

/** A detached view container, a fresh store, the REAL actions and a fake backend. */
export function setupView(values: Record<string, unknown> = {}) {
  document.body.innerHTML = '';
  const el = document.createElement('div');
  document.body.appendChild(el);
  const model = new FakeModel(values);
  const store = createStore(stateFromModel(model));
  const backend = {
    listCollections: vi.fn(async () => []),
    queryables: vi.fn(async (_c: string[]): Promise<FilterField[]> => FIELDS),
    uploadAoi: vi.fn(async (_t: string): Promise<AoiGeometry> => BOX),
    search: vi.fn(),
    cancel: vi.fn(),
    sync: vi.fn(),
    dispose: vi.fn(),
    startLogin: vi.fn(),
    submitPassword: vi.fn(),
    cancelLogin: vi.fn(),
    logout: vi.fn()
  };
  const actions = createActions(model, store, backend, S);
  // Pass-through spies: real behaviour, but tests can assert on calls.
  for (const key of Object.keys(actions) as (keyof typeof actions)[])
    vi.spyOn(actions, key);
  return { el, store, actions, backend, model };
}

export const BOX: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [10, 45],
      [11, 45],
      [11, 46],
      [10, 46],
      [10, 45]
    ]
  ]
};

export const FIELDS: FilterField[] = [
  {
    name: 'eo:cloud_cover',
    title: 'Cloud cover',
    type: 'number',
    minimum: 0,
    maximum: 100
  },
  {
    name: 'platform',
    title: 'Platform',
    type: 'string',
    enum: ['sentinel-2a', 'sentinel-2b']
  },
  { name: 'sat:relative_orbit', title: 'Relative orbit', type: 'integer' },
  { name: 'eopf:instrument_mode', title: 'Instrument mode', type: 'string' }
];

export const flush = () => new Promise(r => setTimeout(r, 0));

export const byRef = (el: HTMLElement, ref: string) =>
  el.querySelector(`[data-ref="${ref}"]`) as HTMLElement;
