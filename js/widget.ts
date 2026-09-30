/**
 * anywidget entry point. One render() = one independent view with its own
 * store; nothing is module-global, so several explorers (or several views of
 * one explorer) coexist in a notebook.
 *
 * Layout A: search panel | splitter | map (same height, drag-resizable
 * together; see ui/layout.ts), then results and item details below. Below
 * ~760 px the panel stacks above the map.
 */
import './define-guard'; // must stay first: see define-guard.ts
import '@eox/map';
import '@eox/drawtools';
import type { RenderProps } from '@anywidget/types';
import { createActions } from './actions';
import { CommBackend } from './backend';
import { applyPage, bindModel, stateFromModel } from './model-sync';
import { createStore } from './store';
import { S } from './strings';
import { isDark, watchTheme } from './theme';
import type { MinimalModel } from './types';
import { mountDetails } from './ui/details';
import { mountLayout } from './ui/layout';
import { mountMap } from './ui/map';
import { mountPanel } from './ui/panel';
import { mountResults } from './ui/results';
import './styles.css';

function render({ model, el }: RenderProps): () => void {
  const m = model as unknown as MinimalModel;

  const root = document.createElement('div');
  root.className = 'jstex';
  root.innerHTML = `
    <div class="jstex-body" data-ref="body">
      <div class="jstex-body__panel" data-slot="panel"></div>
      <div class="jstex-body__map" data-slot="map"></div>
    </div>
    <div data-slot="results"></div>
    <div data-slot="details"></div>`;
  el.appendChild(root);
  const slot = (name: string) =>
    root.querySelector(`[data-slot="${name}"]`) as HTMLElement;

  const store = createStore({ ...stateFromModel(m), dark: isDark() });
  const backend = new CommBackend(m, { onPage: msg => applyPage(store, msg) });
  const actions = createActions(m, store, backend, S);

  const stopTheme = watchTheme(() => store.set({ dark: isDark() }));
  const unsubscribe = store.subscribe((s, prev) => {
    // Filterable fields follow the collection selection (also when Python sets ex.query).
    if (s.query.collections !== prev.query.collections)
      void actions.loadFields();
  });

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && store.get().drawMode) actions.setDrawMode(null);
  };
  root.addEventListener('keydown', onKey);

  const cleanups = [
    bindModel(m, store),
    mountLayout(root, store, actions),
    mountPanel(slot('panel'), store, actions),
    mountMap(slot('map'), store, actions),
    mountResults(slot('results'), store, actions),
    mountDetails(slot('details'), store, actions)
  ];

  backend
    .listCollections()
    .then(collections =>
      store.set({
        collections,
        collectionsLoading: false,
        collectionsError: ''
      })
    )
    .catch((err: Error) => {
      if (err.message !== 'disposed')
        store.set({ collectionsLoading: false, collectionsError: err.message });
    });
  if (store.get().query.collections.length) void actions.loadFields();
  backend.sync(); // a re-rendered view gets the kernel's current results

  return () => {
    root.removeEventListener('keydown', onKey);
    stopTheme();
    unsubscribe();
    cleanups.forEach(fn => fn());
    backend.dispose();
    root.remove();
  };
}

export default { render };
