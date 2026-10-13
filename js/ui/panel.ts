/**
 * Search panel (layout A): collapsible sections — Collections, Dates (UTC),
 * Area of interest, Filters — scrolling inside a panel as tall as the map,
 * with Search pinned at the bottom. Collapses (only when the user asks) to a
 * rail of icons with badges; a rail icon re-opens the panel at its section.
 */
import type { Actions } from '../actions';
import { escapeHtml } from '../format';
import { filterSummary } from '../filters';
import { ICON } from '../icons';
import type { Store } from '../store';
import { scrollWithin } from '../selection';
import { S } from '../strings';
import type { ExplorerState, SectionId } from '../types';
import { aoiSummary, mountAoiSection } from './aoi-section';
import { mountCollections } from './collections';
import { datesInverted, datesSummary, mountDates } from './dates';
import { mountFiltersSection } from './filters-section';
import { createSection } from './section';
import { mountSignin } from './signin';

/** Why Search is disabled ('' = enabled). */
export function searchBlocker(s: ExplorerState): string {
  if (!s.query.collections.length) return S.needCollection;
  if (s.filterRows.some(r => r.error)) return S.fixFilters;
  if (datesInverted(s.query.datetime)) return S.fromAfterTo;
  return '';
}

/** The section the Search hint points at (the blocker, or the missing area). */
function hintSection(s: ExplorerState): SectionId {
  if (!s.query.collections.length) return 'collections';
  if (s.filterRows.some(r => r.error)) return 'filters';
  if (datesInverted(s.query.datetime)) return 'dates';
  return 'aoi';
}

export function mountPanel(
  el: HTMLElement,
  store: Store<ExplorerState>,
  actions: Actions
): () => void {
  el.innerHTML = `
    <div class="jstex-panel" data-ref="panel">
      <div class="jstex-panel__scroll" data-ref="scroll"></div>
      <div class="jstex-panel__foot">
        <div class="jstex-row">
          <button type="button" class="jstex-control jstex-primary jstex-grow" data-ref="search">${ICON.search}<span>${escapeHtml(S.search)}</span></button>
          <button type="button" class="jstex-control" data-ref="cancel">${escapeHtml(S.cancel)}</button>
        </div>
        <button type="button" class="jstex-hint jstex-reason" data-ref="reason"></button>
        <div data-slot="signin"></div>
        <div class="jstex-error" role="alert" data-ref="errorBanner">
          <span data-ref="errorText"></span>
          <button type="button" class="jstex-control" data-ref="retry">${escapeHtml(S.retry)}</button>
          <button type="button" class="jstex-icon" data-ref="dismiss" title="${escapeHtml(S.dismiss)}" aria-label="${escapeHtml(S.dismiss)}">${ICON.close}</button>
        </div>
      </div>
      <button type="button" class="jstex-panel__collapse" data-ref="collapse" title="${escapeHtml(S.collapsePanel)}" aria-label="${escapeHtml(S.collapsePanel)}">${ICON.chevronLeft}</button>
    </div>
    <div class="jstex-rail" data-ref="rail">
      <button type="button" class="jstex-icon" data-rail="expand" title="${escapeHtml(S.expandPanel)}" aria-label="${escapeHtml(S.expandPanel)}">${ICON.chevronRight}</button>
      <button type="button" class="jstex-icon" data-rail="collections" aria-label="${escapeHtml(S.collections)}">${ICON.layers}<sup></sup></button>
      <button type="button" class="jstex-icon" data-rail="dates" aria-label="${escapeHtml(S.dates)}">${ICON.calendar}<sup></sup></button>
      <button type="button" class="jstex-icon" data-rail="aoi" aria-label="${escapeHtml(S.aoi)}">${ICON.polygon}<sup></sup></button>
      <button type="button" class="jstex-icon" data-rail="filters" aria-label="${escapeHtml(S.filters)}">${ICON.filter}<sup></sup></button>
      <button type="button" class="jstex-icon jstex-primary" data-rail="search" title="${escapeHtml(S.search)}" aria-label="${escapeHtml(S.search)}">${ICON.search}</button>
    </div>`;
  const ref = <T extends HTMLElement = HTMLElement>(name: string) =>
    el.querySelector(`[data-ref="${name}"]`) as T;
  const scroll = ref('scroll');

  const sections = {
    collections: createSection('collections', S.collections),
    dates: createSection('dates', S.dates, S.utc),
    aoi: createSection('aoi', S.aoi),
    filters: createSection('filters', S.filters)
  };
  Object.values(sections).forEach(sec => scroll.appendChild(sec.el));
  const cleanups = [
    mountCollections(sections.collections.body, store, actions),
    mountDates(sections.dates.body, store, actions),
    mountAoiSection(sections.aoi.body, store, actions),
    mountFiltersSection(sections.filters.body, store, actions),
    mountSignin(
      el.querySelector('[data-slot="signin"]') as HTMLElement,
      store,
      actions
    )
  ];

  const summaries = (
    s: ExplorerState
  ): Record<SectionId, [string, string]> => ({
    collections: [
      s.query.collections.join(', '),
      s.query.collections.length ? String(s.query.collections.length) : ''
    ],
    dates: [datesSummary(s.query.datetime), s.query.datetime ? '•' : ''],
    aoi: [
      aoiSummary(s.query.aois.find(a => a.selected)?.geometry),
      s.query.aois.length ? '•' : ''
    ],
    filters: [
      filterSummary(s.query.filters, s.fields),
      s.query.filters.length ? String(s.query.filters.length) : ''
    ]
  });

  const update = (s: ExplorerState) => {
    const sum = summaries(s);
    (Object.keys(sections) as SectionId[]).forEach(id => {
      sections[id].update(s.sections[id], sum[id][0], sum[id][1]);
      const railBtn = el.querySelector<HTMLElement>(`[data-rail="${id}"]`)!;
      railBtn.title = sum[id][0]
        ? `${railBtn.getAttribute('aria-label')}: ${sum[id][0]}`
        : railBtn.getAttribute('aria-label')!;
      railBtn.querySelector('sup')!.textContent = sum[id][1];
    });
    ref('panel').hidden = s.panelCollapsed;
    ref('rail').hidden = !s.panelCollapsed;

    const searching = s.status === 'searching';
    const blocker = searchBlocker(s);
    const hasArea = s.query.aois.some(a => a.selected);
    const hasDates = Boolean(s.query.datetime?.from || s.query.datetime?.to);
    ref<HTMLButtonElement>('search').disabled = Boolean(blocker) || searching;
    el.querySelector<HTMLButtonElement>('[data-rail="search"]')!.disabled =
      Boolean(blocker) || searching;
    ref('search').classList.toggle('jstex-busy', searching);
    ref('cancel').hidden = !(searching && s.canCancel);
    const reason =
      blocker ||
      (!hasArea && !hasDates ? S.noConstraint(s.query.pageSize) : '');
    ref('reason').textContent = reason;
    ref('reason').hidden = !reason;
    ref('reason').classList.toggle('jstex-hint--warn', Boolean(reason));
    ref('errorBanner').hidden = !s.error;
    ref('errorText').textContent = s.error;
  };

  el.addEventListener('click', e => {
    const target = e.target as HTMLElement;
    const head = target.closest<HTMLElement>('[data-toggle-section]');
    if (head) {
      actions.toggleSection(head.dataset.toggleSection as SectionId);
      return;
    }
    const rail = target.closest<HTMLElement>('[data-rail]');
    if (!rail) return;
    const what = rail.dataset.rail!;
    if (what === 'search') {
      actions.search();
      return;
    }
    actions.setPanelCollapsed(false);
    if (what !== 'expand') {
      const id = what as SectionId;
      if (!store.get().sections[id]) actions.toggleSection(id);
      sections[id].el.scrollIntoView?.({ block: 'nearest' });
    }
  });
  ref('search').addEventListener('click', () => actions.search());
  ref('cancel').addEventListener('click', () => actions.cancel());
  ref('retry').addEventListener('click', () => actions.search());
  ref('dismiss').addEventListener('click', () => actions.dismissError());
  ref('collapse').addEventListener('click', () =>
    actions.setPanelCollapsed(true)
  );
  // "Why is Search disabled?" — jump to the problem: open its section and
  // scroll it into view inside the panel (a filter error may be scrolled away).
  ref('reason').addEventListener('click', () => {
    const s = store.get();
    const id = hintSection(s);
    if (!s.sections[id]) actions.toggleSection(id);
    const invalidRow =
      id === 'filters'
        ? scroll
            .querySelector<HTMLElement>('.jstex-invalid')
            ?.closest<HTMLElement>('[data-row]')
        : null;
    scrollWithin(scroll, invalidRow ?? sections[id].el);
  });

  update(store.get());
  const unsubscribe = store.subscribe(update);
  return () => {
    unsubscribe();
    cleanups.forEach(fn => fn());
  };
}
