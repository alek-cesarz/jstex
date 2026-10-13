/**
 * Backend interface the views talk to. Stage 1 has one implementation,
 * CommBackend (anywidget custom messages to the kernel); stage 3 adds a REST
 * backend for the JupyterLab panel. Search is push-based: results arrive via
 * `onPage`, so searches started from Python (`ex.search()`) render too.
 */
import type {
  AoiGeometry,
  CollectionSummary,
  FilterField,
  MinimalModel,
  LoginMessage,
  PageMessage,
  QueryStateDict
} from './types';

export interface Backend {
  listCollections(): Promise<CollectionSummary[]>;
  /** Filterable fields shared by all given collections. */
  queryables(collections: string[]): Promise<FilterField[]>;
  /** Validate an uploaded GeoJSON text; resolves to one Polygon/MultiPolygon. */
  uploadAoi(text: string): Promise<AoiGeometry>;
  search(query: QueryStateDict): void;
  cancel(): void;
  sync(): void;
  startLogin(method: 'device' | 'password', clientId?: string): void;
  submitPassword(username: string, password: string): void;
  cancelLogin(): void;
  logout(): void;
  dispose(): void;
}

export interface BackendEvents {
  onPage(msg: PageMessage): void;
  onLogin(msg: LoginMessage): void;
}

interface Pending {
  resolve(data: unknown): void;
  reject(err: Error): void;
}

export class CommBackend implements Backend {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly handler = (msg: unknown) => this.onMessage(msg);

  constructor(
    private readonly model: MinimalModel,
    private readonly events: BackendEvents
  ) {
    model.on('msg:custom', this.handler);
  }

  private request<T>(
    type: string,
    payload: Record<string, unknown> = {}
  ): Promise<T> {
    const req_id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(req_id, { resolve: d => resolve(d as T), reject });
      this.model.send({ type, req_id, ...payload });
    });
  }

  listCollections(): Promise<CollectionSummary[]> {
    return this.request('collections');
  }

  queryables(collections: string[]): Promise<FilterField[]> {
    return this.request('queryables', { collections });
  }

  uploadAoi(text: string): Promise<AoiGeometry> {
    return this.request('aoi_upload', { text });
  }

  search(query: QueryStateDict): void {
    this.model.send({ type: 'search', query });
  }

  cancel(): void {
    this.model.send({ type: 'cancel' });
  }

  sync(): void {
    this.model.send({ type: 'sync' });
  }

  startLogin(method: 'device' | 'password', clientId?: string): void {
    this.model.send({
      type: 'login_start',
      method,
      ...(clientId ? { client_id: clientId } : {})
    });
  }

  submitPassword(username: string, password: string): void {
    // Sent straight to the kernel; never kept in the store or a trait.
    this.model.send({ type: 'login_password', username, password });
  }

  cancelLogin(): void {
    this.model.send({ type: 'login_cancel' });
  }

  logout(): void {
    this.model.send({ type: 'logout' });
  }

  dispose(): void {
    this.model.off('msg:custom', this.handler);
    this.pending.forEach(p => p.reject(new Error('disposed')));
    this.pending.clear();
  }

  private onMessage(raw: unknown): void {
    const msg = raw as {
      type?: string;
      req_id?: number;
      ok?: boolean;
      data?: unknown;
      error?: string;
    };
    if (msg.type === 'reply' && typeof msg.req_id === 'number') {
      const p = this.pending.get(msg.req_id);
      if (!p) return;
      this.pending.delete(msg.req_id);
      if (msg.ok) p.resolve(msg.data);
      else p.reject(new Error(msg.error || 'Request failed'));
    } else if (msg.type === 'page') {
      this.events.onPage(raw as PageMessage);
    } else if (msg.type === 'login') {
      this.events.onLogin(raw as LoginMessage);
    }
  }
}
