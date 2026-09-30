import { describe, expect, it } from 'vitest';
import { mountResults } from '../ui/results';
import { byRef as q, item, setupView as setup } from './helpers';

describe('results', () => {
  it('renders rows, cloud column, counts; row click activates, checkbox toggles', () => {
    const { el, store, actions } = setup();
    mountResults(el, store, actions);
    expect(q(el, 'empty').textContent).toBe('Run a search to see items.');
    store.set({
      items: [
        item('a'),
        item('b', { properties: { datetime: '2024-01-01T00:00:00Z' } })
      ],
      searched: true,
      matched: 40,
      selectedIds: ['b']
    });
    const rows = el.querySelectorAll('tr[data-id]');
    expect(rows).toHaveLength(2);
    expect(el.querySelector('thead')!.textContent).toContain('Cloud %');
    expect(q(el, 'count').textContent).toBe(
      '2 loaded · 1 selected · 40 matched'
    );
    expect((rows[1].querySelector('input') as HTMLInputElement).checked).toBe(
      true
    );
    (rows[0].children[2] as HTMLElement).click();
    expect(actions.activate).toHaveBeenCalledWith('a');
    expect(rows[0].classList.contains('jstex-active')).toBe(true);
    (rows[1].querySelector('input') as HTMLInputElement).click();
    expect(actions.toggleSelected).toHaveBeenCalledWith('b');
  });

  it('says when nothing matched', () => {
    const { el, store, actions } = setup();
    mountResults(el, store, actions);
    store.set({ items: [], searched: true });
    expect(q(el, 'empty').textContent).toBe('No items match this query.');
  });
});

describe('results — narrow layout support', () => {
  it('collection cells carry a class so narrow widgets can hide the column', () => {
    const { el, store, actions } = setup();
    mountResults(el, store, actions);
    store.set({ items: [item('a')], searched: true });
    expect(el.querySelectorAll('.jstex-col-collection')).toHaveLength(2); // th + td
  });
});
