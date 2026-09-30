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

  it('uses text fields (no native date pickers) and accepts a UTC time', () => {
    const { el, store, actions } = setupView();
    mountDates(el, store, actions);
    const from = q(el, 'from') as HTMLInputElement;
    expect(from.type).toBe('text');
    expect(from.placeholder).toBe('YYYY-MM-DD HH:MM');
    from.value = '2024-07-01 10:30';
    from.dispatchEvent(new Event('change'));
    expect(store.get().query.datetime).toEqual({
      from: '2024-07-01T10:30:00Z'
    });
    expect(datesSummary(store.get().query.datetime)).toBe(
      '2024-07-01 10:30 → open'
    );
  });

  it('invalid text shows an error and keeps the query; From after To is flagged', () => {
    const { el, store, actions } = setupView();
    mountDates(el, store, actions);
    const from = q(el, 'from') as HTMLInputElement;
    const to = q(el, 'to') as HTMLInputElement;
    to.value = '2024-13-01';
    to.dispatchEvent(new Event('change'));
    expect(store.get().query.datetime).toBeNull();
    expect(q(el, 'error').hidden).toBe(false);
    expect(q(el, 'error').textContent).toBe(
      'To: use YYYY-MM-DD or YYYY-MM-DD HH:MM (UTC).'
    );
    expect(to.classList.contains('jstex-invalid')).toBe(true);
    to.value = '2024-07-01';
    to.dispatchEvent(new Event('change'));
    expect(q(el, 'error').hidden).toBe(true);
    from.value = '2024-08-01';
    from.dispatchEvent(new Event('change'));
    expect(store.get().query.datetime).toEqual({
      from: '2024-08-01T00:00:00Z',
      to: '2024-07-01T23:59:59Z'
    });
    expect(q(el, 'error').textContent).toBe('From is after To.');
    expect(from.classList.contains('jstex-invalid')).toBe(true);
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
