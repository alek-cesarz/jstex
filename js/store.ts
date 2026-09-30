/** Minimal per-instance observable store (one per rendered widget view). */

export interface Store<T> {
  get(): T;
  set(patch: Partial<T>): void;
  subscribe(fn: (state: T, prev: T) => void): () => void;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const subscribers = new Set<(state: T, prev: T) => void>();
  return {
    get: () => state,
    set(patch) {
      const prev = state;
      state = { ...state, ...patch };
      subscribers.forEach(fn => fn(state, prev));
    },
    subscribe(fn) {
      subscribers.add(fn);
      return () => {
        subscribers.delete(fn);
      };
    }
  };
}
