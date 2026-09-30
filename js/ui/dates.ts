/** Date range (UTC days). Either end may be empty; the search sends it closed (1900 / 2099). */
import type { Actions } from '../actions';
import { dateInputToIso, escapeHtml, isoToDateInput } from '../format';
import { ICON } from '../icons';
import type { Store } from '../store';
import { S } from '../strings';
import type { ExplorerState } from '../types';

export function datesSummary(
  datetime: ExplorerState['query']['datetime']
): string {
  if (!datetime?.from && !datetime?.to) return '';
  return `${isoToDateInput(datetime.from) || S.open} → ${isoToDateInput(datetime.to) || S.open}`;
}

export function mountDates(
  el: HTMLElement,
  store: Store<ExplorerState>,
  actions: Pick<Actions, 'setQuery'>
): () => void {
  el.innerHTML = `
    <div class="jstex-row">
      <input type="date" class="jstex-control jstex-grow" data-ref="from" aria-label="${escapeHtml(S.from)}" title="${escapeHtml(S.from)}">
      <span class="jstex-muted" aria-hidden="true">–</span>
      <input type="date" class="jstex-control jstex-grow" data-ref="to" aria-label="${escapeHtml(S.to)}" title="${escapeHtml(S.to)}">
      <button type="button" class="jstex-icon" data-ref="clear" title="${escapeHtml(S.clearDates)}" aria-label="${escapeHtml(S.clearDates)}">${ICON.close}</button>
    </div>
    <div class="jstex-hint">${escapeHtml(S.datesHint)}</div>`;
  const from = el.querySelector('[data-ref="from"]') as HTMLInputElement;
  const to = el.querySelector('[data-ref="to"]') as HTMLInputElement;
  const clear = el.querySelector('[data-ref="clear"]') as HTMLElement;

  const update = (s: ExplorerState) => {
    const f = isoToDateInput(s.query.datetime?.from);
    const t = isoToDateInput(s.query.datetime?.to);
    if (document.activeElement !== from && from.value !== f) from.value = f;
    if (document.activeElement !== to && to.value !== t) to.value = t;
    clear.hidden = !(f || t);
  };
  const onChange = () => {
    const f = dateInputToIso(from.value, false);
    const t = dateInputToIso(to.value, true);
    actions.setQuery({
      datetime:
        f || t ? { ...(f ? { from: f } : {}), ...(t ? { to: t } : {}) } : null
    });
  };
  from.addEventListener('change', onChange);
  to.addEventListener('change', onChange);
  clear.addEventListener('click', () => {
    from.value = '';
    to.value = '';
    actions.setQuery({ datetime: null });
  });
  update(store.get());
  return store.subscribe((s, prev) => {
    if (s.query.datetime !== prev.query.datetime) update(s);
  });
}
