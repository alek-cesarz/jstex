/**
 * Attribute filter builder driven by the selected collections' queryables:
 * field (title; key in the tooltip) · operator (by type) · value (dropdown for
 * enums and booleans, text otherwise; IN takes a comma list). Rows are rebuilt
 * only when their structure changes, so typing never loses focus.
 */
import type { Actions } from '../actions';
import { escapeHtml } from '../format';
import { operatorsFor } from '../filters';
import { ICON } from '../icons';
import type { Store } from '../store';
import { S } from '../strings';
import type { ExplorerState, FilterField, FilterRow } from '../types';

type FilterActions = Pick<
  Actions,
  'addFilterRow' | 'updateFilterRow' | 'removeFilterRow'
>;

const option = (value: string, label: string, selected: boolean, title = '') =>
  `<option value="${escapeHtml(value)}"${selected ? ' selected' : ''}${title ? ` title="${escapeHtml(title)}"` : ''}>${escapeHtml(label)}</option>`;

function valueControl(row: FilterRow, field: FilterField | undefined): string {
  const choices =
    field?.type === 'boolean'
      ? ['true', 'false']
      : field?.enum && row.op !== 'IN'
        ? field.enum.map(String)
        : null;
  if (choices) {
    return `<select class="jstex-control" data-f="value" aria-label="${escapeHtml(S.value)}">${option('', S.chooseValue, row.value === '')}${choices
      .map(c => option(c, c, row.value === c))
      .join('')}</select>`;
  }
  const numeric = field?.type === 'number' || field?.type === 'integer';
  return `<input class="jstex-control" data-f="value" type="text" value="${escapeHtml(row.value)}"
    ${numeric && row.op !== 'IN' ? 'inputmode="decimal"' : ''} aria-label="${escapeHtml(S.value)}"
    placeholder="${escapeHtml(row.op === 'IN' ? S.inPlaceholder : S.value)}">`;
}

function rowHtml(row: FilterRow, fields: FilterField[]): string {
  const field = fields.find(f => f.name === row.field);
  const fieldOptions = (
    field
      ? fields
      : [{ name: row.field, title: row.field } as FilterField, ...fields]
  )
    .map(f => option(f.name, f.title, f.name === row.field, f.name))
    .join('');
  const ops = operatorsFor(field?.type ?? 'string');
  return `<div class="jstex-filter" data-row="${row.id}">
    <select class="jstex-control" data-f="field" aria-label="${escapeHtml(S.field)}"
      title="${escapeHtml(field ? `${field.title} (${field.name})` : row.field)}">${fieldOptions}</select>
    <select class="jstex-control" data-f="op" aria-label="${escapeHtml(S.operator)}">${ops.map(o => option(o, o === 'IN' ? 'in' : o, o === row.op)).join('')}</select>
    ${valueControl(row, field)}
    <button type="button" class="jstex-icon" data-remove="${row.id}" title="${escapeHtml(S.removeFilter)}" aria-label="${escapeHtml(S.removeFilter)}">${ICON.close}</button>
    <div class="jstex-hint jstex-hint--err" data-err></div>
  </div>`;
}

export function mountFiltersSection(
  el: HTMLElement,
  store: Store<ExplorerState>,
  actions: FilterActions
): () => void {
  el.innerHTML = `
    <div class="jstex-filter-rows" data-ref="rows"></div>
    <div class="jstex-row jstex-between">
      <button type="button" class="jstex-link" data-ref="add">${ICON.plus}<span>${escapeHtml(S.addFilter)}</span></button>
      <span class="jstex-hint" data-ref="hint"></span>
    </div>`;
  const rowsEl = el.querySelector('[data-ref="rows"]') as HTMLElement;
  const add = el.querySelector('[data-ref="add"]') as HTMLButtonElement;
  const hint = el.querySelector('[data-ref="hint"]') as HTMLElement;
  let structure = '';

  const update = (s: ExplorerState) => {
    const key =
      s.filterRows.map(r => `${r.id}:${r.field}:${r.op}`).join('|') +
      '#' +
      s.fields.map(f => f.name).join(',');
    if (key !== structure) {
      structure = key;
      rowsEl.innerHTML = s.filterRows.map(r => rowHtml(r, s.fields)).join('');
    }
    for (const row of s.filterRows) {
      const rowEl = rowsEl.querySelector<HTMLElement>(`[data-row="${row.id}"]`);
      const err = rowEl?.querySelector<HTMLElement>('[data-err]');
      if (!rowEl || !err) continue;
      err.textContent = row.error;
      err.hidden = !row.error;
      rowEl
        .querySelector('[data-f="value"]')
        ?.classList.toggle('jstex-invalid', Boolean(row.error));
    }
    const n = s.query.collections.length;
    hint.textContent = !n
      ? S.fieldsNeedCollection
      : s.fieldsLoading
        ? S.fieldsLoading
        : s.fieldsError || (s.fields.length ? S.fieldsShared(n) : S.fieldsNone);
    add.disabled = !s.fields.length || s.fieldsLoading;
  };

  const onEdit = (e: Event) => {
    const target = e.target as HTMLInputElement | HTMLSelectElement;
    const rowEl = target.closest<HTMLElement>('[data-row]');
    const f = target.dataset.f as 'field' | 'op' | 'value' | undefined;
    if (!rowEl || !f) return;
    const id = Number(rowEl.dataset.row);
    if (f === 'field') {
      const field = store.get().fields.find(x => x.name === target.value);
      const ops = operatorsFor(field?.type ?? 'string');
      const current = store.get().filterRows.find(r => r.id === id);
      actions.updateFilterRow(id, {
        field: target.value,
        op: current && ops.includes(current.op) ? current.op : ops[0],
        value: ''
      });
    } else {
      actions.updateFilterRow(id, { [f]: target.value });
    }
  };
  // Text inputs report on every keystroke ('input'); selects once ('change').
  rowsEl.addEventListener('input', e => {
    if ((e.target as HTMLElement).tagName === 'INPUT') onEdit(e);
  });
  rowsEl.addEventListener('change', e => {
    if ((e.target as HTMLElement).tagName === 'SELECT') onEdit(e);
  });
  rowsEl.addEventListener('click', e => {
    const remove = (e.target as HTMLElement).closest<HTMLElement>(
      '[data-remove]'
    );
    if (remove) actions.removeFilterRow(Number(remove.dataset.remove));
  });
  add.addEventListener('click', () => actions.addFilterRow());

  update(store.get());
  return store.subscribe((s, prev) => {
    if (
      s.filterRows !== prev.filterRows ||
      s.fields !== prev.fields ||
      s.fieldsLoading !== prev.fieldsLoading ||
      s.fieldsError !== prev.fieldsError ||
      s.query.collections !== prev.query.collections
    ) {
      update(s);
    }
  });
}
