import { describe, expect, it } from 'vitest';
import {
  commitRows,
  filterSummary,
  operatorsFor,
  parseValue,
  rowsFromFilters,
  validate
} from '../filters';
import { S } from '../strings';
import { FIELDS } from './helpers';

const [cloud, platform, orbit, mode] = FIELDS;

describe('filter logic (ported from STEX filter-validation)', () => {
  it('operators depend on the field type', () => {
    expect(operatorsFor('number')).toEqual(['=', '!=', '<', '<=', '>', '>=']);
    expect(operatorsFor('integer')).toEqual(['=', '!=', '<', '<=', '>', '>=']);
    expect(operatorsFor('string')).toEqual(['=', '!=', 'IN']);
    expect(operatorsFor('boolean')).toEqual(['=', '!=']);
  });

  it('parses raw text by type; IN is a comma list', () => {
    expect(parseValue('12.5', cloud, '<=')).toBe(12.5);
    expect(parseValue('abc', cloud, '<=')).toBe('abc');
    expect(parseValue(' a, b ,,c', mode, 'IN')).toEqual(['a', 'b', 'c']);
    expect(
      parseValue('TRUE', { name: 'x', title: 'X', type: 'boolean' }, '=')
    ).toBe(true);
  });

  it('validates numbers, bounds, integers, enums and IN', () => {
    expect(
      validate({ field: 'eo:cloud_cover', op: '<=', value: 20 }, cloud, S)
    ).toBe('');
    expect(
      validate({ field: 'eo:cloud_cover', op: '<=', value: 'x' }, cloud, S)
    ).toBe('Enter a number.');
    expect(
      validate({ field: 'eo:cloud_cover', op: '<=', value: 120 }, cloud, S)
    ).toBe('Must be at most 100.');
    expect(
      validate({ field: 'eo:cloud_cover', op: '>=', value: -1 }, cloud, S)
    ).toBe('Must be at least 0.');
    expect(
      validate({ field: 'sat:relative_orbit', op: '=', value: 1.5 }, orbit, S)
    ).toBe('Enter a whole number.');
    expect(
      validate({ field: 'platform', op: '=', value: 'landsat' }, platform, S)
    ).toBe('Choose one of the listed values.');
    expect(
      validate({ field: 'platform', op: '<=', value: 'x' }, platform, S)
    ).toBe('<= is not allowed for Platform.');
    expect(
      validate({ field: 'platform', op: 'IN', value: [] }, platform, S)
    ).toBe('Enter one or more values, comma-separated.');
  });

  it('commitRows returns valid predicates and flags the rest', () => {
    const rows = [
      {
        id: 1,
        field: 'eo:cloud_cover',
        op: '<=' as const,
        value: '10',
        error: ''
      },
      {
        id: 2,
        field: 'platform',
        op: 'IN' as const,
        value: 'sentinel-2a, sentinel-2b',
        error: ''
      },
      {
        id: 3,
        field: 'sat:relative_orbit',
        op: '=' as const,
        value: '',
        error: 'old'
      },
      { id: 4, field: 'gone', op: '=' as const, value: 'x', error: '' }
    ];
    const { rows: out, filters } = commitRows(rows, FIELDS, S);
    expect(filters).toEqual([
      { field: 'eo:cloud_cover', op: '<=', value: 10 },
      { field: 'platform', op: 'IN', value: ['sentinel-2a', 'sentinel-2b'] }
    ]);
    expect(out.map(r => r.error)).toEqual([
      '',
      '',
      '',
      'Not available for the selected collections.'
    ]);
    // before the fields have loaded, unknown fields are not (yet) an error
    expect(commitRows(rows, [], S).rows[3].error).toBe('');
  });

  it('round-trips filters restored from a query and summarises them', () => {
    let n = 0;
    const rows = rowsFromFilters(
      [{ field: 'platform', op: 'IN', value: ['a', 'b'] }],
      () => ++n
    );
    expect(rows).toEqual([
      { id: 1, field: 'platform', op: 'IN', value: 'a, b', error: '' }
    ]);
    expect(
      filterSummary([{ field: 'eo:cloud_cover', op: '<=', value: 20 }], FIELDS)
    ).toBe('Cloud cover <= 20');
  });
});
