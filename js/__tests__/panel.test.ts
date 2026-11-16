import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountPanel, searchBlocker } from '../ui/panel';
import { BOX, byRef as q, flush, setupView } from './helpers';

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

  it('From after To blocks Search; the reason opens the section at fault', () => {
    const { el, store, actions } = setupView();
    mountPanel(el, store, actions);
    actions.setQuery({
      collections: ['c1'],
      datetime: { from: '2024-08-01T00:00:00Z', to: '2024-07-01T23:59:59Z' }
    });
    expect(searchBlocker(store.get())).toBe('From is after To.');
    expect((q(el, 'search') as HTMLButtonElement).disabled).toBe(true);
    actions.toggleSection('dates');
    q(el, 'reason').click();
    expect(store.get().sections.dates).toBe(true);
    // The "no area or dates" hint points at the area of interest.
    actions.setQuery({ datetime: null });
    actions.toggleSection('aoi');
    q(el, 'reason').click();
    expect(store.get().sections.aoi).toBe(true);
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
    expect(q(el, 'statusText').textContent).toBe(
      'Not signed in — restricted collections are hidden.'
    );
    store.set({ authSource: 'hub' });
    expect(q(el, 'statusText').textContent).toBe('Signed in (hub)');
    store.set({ status: 'searching', canCancel: true, error: 'Rate limited' });
    expect(q(el, 'cancel').hidden).toBe(false);
    expect(q(el, 'errorText').textContent).toBe('Rate limited');
    q(el, 'retry').click();
    expect(actions.search).toHaveBeenCalled();
  });
});

describe('search panel — jump to the problem', () => {
  it('clicking the reason opens the filters section when a filter is invalid', async () => {
    const { el, store, actions } = setupView();
    mountPanel(el, store, actions);
    actions.setQuery({ collections: ['c1'] });
    await actions.loadFields();
    actions.addFilterRow();
    actions.updateFilterRow(store.get().filterRows[0].id, { value: 'x' });
    actions.toggleSection('filters');
    expect(store.get().sections.filters).toBe(false);
    q(el, 'reason').click();
    expect(store.get().sections.filters).toBe(true);
  });

  it('clicking the reason opens the collections section when none is selected', () => {
    const { el, store, actions } = setupView();
    mountPanel(el, store, actions);
    actions.toggleSection('collections');
    q(el, 'reason').click();
    expect(store.get().sections.collections).toBe(true);
  });
});

describe('search panel — Copy query', () => {
  const clip = () => {
    const writeText = vi.fn(async (_t: string) => {});
    Object.defineProperty(window, 'isSecureContext', {
      value: true,
      configurable: true
    });
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true
    });
    return writeText;
  };
  afterEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      configurable: true
    });
  });

  it('copies the STAC GET /search URL for the current query', async () => {
    const writeText = clip();
    const { el, store, actions, backend } = setupView();
    backend.queryUrl.mockResolvedValue({
      url: 'https://stac.test/v1/search?collections=c1&limit=50',
      notes: []
    });
    mountPanel(el, store, actions);
    const btn = q(el, 'copyQuery') as HTMLButtonElement;
    expect(btn.textContent!.trim()).toBe('Copy query');
    expect(btn.disabled).toBe(true); // same rule as Search
    actions.setQuery({ collections: ['c1'] });
    expect(btn.disabled).toBe(false);
    btn.click();
    await flush();
    await flush();
    expect(backend.queryUrl).toHaveBeenCalledWith(store.get().query);
    expect(writeText).toHaveBeenCalledWith(
      'https://stac.test/v1/search?collections=c1&limit=50'
    );
    expect(q(el, 'copyNote').textContent).toBe(
      'Copied the STAC GET /search URL of this query.'
    );
  });

  it("shows Python's notice (e.g. the bbox fallback) and errors", async () => {
    clip();
    const { el, store, actions, backend } = setupView();
    backend.queryUrl.mockResolvedValueOnce({
      url: 'https://stac.test/v1/search?bbox=1,2,3,4',
      notes: ['The area makes the search URL longer than 2000 characters.']
    });
    mountPanel(el, store, actions);
    actions.setQuery({ collections: ['c1'] });
    (q(el, 'copyQuery') as HTMLButtonElement).click();
    await flush();
    await flush();
    expect(q(el, 'copyNote').textContent).toContain('longer than 2000');
    expect(q(el, 'copyNote').classList.contains('jstex-hint--warn')).toBe(true);
    backend.queryUrl.mockRejectedValueOnce(new Error('Invalid query URL'));
    (q(el, 'copyQuery') as HTMLButtonElement).click();
    await flush();
    await flush();
    expect(q(el, 'copyNote').textContent).toBe('Invalid query URL');
    // the note goes when the query changes
    actions.setQuery({ pageSize: 20 });
    expect(q(el, 'copyNote').hidden).toBe(true);
  });
});
