/** Item details: header copy actions, Prev/Next, Properties / Assets / Links. */
import type { Actions } from '../actions';
import { copyText } from '../clipboard';
import {
  cloudCover,
  escapeHtml,
  formatItemDate,
  formatValue,
  selfHref
} from '../format';
import { ICON } from '../icons';
import { neighbour } from '../selection';
import { pythonItemSnippet } from '../snippets';
import type { Store } from '../store';
import { S } from '../strings';
import type { ExplorerState, StacAsset, StacItem } from '../types';

type DetailsActions = Pick<Actions, 'activate'>;
type Section = 'properties' | 'assets' | 'links';

const copyBtn = (text: string) =>
  `<button type="button" class="jstex-icon jstex-copy" data-copy="${escapeHtml(text)}" title="${escapeHtml(S.copy)}" aria-label="${escapeHtml(S.copy)}">${ICON.copy}</button>`;

const actionBtn = (text: string, label: string, icon: string) =>
  `<button type="button" class="jstex-control jstex-btn-sm" data-copy="${escapeHtml(text)}">${icon}<span>${escapeHtml(label)}</span></button>`;

const hrefLine = (href: string, scheme = '') =>
  `<div class="jstex-href">${scheme ? `<span class="jstex-tag">${escapeHtml(scheme)}</span>` : ''}<span class="jstex-mono jstex-href__url">${escapeHtml(href)}</span>${copyBtn(href)}</div>`;

function assetBlock(key: string, a: StacAsset): string {
  const tags = [a.type, ...(a.roles ?? [])]
    .filter(Boolean)
    .map(x => `<span class="jstex-tag">${escapeHtml(x)}</span>`)
    .join('');
  const alternates = Object.entries(a.alternate ?? {})
    .filter(([, alt]) => alt?.href)
    .map(([name, alt]) => hrefLine(alt.href!, name))
    .join('');
  return `<div class="jstex-asset">
    <div class="jstex-asset__head"><span class="jstex-tag jstex-tag--key jstex-mono">${escapeHtml(key)}</span>${
      a.title
        ? `<span class="jstex-asset__title">${escapeHtml(a.title)}</span>`
        : ''
    }${tags}</div>
    ${hrefLine(a.href)}${alternates}
  </div>`;
}

function renderItem(
  item: StacItem,
  index: number,
  total: number,
  open: Record<Section, boolean>
): string {
  const self = selfHref(item);
  const props = Object.keys(item.properties ?? {}).sort();
  const assets = Object.entries(item.assets ?? {});
  const links = item.links ?? [];
  const cc = cloudCover(item);
  const sec = (name: Section, title: string, n: number, body: string) =>
    `<details class="jstex-sec" data-section="${name}"${open[name] ? ' open' : ''}>
      <summary class="jstex-sec__head"><span class="jstex-sec__caret">${ICON.chevronRight}</span>${escapeHtml(title)}<span class="jstex-count">${n}</span></summary>
      <div class="jstex-sec__body">${body}</div></details>`;
  const kvRow = (key: string, value: string, copy: string) =>
    `<div class="jstex-kv__row"><dt class="jstex-mono">${escapeHtml(key)}</dt><dd>${value}</dd>${copyBtn(copy)}</div>`;
  return `
    <div class="jstex-details__bar">
      <span class="jstex-details__label">${escapeHtml(S.details)}</span>
      <span class="jstex-toast" data-ref="toast" hidden></span>
      <span class="jstex-details__nav jstex-pager">
        <button type="button" class="jstex-control jstex-btn-sm" data-nav="-1" title="${escapeHtml(S.prevItem)}"${index === 0 ? ' disabled' : ''}>${ICON.chevronLeft}<span>${escapeHtml(S.prev)}</span></button>
        <span class="jstex-pager__pos">${index + 1} / ${total}</span>
        <button type="button" class="jstex-control jstex-btn-sm" data-nav="1" title="${escapeHtml(S.nextItem)}"${index === total - 1 ? ' disabled' : ''}><span>${escapeHtml(S.next)}</span>${ICON.chevronRight}</button>
      </span>
    </div>
    <div class="jstex-details__head">
      <h3 class="jstex-mono jstex-details__id">${escapeHtml(item.id)}</h3>
      <div class="jstex-details__meta">
        ${item.collection ? `<span class="jstex-tag">${escapeHtml(item.collection)}</span>` : ''}
        <span class="jstex-meta">${ICON.clock}${escapeHtml(formatItemDate(item))}</span>
        ${cc === undefined ? '' : `<span class="jstex-meta">${ICON.cloud}${escapeHtml(cc.toFixed(1))} %</span>`}
      </div>
      <div class="jstex-details__actions">
        ${self ? actionBtn(self, S.copySelf, ICON.link) : ''}${actionBtn(item.id, S.copyId, ICON.copy)}${
          self
            ? actionBtn(pythonItemSnippet(self), S.copyPython, ICON.code)
            : ''
        }
      </div>
      <p class="jstex-note">${ICON.info}<span>${escapeHtml(S.pythonHint)}</span></p>
    </div>
    ${sec(
      'properties',
      S.properties,
      props.length,
      `<dl class="jstex-kv">${props
        .map(k => {
          const v = formatValue(item.properties[k]);
          return kvRow(k, `<span class="jstex-val">${escapeHtml(v)}</span>`, v);
        })
        .join('')}</dl>`
    )}
    ${sec('assets', S.assets, assets.length, assets.map(([k, a]) => assetBlock(k, a)).join(''))}
    ${sec(
      'links',
      S.links,
      links.length,
      `<dl class="jstex-kv">${links
        .map(l =>
          kvRow(
            l.rel,
            `<span class="jstex-mono jstex-href__url">${escapeHtml(l.href)}</span>`,
            l.href
          )
        )
        .join('')}</dl>`
    )}`;
}

export function mountDetails(
  el: HTMLElement,
  store: Store<ExplorerState>,
  actions: DetailsActions
): () => void {
  // Open/closed state of the sections lives here, not in the DOM: render() rebuilds it.
  // All start folded; a section the user opens stays open across items.
  const open: Record<Section, boolean> = {
    properties: false,
    assets: false,
    links: false
  };
  el.innerHTML =
    '<section class="jstex-details jstex-card" data-ref="root"></section>';
  const root = el.querySelector('[data-ref="root"]') as HTMLElement;

  const update = (state: ExplorerState, prev: ExplorerState | null) => {
    if (prev && prev.activeId === state.activeId && prev.items === state.items)
      return;
    const index = state.items.findIndex(i => i.id === state.activeId);
    root.innerHTML =
      index === -1
        ? `<p class="jstex-muted">${escapeHtml(S.detailsEmpty)}</p>`
        : renderItem(state.items[index], index, state.items.length, open);
  };

  root.addEventListener(
    'toggle',
    e => {
      const d = e.target as HTMLDetailsElement;
      const name = d.dataset?.section as Section | undefined;
      if (name) open[name] = d.open;
    },
    true
  );
  root.addEventListener('click', async e => {
    const target = e.target as HTMLElement;
    const nav = target.closest<HTMLButtonElement>('button[data-nav]');
    if (nav) {
      const { items, activeId } = store.get();
      const id = neighbour(items, activeId, Number(nav.dataset.nav) as 1 | -1);
      if (id) actions.activate(id);
      return;
    }
    const copy = target.closest<HTMLButtonElement>('button[data-copy]');
    if (copy) {
      const ok = await copyText(copy.dataset.copy ?? '');
      const toast = root.querySelector<HTMLElement>('[data-ref="toast"]');
      if (toast) {
        toast.textContent = ok ? S.copied : S.copyFailed;
        toast.hidden = false;
        setTimeout(() => (toast.hidden = true), 1200);
      }
    }
  });

  update(store.get(), null);
  return store.subscribe(update);
}
