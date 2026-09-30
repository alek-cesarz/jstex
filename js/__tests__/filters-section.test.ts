import { describe, expect, it } from 'vitest';
import { mountFiltersSection } from '../ui/filters-section';
import { byRef as q, setupView } from './helpers';

async function ready() {
  const view = setupView();
  mountFiltersSection(view.el, view.store, view.actions);
  view.actions.setQuery({ collections: ['c1', 'c2'] });
  await view.actions.loadFields();
  return view;
}

describe('filters section', () => {
  it('asks for a collection first; then offers shared fields', async () => {
    const { el, store, actions } = setupView();
    mountFiltersSection(el, store, actions);
    expect(q(el, 'hint').textContent).toBe(
      'Select a collection to filter by its attributes.'
    );
    expect((q(el, 'add') as HTMLButtonElement).disabled).toBe(true);
    actions.setQuery({ collections: ['c1', 'c2'] });
    await actions.loadFields();
    expect(q(el, 'hint').textContent).toBe(
      'Fields shared by all 2 collections.'
    );
    expect((q(el, 'add') as HTMLButtonElement).disabled).toBe(false);
  });

  it('adds a row with typed controls; enum fields get a dropdown', async () => {
    const { el, store } = await ready();
    q(el, 'add').click();
    const row = el.querySelector('[data-row]')!;
    const field = row.querySelector('[data-f="field"]') as HTMLSelectElement;
    expect([...field.options].map(o => o.textContent)).toEqual([
      'Cloud cover',
      'Platform',
      'Relative orbit',
      'Instrument mode'
    ]);
    expect(
      [
        ...(row.querySelector('[data-f="op"]') as HTMLSelectElement).options
      ].map(o => o.value)
    ).toEqual(['=', '!=', '<', '<=', '>', '>=']);
    field.value = 'platform';
    field.dispatchEvent(new Event('change', { bubbles: true }));
    const value = el.querySelector(
      '[data-row] [data-f="value"]'
    ) as HTMLSelectElement;
    expect(value.tagName).toBe('SELECT');
    value.value = 'sentinel-2b';
    value.dispatchEvent(new Event('change', { bubbles: true }));
    expect(store.get().query.filters).toEqual([
      { field: 'platform', op: '=', value: 'sentinel-2b' }
    ]);
  });

  it('typing keeps focus on the same input and shows errors inline', async () => {
    const { el, store } = await ready();
    q(el, 'add').click();
    const input = el.querySelector(
      '[data-row] [data-f="value"]'
    ) as HTMLInputElement;
    input.focus();
    input.value = '1';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.value = '1x';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(el.querySelector('[data-row] [data-f="value"]')).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(el.querySelector('[data-err]')!.textContent).toBe('Enter a number.');
    expect(input.classList.contains('jstex-invalid')).toBe(true);
    input.value = '15';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(store.get().query.filters).toEqual([
      { field: 'eo:cloud_cover', op: '=', value: 15 }
    ]);
    (el.querySelector('[data-remove]') as HTMLElement).click();
    expect(el.querySelectorAll('[data-row]')).toHaveLength(0);
  });
});

describe('filters section — long titles', () => {
  it('the field select carries the full field title as a tooltip', async () => {
    const { el } = await ready();
    q(el, 'add').click();
    expect(
      (el.querySelector('[data-row] [data-f="field"]') as HTMLSelectElement)
        .title
    ).toBe('Cloud cover (eo:cloud_cover)');
  });
});
