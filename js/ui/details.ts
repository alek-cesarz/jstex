/** Item details: header copy actions, Prev/Next, Properties / Assets / Links. */
import type { Actions } from '../actions';
import { copyText } from '../clipboard';
import { escapeHtml, formatItemDate, formatValue, selfHref } from '../format';
import { neighbour } from '../selection';
import { pythonItemSnippet } from '../snippets';
import type { Store } from '../store';
import { S } from '../strings';
import type { ExplorerState, StacAsset, StacItem } from '../types';

type DetailsActions = Pick<Actions, 'activate'>;
type Section = 'properties' | 'assets' | 'links';

const copyBtn = (text: string, label = S.copy) =>
  `<button type="button" class="jstex-copy" data-copy="${escapeHtml(text)}">${escapeHtml(label)}</button>`;

function assetRow(key: string, a: StacAsset): string {
  const meta = [a.title, a.type, a.roles?.join(', ')]
    .filter(Boolean)
    .map(x => escapeHtml(x))
    .join(' · ');
  const alternates = Object.entries(a.alternate ?? {})
    .filter(([, alt]) => alt?.href)
    .map(
      ([name, alt]) =>
        `<div class="jstex-href"><span class="jstex-muted">${escapeHtml(name)}:</span> <span class="jstex-mono">${escapeHtml(alt.href!)}</span> ${copyBtn(alt.href!)}</div>`
    )
    .join('');
  return `<tr><td class="jstex-mono">${escapeHtml(key)}</td><td>${meta}</td>
    <td><div class="jstex-href"><span class="jstex-mono">${escapeHtml(a.href)}</span> ${copyBtn(a.href)}</div>${alternates}</td></tr>`;
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
  const sec = (name: Section, title: string, n: number, rows: string) =>
    `<details class="jstex-sec" data-section="${name}"${open[name] ? ' open' : ''}>
      <summary>${escapeHtml(title)} (${n})</summary><table class="jstex-table jstex-kv">${rows}</table></details>`;
  return `
    <div class="jstex-details__nav">
      <strong>${escapeHtml(S.details)}</strong>
      <button type="button" data-nav="-1"${index === 0 ? ' disabled' : ''}>${escapeHtml(S.prev)}</button>
      <span class="jstex-muted">${index + 1} / ${total}</span>
      <button type="button" data-nav="1"${index === total - 1 ? ' disabled' : ''}>${escapeHtml(S.next)}</button>
      <span class="jstex-toast" data-ref="toast" hidden></span>
    </div>
    <h3 class="jstex-mono jstex-details__id">${escapeHtml(item.id)}</h3>
    <div class="jstex-muted">${escapeHtml(item.collection ?? '')} · ${escapeHtml(formatItemDate(item))}</div>
    <div class="jstex-details__actions">
      ${self ? copyBtn(self, S.copySelf) : ''}${copyBtn(item.id, S.copyId)}${self ? copyBtn(pythonItemSnippet(self), S.copyPython) : ''}
    </div>
    <p class="jstex-hint">${escapeHtml(S.pythonHint)}</p>
    ${sec(
      'properties',
      S.properties,
      props.length,
      props
        .map(k => {
          const v = formatValue(item.properties[k]);
          return `<tr><td class="jstex-mono">${escapeHtml(k)}</td><td class="jstex-val">${escapeHtml(v)}</td><td>${copyBtn(v)}</td></tr>`;
        })
        .join('')
    )}
    ${sec('assets', S.assets, assets.length, assets.map(([k, a]) => assetRow(k, a)).join(''))}
    ${sec(
      'links',
      S.links,
      links.length,
      links
        .map(
          l =>
            `<tr><td class="jstex-mono">${escapeHtml(l.rel)}</td><td><div class="jstex-href"><span class="jstex-mono">${escapeHtml(l.href)}</span> ${copyBtn(l.href)}</div></td></tr>`
        )
        .join('')
    )}`;
}

export function mountDetails(
  el: HTMLElement,
  store: Store<ExplorerState>,
  actions: DetailsActions
): () => void {
  // Open/closed state of the sections lives here, not in the DOM: render() rebuilds it.
  const open: Record<Section, boolean> = {
    properties: false,
    assets: true,
    links: true
  };
  el.innerHTML = '<section class="jstex-details" data-ref="root"></section>';
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
