/** Shared front-end types. Mirrors the Python widget protocol (jstex/widget.py). */

export type AoiGeometry = GeoJSON.Polygon | GeoJSON.MultiPolygon;

export interface Aoi {
  geometry: AoiGeometry;
  selected: boolean;
}

export type FilterOp = '=' | '!=' | '<' | '<=' | '>' | '>=' | 'IN';

/** A committed attribute filter (the QueryState / ?q= form). */
export interface FilterPredicate {
  field: string;
  op: FilterOp;
  value: unknown;
}

/** A filterable field, from StacBackend.merged_queryables(). */
export interface FilterField {
  name: string;
  title: string;
  type: 'string' | 'number' | 'integer' | 'boolean';
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
}

/** An editable row of the filter builder (UI state; raw text value). */
export interface FilterRow {
  id: number;
  field: string;
  op: FilterOp;
  value: string;
  error: string;
}

export type DrawMode = 'Polygon' | 'Box';
export type SectionId = 'collections' | 'dates' | 'aoi' | 'filters';

/** QueryState dict form — identical keys to jstex.query.QueryState.to_dict(). */
export interface QueryStateDict {
  collections: string[];
  datetime: { from?: string; to?: string } | null;
  aois: Aoi[];
  filters: FilterPredicate[];
  sort: { field: string; direction: 'asc' | 'desc' };
  pageSize: number;
}

export interface StacLink {
  rel: string;
  href: string;
  type?: string;
  title?: string;
}

export interface StacAsset {
  href: string;
  title?: string;
  type?: string;
  roles?: string[];
  alternate?: Record<string, { href?: string }>;
  [key: string]: unknown;
}

export interface StacItem {
  id: string;
  collection?: string;
  geometry: GeoJSON.Geometry | null;
  bbox?: number[];
  properties: Record<string, unknown>;
  assets: Record<string, StacAsset>;
  links: StacLink[];
}

export interface CollectionSummary {
  id: string;
  title: string;
  description?: string;
  license?: string;
  start?: string | null;
  end?: string | null;
}

export type Status = 'idle' | 'searching' | 'error';

/** One XYZ basemap, key and retina already applied by Python (jstex.config.Basemap). */
export interface BasemapSource {
  url: string;
  attribution: string;
  /** 'style': MapLibre/Mapbox style JSON (vector); 'xyz': raster tile template. */
  kind?: 'style' | 'xyz';
}

/** Deployment basemaps (JSTEX_BASEMAP_{LIGHT,DARK}_* env vars). */
export interface BasemapConfig {
  light: BasemapSource;
  dark: BasemapSource;
}
export type AuthSource = 'hub' | 'env' | 'anonymous';

export interface ExplorerState {
  collections: CollectionSummary[];
  collectionsLoading: boolean;
  collectionsError: string;
  query: QueryStateDict;
  items: StacItem[];
  matched: number | null;
  searched: boolean;
  selectedIds: string[];
  activeId: string | null;
  status: Status;
  error: string;
  authSource: AuthSource;
  canCancel: boolean;
  mapHeight: number;
  basemap: BasemapConfig;
  dark: boolean;
  /** Active draw tool, or null. One AOI only: finishing a drawing replaces it. */
  drawMode: DrawMode | null;
  aoiError: string;
  /** Bumped to ask the map to zoom to the AOI. */
  zoomToAoi: number;
  fields: FilterField[];
  fieldsLoading: boolean;
  fieldsError: string;
  filterRows: FilterRow[];
  panelCollapsed: boolean;
  /** Search panel width in px (drag the splitter); clamped by the layout. */
  panelWidth: number;
  /** Map folded to a rail; never together with panelCollapsed. */
  mapCollapsed: boolean;
  sections: Record<SectionId, boolean>;
}

export interface PageMessage {
  type: 'page';
  items: StacItem[];
  matched: number | null;
}

/** The subset of the anywidget model API jstex uses (keeps tests free of anywidget). */
export interface MinimalModel {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  save_changes(): void;
  on(event: string, cb: (...args: any[]) => void): void;
  off(event?: string | null, cb?: ((...args: any[]) => void) | null): void;
  send(content: unknown): void;
}
