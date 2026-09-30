import { describe, expect, it } from 'vitest';
import { mountCollections, visibleCollections } from '../ui/collections';
import { byRef as q, setupView } from './helpers';

const COLLS = [
  {
    id: 'sentinel-2-l2a',
    title: 'Sentinel-2 Level-2A',
    description: 'Surface reflectance',
    license: 'other',
    start: '2015-06-27T10:25:31Z',
    end: null
  },
  { id: 'sentinel-2-l1c', title: 'Sentinel-2 Level-1C' },
  { id: 'landsat-c2-l2', title: 'Landsat Collection 2 Level-2' }
];

describe('collections', () => {
  it('visibleCollections: search by title or id, keep selected, only-selected', () => {
    expect(
      visibleCollections(COLLS, [], 'landsat', false).map(c => c.id)
    ).toEqual(['landsat-c2-l2']);
    expect(visibleCollections(COLLS, [], 'L1C', false).map(c => c.id)).toEqual([
      'sentinel-2-l1c'
    ]);
    expect(
      visibleCollections(COLLS, ['sentinel-2-l2a'], 'landsat', false).map(
        c => c.id
      )
    ).toEqual(['sentinel-2-l2a', 'landsat-c2-l2']);
    expect(
      visibleCollections(COLLS, ['sentinel-2-l1c'], '', true).map(c => c.id)
    ).toEqual(['sentinel-2-l1c']);
  });

  it('renders loading, then the list with a count; typing filters; ticking selects', () => {
    const { el, store, actions } = setupView();
    mountCollections(el, store, actions);
    expect(el.textContent).toContain('Loading collections…');
    store.set({ collections: COLLS, collectionsLoading: false });
    expect(el.querySelectorAll('.jstex-coll')).toHaveLength(3);
    expect(q(el, 'collCount').textContent).toBe('3 of 3');
    const search = q(el, 'collSearch') as HTMLInputElement;
    search.value = 'sentinel';
    search.dispatchEvent(new Event('input'));
    expect(el.querySelectorAll('.jstex-coll')).toHaveLength(2);
    const cb = el.querySelector(
      'input[value="sentinel-2-l1c"]'
    ) as HTMLInputElement;
    cb.checked = true;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
    expect(actions.setQuery).toHaveBeenCalledWith({
      collections: ['sentinel-2-l1c']
    });
    expect(
      el
        .querySelector('[data-id="sentinel-2-l1c"]')!
        .classList.contains('jstex-coll--sel')
    ).toBe(true);
  });

  it('ⓘ expands description, time range and license; state survives re-render', () => {
    const { el, store, actions } = setupView();
    mountCollections(el, store, actions);
    store.set({ collections: COLLS, collectionsLoading: false });
    (el.querySelector('[data-info="sentinel-2-l2a"]') as HTMLElement).click();
    const about = el.querySelector('.jstex-coll__about')!;
    expect(about.textContent).toContain('Surface reflectance');
    expect(about.textContent).toContain(
      '2015-06-27 → ongoing · License: other'
    );
    store.set({
      query: { ...store.get().query, collections: ['landsat-c2-l2'] }
    });
    expect(el.querySelector('.jstex-coll__about')).not.toBeNull();
  });

  it('only-selected hides the rest; an empty search result says so', () => {
    const { el, store, actions } = setupView();
    mountCollections(el, store, actions);
    store.set({
      collections: COLLS,
      collectionsLoading: false,
      query: { ...store.get().query, collections: ['landsat-c2-l2'] }
    });
    const only = q(el, 'onlySelected') as HTMLInputElement;
    only.checked = true;
    only.dispatchEvent(new Event('change'));
    expect(el.querySelectorAll('.jstex-coll')).toHaveLength(1);
    only.checked = false;
    only.dispatchEvent(new Event('change'));
    store.set({ query: { ...store.get().query, collections: [] } });
    const search = q(el, 'collSearch') as HTMLInputElement;
    search.value = 'modis';
    search.dispatchEvent(new Event('input'));
    expect(el.textContent).toContain('No collections match.');
  });
});
