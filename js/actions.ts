/** User intents. Each updates the store and, where Python cares, the model. */
import type { Backend } from './backend';
import { commitRows } from './filters';
import { toggleId } from './selection';
import type { Store } from './store';
import type { Strings } from './strings';
import type {
  AoiGeometry,
  DrawMode,
  ExplorerState,
  FilterRow,
  MinimalModel,
  QueryStateDict,
  SectionId
} from './types';

export interface Actions {
  setQuery(patch: Partial<QueryStateDict>): void;
  /** One AOI: replaces the current one (null clears it). */
  setAoi(geometry: AoiGeometry | null): void;
  setDrawMode(mode: DrawMode | null): void;
  uploadAoi(file: File): Promise<void>;
  zoomToAoi(): void;
  /** Fetch the filterable fields for the selected collections. */
  loadFields(): Promise<void>;
  addFilterRow(): void;
  updateFilterRow(
    id: number,
    patch: Partial<Pick<FilterRow, 'field' | 'op' | 'value'>>
  ): void;
  removeFilterRow(id: number): void;
  toggleSection(id: SectionId): void;
  /** Panel and map are never both collapsed: collapsing one shows the other. */
  setPanelCollapsed(collapsed: boolean): void;
  /** `save: false` while dragging; the width is saved to the model on release. */
  setPanelWidth(width: number, save?: boolean): void;
  setMapCollapsed(collapsed: boolean): void;
  search(): void;
  cancel(): void;
  dismissError(): void;
  activate(id: string | null): void;
  toggleSelected(id: string): void;
}

/** File contents as text (FileReader fallback where Blob.text() is missing). */
function readText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsText(file);
  });
}

export function createActions(
  model: MinimalModel,
  store: Store<ExplorerState>,
  backend: Backend,
  S: Strings
): Actions {
  const push = (trait: string, value: unknown) => {
    model.set(trait, value);
    model.save_changes();
  };
  const commit = (rows: FilterRow[]) => {
    const { rows: checked, filters } = commitRows(rows, store.get().fields, S);
    store.set({ filterRows: checked });
    actions.setQuery({ filters });
  };
  let fieldsRequest = 0;

  const actions: Actions = {
    setQuery(patch) {
      const query = { ...store.get().query, ...patch };
      store.set({ query });
      push('query', query);
    },
    setAoi(geometry) {
      store.set({ drawMode: null, aoiError: '' });
      actions.setQuery({
        aois: geometry ? [{ geometry, selected: true }] : []
      });
    },
    setDrawMode(mode) {
      if (mode && store.get().mapCollapsed) actions.setMapCollapsed(false);
      store.set({ drawMode: mode, aoiError: '' });
    },
    async uploadAoi(file) {
      store.set({ drawMode: null, aoiError: '' });
      try {
        const geometry = await backend.uploadAoi(await readText(file));
        actions.setAoi(geometry);
        // Zoom without un-hiding a map the user folded away.
        store.set({ zoomToAoi: store.get().zoomToAoi + 1 });
      } catch (err) {
        store.set({
          aoiError: S.uploadRejected(file.name, (err as Error).message)
        });
      }
    },
    zoomToAoi() {
      if (store.get().mapCollapsed) actions.setMapCollapsed(false);
      store.set({ zoomToAoi: store.get().zoomToAoi + 1 });
    },
    async loadFields() {
      const collections = store.get().query.collections;
      const request = ++fieldsRequest;
      if (!collections.length) {
        store.set({ fields: [], fieldsLoading: false, fieldsError: '' });
        commit(store.get().filterRows);
        return;
      }
      store.set({ fieldsLoading: true, fieldsError: '' });
      try {
        const fields = await backend.queryables(collections);
        if (request !== fieldsRequest) return; // a newer selection won
        store.set({ fields, fieldsLoading: false });
        commit(store.get().filterRows);
      } catch (err) {
        if (request !== fieldsRequest) return;
        store.set({
          fields: [],
          fieldsLoading: false,
          fieldsError: (err as Error).message
        });
      }
    },
    addFilterRow() {
      const first = store.get().fields[0];
      const row: FilterRow = {
        // Derived from the current rows: rows may also come from Python (bindModel).
        id: Math.max(0, ...store.get().filterRows.map(r => r.id)) + 1,
        field: first?.name ?? '',
        op: '=',
        value: '',
        error: ''
      };
      store.set({
        filterRows: [...store.get().filterRows, row],
        sections: { ...store.get().sections, filters: true }
      });
    },
    updateFilterRow(id, patch) {
      commit(
        store.get().filterRows.map(r => (r.id === id ? { ...r, ...patch } : r))
      );
    },
    removeFilterRow(id) {
      commit(store.get().filterRows.filter(r => r.id !== id));
    },
    toggleSection(id) {
      const sections = store.get().sections;
      store.set({ sections: { ...sections, [id]: !sections[id] } });
    },
    setPanelCollapsed(collapsed) {
      if (collapsed && store.get().mapCollapsed) actions.setMapCollapsed(false);
      store.set({ panelCollapsed: collapsed });
      push('panel_collapsed', collapsed);
    },
    setPanelWidth(width, save = true) {
      store.set({ panelWidth: width });
      if (save) push('panel_width', width);
    },
    setMapCollapsed(collapsed) {
      if (collapsed && store.get().panelCollapsed)
        actions.setPanelCollapsed(false);
      store.set({ mapCollapsed: collapsed });
      push('map_collapsed', collapsed);
    },
    search() {
      store.set({ error: '', drawMode: null });
      backend.search(store.get().query);
    },
    cancel() {
      backend.cancel();
    },
    dismissError() {
      store.set({ error: '' });
    },
    activate(id) {
      store.set({ activeId: id });
      push('active_id', id);
    },
    toggleSelected(id) {
      const selectedIds = toggleId(store.get().selectedIds, id);
      store.set({ selectedIds });
      push('selected_ids', selectedIds);
    }
  };
  return actions;
}
