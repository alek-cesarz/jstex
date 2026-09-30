/** Model (Python traitlets) <-> per-instance store. */
import type { Store } from './store';
import { rowsFromFilters } from './filters';
import { DEFAULT_BASEMAP } from './theme';
import type {
  BasemapConfig,
  ExplorerState,
  MinimalModel,
  PageMessage,
  QueryStateDict
} from './types';

export const DEFAULT_QUERY: QueryStateDict = {
  collections: [],
  datetime: null,
  aois: [],
  filters: [],
  sort: { field: 'properties.datetime', direction: 'desc' },
  pageSize: 50
};

/** Initial state for a fresh view. Items are NOT in the model — they arrive via `sync`. */
export function stateFromModel(model: MinimalModel): ExplorerState {
  const query = (model.get('query') as Partial<QueryStateDict> | null) ?? {};
  let rowId = 0;
  return {
    collections: [],
    collectionsLoading: true,
    collectionsError: '',
    query: { ...DEFAULT_QUERY, ...query },
    items: [],
    matched: null,
    searched: false,
    selectedIds: (model.get('selected_ids') as string[] | null) ?? [],
    activeId: (model.get('active_id') as string | null) ?? null,
    status: ((model.get('status') as ExplorerState['status']) ||
      'idle') as ExplorerState['status'],
    error: (model.get('error') as string) || '',
    authSource:
      (model.get('auth_source') as ExplorerState['authSource']) || 'anonymous',
    canCancel: model.get('can_cancel') !== false,
    mapHeight: (model.get('map_height') as number) || 600,
    basemap: {
      ...DEFAULT_BASEMAP,
      ...((model.get('basemap') as Partial<BasemapConfig> | null) ?? {})
    },
    dark: false, // set from the host theme by widget.ts
    drawMode: null,
    aoiError: '',
    zoomToAoi: 0,
    fields: [],
    fieldsLoading: false,
    fieldsError: '',
    filterRows: rowsFromFilters(query.filters ?? [], () => ++rowId),
    panelCollapsed: model.get('panel_collapsed') === true,
    panelWidth: (model.get('panel_width') as number) || 300,
    mapCollapsed: model.get('map_collapsed') === true,
    sections: { collections: true, dates: true, aoi: true, filters: true }
  };
}

const TRAITS: Array<[string, keyof ExplorerState]> = [
  ['query', 'query'],
  ['selected_ids', 'selectedIds'],
  ['active_id', 'activeId'],
  ['status', 'status'],
  ['error', 'error'],
  ['auth_source', 'authSource'],
  ['can_cancel', 'canCancel'],
  ['map_height', 'mapHeight'],
  ['panel_collapsed', 'panelCollapsed'],
  ['panel_width', 'panelWidth'],
  ['map_collapsed', 'mapCollapsed']
];

/** Mirror trait changes made in Python into the store. Returns an unbind function. */
export function bindModel(
  model: MinimalModel,
  store: Store<ExplorerState>
): () => void {
  const offs = TRAITS.map(([trait, key]) => {
    const cb = () => {
      const value = model.get(trait);
      const patch: Partial<ExplorerState> = {};
      (patch as Record<string, unknown>)[key] =
        key === 'query'
          ? { ...DEFAULT_QUERY, ...(value as object) }
          : (value ?? (key === 'activeId' ? null : value));
      if (key === 'query') {
        // `ex.query = …` from Python: filters that differ from what the
        // current rows commit to replace the rows, so they show in the
        // builder and survive the next field reload.
        const incoming = (patch.query as QueryStateDict).filters;
        if (
          JSON.stringify(incoming) !== JSON.stringify(store.get().query.filters)
        ) {
          let id = Math.max(0, ...store.get().filterRows.map(r => r.id));
          patch.filterRows = rowsFromFilters(incoming, () => ++id);
        }
      }
      store.set(patch);
    };
    model.on(`change:${trait}`, cb);
    return () => model.off(`change:${trait}`, cb);
  });
  return () => offs.forEach(off => off());
}

/** Apply a results page: replace items; keep selection that still refers to loaded items. */
export function applyPage(store: Store<ExplorerState>, msg: PageMessage): void {
  const ids = new Set(msg.items.map(i => i.id));
  const { selectedIds, activeId } = store.get();
  store.set({
    items: msg.items,
    matched: msg.matched,
    searched: true,
    selectedIds: selectedIds.filter(id => ids.has(id)),
    activeId: activeId && ids.has(activeId) ? activeId : null
  });
}
