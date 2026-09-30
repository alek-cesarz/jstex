/** Results table: own scroll area, sticky header, checkbox + row activation. */
import type { Actions } from '../actions';
import { cloudCover, escapeHtml, formatItemDate, shortId } from '../format';
import { scrollWithin } from '../selection';
import type { Store } from '../store';
import { S } from '../strings';
import type { ExplorerState } from '../types';

type ResultsActions = Pick<Actions, 'activate' | 'toggleSelected'>;

export function mountResults(
  el: HTMLElement,
  store: Store<ExplorerState>,
  actions: ResultsActions
): () => void {
  el.innerHTML = `
    <div class="jstex-results">
      <div class="jstex-results__head"><strong>${escapeHtml(S.results)}</strong> <span class="jstex-muted" data-ref="count"></span></div>
      <div class="jstex-results__scroll" data-ref="scroll">
        <table class="jstex-table">
          <thead data-ref="head"></thead>
          <tbody data-ref="body"></tbody>
        </table>
        <div class="jstex-muted jstex-empty" data-ref="empty"></div>
      </div>
    </div>`;
  const ref = <T extends HTMLElement = HTMLElement>(name: string) =>
    el.querySelector(`[data-ref="${name}"]`) as T;
  const scroll = ref('scroll');
  const body = ref('body');

  const renderRows = (state: ExplorerState) => {
    const withCloud = state.items.some(i => cloudCover(i) !== undefined);
    ref('head').innerHTML =
      `<tr><th></th><th>${S.colId}</th><th>${S.colDatetime}</th><th>${S.colCollection}</th>${
        withCloud ? `<th class="jstex-num">${S.colCloud}</th>` : ''
      }</tr>`;
    body.innerHTML = state.items
      .map(item => {
        const cc = cloudCover(item);
        return `<tr data-id="${escapeHtml(item.id)}">
          <td><input type="checkbox" data-toggle="${escapeHtml(item.id)}" aria-label="${escapeHtml(S.select)}"></td>
          <td class="jstex-mono" title="${escapeHtml(item.id)}">${escapeHtml(shortId(item.id))}</td>
          <td>${escapeHtml(formatItemDate(item))}</td>
          <td>${escapeHtml(item.collection ?? '')}</td>
          ${withCloud ? `<td class="jstex-num">${cc === undefined ? '' : cc.toFixed(1)}</td>` : ''}
        </tr>`;
      })
      .join('');
  };

  const update = (state: ExplorerState, prev: ExplorerState | null) => {
    if (!prev || prev.items !== state.items) renderRows(state);
    const selected = new Set(state.selectedIds);
    body.querySelectorAll<HTMLTableRowElement>('tr[data-id]').forEach(tr => {
      const id = tr.dataset.id!;
      tr.classList.toggle('jstex-active', id === state.activeId);
      (tr.querySelector('input[data-toggle]') as HTMLInputElement).checked =
        selected.has(id);
    });
    const parts = [
      S.loaded(state.items.length),
      S.selected(state.selectedIds.length)
    ];
    if (state.matched !== null) parts.push(S.matched(state.matched));
    ref('count').textContent = state.searched ? parts.join(' · ') : '';
    const empty = ref('empty');
    empty.textContent =
      state.status === 'searching'
        ? S.resultsSearching
        : !state.searched
          ? S.resultsIdle
          : state.items.length
            ? ''
            : S.resultsNone;
    empty.hidden = empty.textContent === '';
    if (state.activeId && prev && prev.activeId !== state.activeId) {
      const row = [...body.querySelectorAll<HTMLElement>('tr[data-id]')].find(
        tr => tr.dataset.id === state.activeId
      );
      if (row)
        scrollWithin(scroll, row, ref('head').getBoundingClientRect().height);
    }
  };

  body.addEventListener('click', e => {
    const target = e.target as HTMLElement;
    const toggle = target.closest<HTMLInputElement>('input[data-toggle]');
    if (toggle) {
      actions.toggleSelected(toggle.dataset.toggle!);
      return;
    }
    const row = target.closest<HTMLTableRowElement>('tr[data-id]');
    if (row) actions.activate(row.dataset.id!);
  });

  update(store.get(), null);
  return store.subscribe(update);
}
