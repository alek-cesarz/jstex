import { describe, expect, it } from 'vitest';
import { polygonFromDrawDetail } from '../ui/map';

const box: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [10, 45],
      [11, 45],
      [11, 46],
      [10, 46],
      [10, 45]
    ]
  ]
};

describe('polygonFromDrawDetail', () => {
  it('reads the last polygon of a FeatureCollection', () => {
    const fc = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [0, 0] },
          properties: {}
        },
        { type: 'Feature', geometry: box, properties: {} }
      ]
    };
    expect(polygonFromDrawDetail(fc)).toEqual(box);
  });

  it('accepts arrays of features or JSON strings', () => {
    expect(
      polygonFromDrawDetail([
        JSON.stringify({ type: 'Feature', geometry: box })
      ])
    ).toEqual(box);
    expect(polygonFromDrawDetail(['not json'])).toBeNull();
  });

  it('returns null for the empty update fired by discardDrawing()', () => {
    expect(
      polygonFromDrawDetail({ type: 'FeatureCollection', features: [] })
    ).toBeNull();
    expect(polygonFromDrawDetail(null)).toBeNull();
  });
});
