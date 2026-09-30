/**
 * Attribute-filter logic (pure). Operators by field type and validation follow
 * STEX src/utils/filter-validation.ts; values are typed from the raw text of
 * the builder rows. The UI keeps rows (with errors); only valid rows become
 * QueryState filters.
 */
import type { Strings } from './strings';
import type {
  FilterField,
  FilterOp,
  FilterPredicate,
  FilterRow
} from './types';

const NUMERIC_OPS: FilterOp[] = ['=', '!=', '<', '<=', '>', '>='];
const STRING_OPS: FilterOp[] = ['=', '!=', 'IN'];
const BOOLEAN_OPS: FilterOp[] = ['=', '!='];

export function operatorsFor(type: string): FilterOp[] {
  if (type === 'number' || type === 'integer') return [...NUMERIC_OPS];
  if (type === 'string') return [...STRING_OPS];
  return [...BOOLEAN_OPS];
}

/** Raw row text -> typed value (IN: comma-separated list). Unparseable input is kept for validation to report. */
export function parseValue(
  raw: string,
  field: FilterField,
  op: FilterOp
): unknown {
  if (op === 'IN') {
    return raw
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
  }
  if (field.type === 'number' || field.type === 'integer') {
    const n = raw.trim() === '' ? NaN : Number(raw);
    return Number.isNaN(n) ? raw : n;
  }
  if (field.type === 'boolean') {
    const v = raw.trim().toLowerCase();
    return v === 'true' ? true : v === 'false' ? false : raw;
  }
  return raw;
}

export function validate(
  pred: FilterPredicate,
  field: FilterField,
  S: Strings
): string {
  if (!operatorsFor(field.type).includes(pred.op))
    return S.errOperator(pred.op, field.title);
  if (pred.op === 'IN')
    return Array.isArray(pred.value) && pred.value.length ? '' : S.errInList;
  if (field.type === 'number' || field.type === 'integer') {
    if (typeof pred.value !== 'number') return S.errNumber;
    if (field.type === 'integer' && !Number.isInteger(pred.value))
      return S.errInteger;
    if (field.minimum !== undefined && pred.value < field.minimum)
      return S.errMin(field.minimum);
    if (field.maximum !== undefined && pred.value > field.maximum)
      return S.errMax(field.maximum);
    return '';
  }
  if (field.type === 'boolean')
    return typeof pred.value === 'boolean' ? '' : S.errBoolean;
  if (field.enum && !field.enum.includes(pred.value)) return S.errEnum;
  return pred.value === '' ? S.errValue : '';
}

/**
 * Validate every row against the current fields. Returns rows with `error`
 * set and the predicates of the valid, non-empty rows. Rows with an empty
 * value are neither errors nor filters (the user is still typing).
 */
export function commitRows(
  rows: FilterRow[],
  fields: FilterField[],
  S: Strings
): { rows: FilterRow[]; filters: FilterPredicate[] } {
  const byName = new Map(fields.map(f => [f.name, f]));
  const filters: FilterPredicate[] = [];
  const checked = rows.map(row => {
    const field = byName.get(row.field);
    if (!field)
      return { ...row, error: fields.length ? S.errFieldUnavailable : '' };
    if (row.value.trim() === '') return { ...row, error: '' };
    const pred: FilterPredicate = {
      field: row.field,
      op: row.op,
      value: parseValue(row.value, field, row.op)
    };
    const error = validate(pred, field, S);
    if (!error) filters.push(pred);
    return { ...row, error };
  });
  return { rows: checked, filters };
}

/** Rows for filters restored from a query (e.g. ?q= or a re-rendered view). */
export function rowsFromFilters(
  filters: FilterPredicate[],
  nextId: () => number
): FilterRow[] {
  return filters.map(f => ({
    id: nextId(),
    field: f.field,
    op: f.op,
    value: Array.isArray(f.value) ? f.value.join(', ') : String(f.value),
    error: ''
  }));
}

export function filterSummary(
  filters: FilterPredicate[],
  fields: FilterField[]
): string {
  const title = (name: string) =>
    fields.find(f => f.name === name)?.title ?? name;
  return filters
    .map(
      f =>
        `${title(f.field)} ${f.op} ${Array.isArray(f.value) ? f.value.join('|') : String(f.value)}`
    )
    .join(', ');
}
