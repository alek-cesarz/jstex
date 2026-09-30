import { describe, expect, it } from 'vitest';
import { mountPanel, searchBlocker } from '../ui/panel';
import { BOX, byRef as q, setupView } from './helpers';

describe('search panel', () => {
  it('Search needs a collection and valid filters; the reason is shown', async () => {
    const { el, store, actions } = setupView();
    mountPanel(el, store, actions);
    expect(searchBlocker(store.get())).toBe('Select at least one collection.');
    expect((q(el, 'search') as HTMLButtonElement).disabled).toBe(true);
    expect(q(el, 'reason').textContent).toBe('Select at least one collection.');
    actions.setQuery({ collections: ['c1'] });
    expect((q(el, 'search') as HTMLButtonElement).disabled).toBe(false);
    expect(q(el, 'reason').textContent).toBe(
      'No area or dates set — showing the first 50 matches.'
    );
    actions.setAoi(BOX);
    expect(q(el, 'reason').hidden).toBe(true);
    await actions.loadFields();
    actions.addFilterRow();
    actions.updateFilterRow(store.get().filterRows[0].id, { value: 'x' });
    expect(q(el, 'reason').textContent).toBe(
      'Fix the filters above to search.'
    );
    expect((q(el, 'search') as HTMLButtonElement).disabled).toBe(true);
  });

  it('closed sections show a summary and badge', () => {
    const { el, store, actions } = setupView();
    mountPanel(el, store, actions);
    actions.setQuery({
      collections: ['c1', 'c2'],
      datetime: { from: '2024-07-01T00:00:00Z' }
    });
    actions.setAoi(BOX);
    for (const id of ['collections', 'dates', 'aoi'] as const)
      actions.toggleSection(id);
    const sum = (id: string) =>
      el.querySelector(`[data-panel-section="${id}"] .jstex-section__sum`)!
        .textContent;
    expect(sum('collections')).toBe('c1, c2');
    expect(sum('dates')).toBe('2024-07-01 → open');
    expect(sum('aoi')).toBe('Polygon · 8,666 km²');
    expect(
      el.querySelector('[data-panel-section="collections"] .jstex-badge')!
        .textContent
    ).toBe('2');
    (el.querySelector('[data-toggle-section="dates"]') as HTMLElement).click();
    expect(store.get().sections.dates).toBe(true);
  });

  it('collapses to a rail with badges; a rail icon re-opens its section', () => {
    const { el, store, actions, model } = setupView();
    mountPanel(el, store, actions);
    actions.setQuery({ collections: ['c1'] });
    actions.toggleSection('filters');
    q(el, 'collapse').click();
    expect(q(el, 'panel').hidden).toBe(true);
    expect(q(el, 'rail').hidden).toBe(false);
    expect(model.values.panel_collapsed).toBe(true);
    const railColl = el.querySelector(
      '[data-rail="collections"]'
    ) as HTMLElement;
    expect(railColl.title).toBe('Collections: c1');
    expect(railColl.querySelector('sup')!.textContent).toBe('1');
    (el.querySelector('[data-rail="filters"]') as HTMLElement).click();
    expect(q(el, 'panel').hidden).toBe(false);
    expect(store.get().sections.filters).toBe(true);
    (el.querySelector('[data-rail="search"]') as HTMLElement).click();
    expect(actions.search).toHaveBeenCalled();
  });

  it('sign-in line, cancel and error banner follow state', () => {
    const { el, store, actions } = setupView();
    mountPanel(el, store, actions);
    store.set({ collectionsLoading: false, authSource: 'anonymous' });
    expect(q(el, 'authText').textContent).toBe(
      'Not signed in — restricted collections are hidden.'
    );
    store.set({ authSource: 'hub' });
    expect(q(el, 'authText').textContent).toBe(
      'Signed in — restricted collections included.'
    );
    store.set({ status: 'searching', canCancel: true, error: 'Rate limited' });
    expect(q(el, 'cancel').hidden).toBe(false);
    expect(q(el, 'errorText').textContent).toBe('Rate limited');
    q(el, 'retry').click();
    expect(actions.search).toHaveBeenCalled();
  });
});
