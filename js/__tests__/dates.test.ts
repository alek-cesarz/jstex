import { describe, expect, it } from 'vitest';
import { datesSummary, mountDates } from '../ui/dates';
import { byRef as q, setupView } from './helpers';

describe('dates section', () => {
  it('either end may be set; values map to UTC day bounds; Clear resets both', () => {
    const { el, store, actions } = setupView();
    mountDates(el, store, actions);
    const from = q(el, 'from') as HTMLInputElement;
    const to = q(el, 'to') as HTMLInputElement;
    expect(q(el, 'clear').hidden).toBe(true);
    to.value = '2024-07-31';
    to.dispatchEvent(new Event('change'));
    expect(store.get().query.datetime).toEqual({ to: '2024-07-31T23:59:59Z' });
    from.value = '2024-07-01';
    from.dispatchEvent(new Event('change'));
    expect(store.get().query.datetime).toEqual({
      from: '2024-07-01T00:00:00Z',
      to: '2024-07-31T23:59:59Z'
    });
    expect(q(el, 'clear').hidden).toBe(false);
    q(el, 'clear').click();
    expect(store.get().query.datetime).toBeNull();
    expect([from.value, to.value]).toEqual(['', '']);
  });

  it('reflects a query set from Python and summarises open ends', () => {
    const { el, store, actions } = setupView();
    mountDates(el, store, actions);
    store.set({
      query: {
        ...store.get().query,
        datetime: { from: '2023-01-01T00:00:00Z' }
      }
    });
    expect((q(el, 'from') as HTMLInputElement).value).toBe('2023-01-01');
    expect(datesSummary({ from: '2023-01-01T00:00:00Z' })).toBe(
      '2023-01-01 → open'
    );
    expect(datesSummary({ to: '2023-02-01T23:59:59Z' })).toBe(
      'open → 2023-02-01'
    );
    expect(datesSummary(null)).toBe('');
  });
});
