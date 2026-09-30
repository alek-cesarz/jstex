import { describe, expect, it } from 'vitest';
import { mountDetails } from '../ui/details';
import { item, setupView as setup } from './helpers';

describe('details', () => {
  it('renders copy targets, sections and navigates', () => {
    const { el, store, actions } = setup();
    mountDetails(el, store, actions);
    expect(el.textContent).toContain('Click a result');
    const a = item('a', {
      assets: {
        B04: {
          href: 'https://x/B04.jp2',
          type: 'image/jp2',
          alternate: { s3: { href: 's3://eodata/B04.jp2' } }
        }
      }
    });
    store.set({ items: [a, item('b')], activeId: 'a' });
    const copies = [
      ...el.querySelectorAll<HTMLButtonElement>('[data-copy]')
    ].map(b => b.dataset.copy);
    expect(copies).toContain(
      'https://stac.test/v1/collections/sentinel-2-l2a/items/a'
    );
    expect(copies).toContain('a');
    expect(copies).toContain(
      'import jstex\n\nitem = jstex.item("https://stac.test/v1/collections/sentinel-2-l2a/items/a")'
    );
    expect(copies).toContain('https://x/B04.jp2');
    expect(copies).toContain('s3://eodata/B04.jp2');
    expect(copies).toContain('4.12');
    const sections = el.querySelectorAll<HTMLDetailsElement>(
      'details[data-section]'
    );
    expect([...sections].map(d => d.open)).toEqual([false, false, false]);
    const navs = el.querySelectorAll<HTMLButtonElement>(
      '.jstex-pager button[data-nav]'
    );
    expect([...navs].map(b => b.textContent!.trim())).toEqual(['Prev', 'Next']);
    expect([...navs].every(b => b.querySelector('svg'))).toBe(true);
    (el.querySelector('button[data-nav="1"]') as HTMLButtonElement).click();
    expect(actions.activate).toHaveBeenCalledWith('b');
    expect(
      (el.querySelector('button[data-nav="1"]') as HTMLButtonElement).disabled
    ).toBe(true);
  });

  it('remembers opened sections across re-render', () => {
    const { el, store, actions } = setup();
    mountDetails(el, store, actions);
    store.set({ items: [item('a'), item('b')], activeId: 'a' });
    const props = el.querySelector<HTMLDetailsElement>(
      'details[data-section="properties"]'
    )!;
    props.open = true;
    props.dispatchEvent(new Event('toggle'));
    store.set({ activeId: 'b' });
    expect(
      el.querySelector<HTMLDetailsElement>(
        'details[data-section="properties"]'
      )!.open
    ).toBe(true);
  });

  it('omits self-link actions when the item has no self link', () => {
    const { el, store, actions } = setup();
    mountDetails(el, store, actions);
    store.set({ items: [item('a', { links: [] })], activeId: 'a' });
    expect(el.textContent).not.toContain('Copy self link');
    expect(el.textContent).toContain('Copy id');
  });
});

describe('details header and copy buttons', () => {
  it('shows collection, date and cloud cover; row copy buttons are labelled icon buttons', () => {
    const { el, store, actions } = setup();
    mountDetails(el, store, actions);
    store.set({ items: [item('a')], activeId: 'a' });
    const meta = el.querySelector('.jstex-details__meta')!.textContent!;
    expect(meta).toContain('sentinel-2-l2a');
    expect(meta).toContain('2024-07-12 10:30Z');
    expect(meta).toContain('4.1');
    const rowCopy = el.querySelector(
      '.jstex-kv [data-copy]'
    ) as HTMLButtonElement;
    expect(rowCopy.getAttribute('aria-label')).toBe('Copy');
    expect(rowCopy.textContent!.trim()).toBe('');
  });
});
