/**
 * Collection search: search box (title or id), "Only selected", "n of N",
 * rows with checkbox, title, id and an ⓘ that expands description, time
 * extent and license inline (as in STEX, without tags). Selected collections
 * always stay listed, whatever the search text.
 */
import type { Actions } from '../actions';
import { escapeHtml } from '../format';
import { ICON } from '../icons';
import type { Store } from '../store';
import { S } from '../strings';
import type { CollectionSummary, ExplorerState } from '../types';

type CollectionActions = Pick<Actions, 'setQuery'>;

export function visibleCollections(
  all: CollectionSummary[],
  selected: string[],
  search: string,
  onlySelected: boolean
): CollectionSummary[] {
  const needle = search.trim().toLowerCase();
  const chosen = new Set(selected);
  return all.filter(c => {
    if (chosen.has(c.id)) return true;
    if (onlySelected) return false;
    return (
      !needle ||
      c.id.toLowerCase().includes(needle) ||
      c.title.toLowerCase().includes(needle)
    );
  });
}

function aboutHtml(c: CollectionSummary): string {
  const day = (iso?: string | null) => (iso ? iso.slice(0, 10) : '');
  const range = c.start
    ? S.timeRange(day(c.start), c.end ? day(c.end) : S.ongoing)
    : '';
  const meta = [range, c.license ? S.license(c.license) : '']
    .filter(Boolean)
    .join(' · ');
  return `<div class="jstex-coll__about">${c.description ? `<p>${escapeHtml(c.description)}</p>` : ''}${
    meta ? `<div class="jstex-muted">${escapeHtml(meta)}</div>` : ''
  }</div>`;
}

export function mountCollections(
  el: HTMLElement,
  store: Store<ExplorerState>,
  actions: CollectionActions
): () => void {
  el.innerHTML = `
    <div class="jstex-search-box">${ICON.search}
      <input type="search" data-ref="collSearch" placeholder="${escapeHtml(S.collectionsSearch)}" aria-label="${escapeHtml(S.collectionsSearch)}">
    </div>
    <div class="jstex-row jstex-between">
      <label class="jstex-switch"><input type="checkbox" data-ref="onlySelected"><span class="jstex-switch__track"></span>${escapeHtml(S.onlySelected)}</label>
      <span class="jstex-muted jstex-small" data-ref="collCount"></span>
    </div>
    <div class="jstex-coll-list" data-ref="collList"></div>`;
  const ref = <T extends HTMLElement = HTMLElement>(name: string) =>
    el.querySelector(`[data-ref="${name}"]`) as T;
  const search = ref<HTMLInputElement>('collSearch');
  const onlySelected = ref<HTMLInputElement>('onlySelected');
  const list = ref('collList');
  // DOM-only state lives here, not in the DOM: the list is re-rendered.
  const expanded = new Set<string>();

  const render = () => {
    const s = store.get();
    if (s.collectionsLoading || s.collectionsError || !s.collections.length) {
      list.innerHTML = `<div class="jstex-empty jstex-muted">${escapeHtml(
        s.collectionsLoading
          ? S.collectionsLoading
          : s.collectionsError || S.collectionsEmpty
      )}</div>`;
      ref('collCount').textContent = '';
      return;
    }
    const selected = new Set(s.query.collections);
    const shown = visibleCollections(
      s.collections,
      s.query.collections,
      search.value,
      onlySelected.checked
    );
    ref('collCount').textContent = S.collectionsCount(
      shown.length,
      s.collections.length
    );
    list.innerHTML = shown.length
      ? shown
          .map(c => {
            const sel = selected.has(c.id);
            const open = expanded.has(c.id);
            return `<div class="jstex-coll${sel ? ' jstex-coll--sel' : ''}" data-id="${escapeHtml(c.id)}">
              <label class="jstex-coll__main">
                <input type="checkbox" data-toggle value="${escapeHtml(c.id)}"${sel ? ' checked' : ''}>
                <span class="jstex-coll__text"><span class="jstex-coll__title">${escapeHtml(c.title)}</span>
                <span class="jstex-mono jstex-muted">${escapeHtml(c.id)}</span></span>
              </label>
              <button type="button" class="jstex-icon jstex-coll__info" data-info="${escapeHtml(c.id)}"
                aria-expanded="${open}" title="${escapeHtml(S.collectionInfo)}" aria-label="${escapeHtml(S.collectionInfo)}">${ICON.info}</button>
            </div>${open ? aboutHtml(c) : ''}`;
          })
          .join('')
      : `<div class="jstex-empty jstex-muted">${escapeHtml(S.collectionsNoMatch)}</div>`;
  };

  list.addEventListener('change', e => {
    const cb = (e.target as HTMLElement).closest<HTMLInputElement>(
      'input[data-toggle]'
    );
    if (!cb) return;
    const current = store.get().query.collections;
    actions.setQuery({
      collections: cb.checked
        ? [...current, cb.value]
        : current.filter(id => id !== cb.value)
    });
  });
  list.addEventListener('click', e => {
    const info = (e.target as HTMLElement).closest<HTMLElement>('[data-info]');
    if (!info) return;
    const id = info.dataset.info!;
    if (expanded.has(id)) expanded.delete(id);
    else expanded.add(id);
    render();
  });
  search.addEventListener('input', render);
  onlySelected.addEventListener('change', render);

  render();
  return store.subscribe((s, prev) => {
    if (
      s.collections !== prev.collections ||
      s.collectionsLoading !== prev.collectionsLoading ||
      s.collectionsError !== prev.collectionsError ||
      s.query.collections !== prev.query.collections
    ) {
      render();
    }
  });
}
