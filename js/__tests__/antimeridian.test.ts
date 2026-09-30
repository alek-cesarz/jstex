/**
 * Tests for antimeridian-crossing geometry splitting.
 */
import { describe, it, expect } from 'vitest';
import { splitAtAntimeridian, crossesAntimeridian } from '../antimeridian';

// ── Test fixtures ────────────────────────────────────────────────

/** Real geometry from CDSE STAC for tile 60UXD crossing the antimeridian. */
const CDSE_ANTIMERIDIAN_POLYGON: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [180, 53.210962645722546],
      [-179.85823009551882, 53.20820137275637],
      [-179.9283215129554, 52.22256603361336],
      [180, 52.22394414182616],
      [178.4649803671648, 52.25345680664421],
      [178.49846042834093, 53.24020834947074],
      [180, 53.210962645722546]
    ]
  ]
};

/** A normal polygon that does NOT cross the antimeridian. */
const NORMAL_POLYGON: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [10, 50],
      [11, 50],
      [11, 51],
      [10, 51],
      [10, 50]
    ]
  ]
};

/** Polygon in the western hemisphere near the antimeridian but not crossing. */
const WESTERN_POLYGON: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [-178, 50],
      [-176, 50],
      [-176, 52],
      [-178, 52],
      [-178, 50]
    ]
  ]
};

/** Polygon in the eastern hemisphere near the antimeridian but not crossing. */
const EASTERN_POLYGON: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [176, 50],
      [179, 50],
      [179, 52],
      [176, 52],
      [176, 50]
    ]
  ]
};

/** A MultiPolygon where one part crosses the antimeridian. */
const MULTI_WITH_CROSSING: GeoJSON.MultiPolygon = {
  type: 'MultiPolygon',
  coordinates: [
    // Normal polygon
    [
      [
        [10, 50],
        [11, 50],
        [11, 51],
        [10, 51],
        [10, 50]
      ]
    ],
    // Crossing polygon (simplified)
    [
      [
        [179, 50],
        [-179, 50],
        [-179, 52],
        [179, 52],
        [179, 50]
      ]
    ]
  ]
};

// ── crossesAntimeridian ──────────────────────────────────────────

describe('crossesAntimeridian', () => {
  it('detects the CDSE antimeridian-crossing polygon', () => {
    expect(crossesAntimeridian(CDSE_ANTIMERIDIAN_POLYGON)).toBe(true);
  });

  it('returns false for a normal polygon', () => {
    expect(crossesAntimeridian(NORMAL_POLYGON)).toBe(false);
  });

  it('returns false for polygon near antimeridian but not crossing (west)', () => {
    expect(crossesAntimeridian(WESTERN_POLYGON)).toBe(false);
  });

  it('returns false for polygon near antimeridian but not crossing (east)', () => {
    expect(crossesAntimeridian(EASTERN_POLYGON)).toBe(false);
  });

  it('detects crossing in MultiPolygon', () => {
    expect(crossesAntimeridian(MULTI_WITH_CROSSING)).toBe(true);
  });

  it('returns false for non-polygon types', () => {
    const point: GeoJSON.Point = { type: 'Point', coordinates: [180, 50] };
    expect(crossesAntimeridian(point)).toBe(false);
  });
});

// ── splitAtAntimeridian ──────────────────────────────────────────

describe('splitAtAntimeridian', () => {
  it('splits the CDSE antimeridian-crossing polygon into MultiPolygon', () => {
    const result = splitAtAntimeridian(CDSE_ANTIMERIDIAN_POLYGON);

    expect(result.type).toBe('MultiPolygon');
    const multi = result as GeoJSON.MultiPolygon;
    expect(multi.coordinates.length).toBe(2);

    // Each part should be a valid polygon (ring with >= 4 positions, closed)
    for (const polyCoords of multi.coordinates) {
      const ring = polyCoords[0];
      expect(ring.length).toBeGreaterThanOrEqual(4);
      // Ring should be closed (first === last)
      expect(ring[0][0]).toBe(ring[ring.length - 1][0]);
      expect(ring[0][1]).toBe(ring[ring.length - 1][1]);
    }
  });

  it('produces parts on each side of ±180 for the CDSE polygon', () => {
    const result = splitAtAntimeridian(
      CDSE_ANTIMERIDIAN_POLYGON
    ) as GeoJSON.MultiPolygon;

    // Find which part is east and which is west
    const parts = result.coordinates.map(polyCoords => {
      const ring = polyCoords[0];
      const lons = ring.map(p => p[0]);
      const nonBoundaryLons = lons.filter(l => Math.abs(l) !== 180);
      return nonBoundaryLons.length > 0
        ? nonBoundaryLons[0] > 0
          ? 'east'
          : 'west'
        : 'boundary';
    });

    expect(parts).toContain('east');
    expect(parts).toContain('west');
  });

  it('eastern part has longitudes in [178, 180] range', () => {
    const result = splitAtAntimeridian(
      CDSE_ANTIMERIDIAN_POLYGON
    ) as GeoJSON.MultiPolygon;

    for (const polyCoords of result.coordinates) {
      const ring = polyCoords[0];
      const lons = ring.map(p => p[0]);
      if (lons.some(l => l > 0 && l < 180)) {
        // This is the eastern part
        for (const lon of lons) {
          expect(lon).toBeGreaterThanOrEqual(178);
          expect(lon).toBeLessThanOrEqual(180);
        }
      }
    }
  });

  it('western part has longitudes in [-180, -179] range', () => {
    const result = splitAtAntimeridian(
      CDSE_ANTIMERIDIAN_POLYGON
    ) as GeoJSON.MultiPolygon;

    for (const polyCoords of result.coordinates) {
      const ring = polyCoords[0];
      const lons = ring.map(p => p[0]);
      if (lons.some(l => l < 0)) {
        // This is the western part
        for (const lon of lons) {
          expect(lon).toBeGreaterThanOrEqual(-180);
          expect(lon).toBeLessThanOrEqual(-179);
        }
      }
    }
  });

  it('returns normal polygon unchanged', () => {
    const result = splitAtAntimeridian(NORMAL_POLYGON);
    expect(result).toEqual(NORMAL_POLYGON);
  });

  it('returns western near-antimeridian polygon unchanged', () => {
    const result = splitAtAntimeridian(WESTERN_POLYGON);
    expect(result).toEqual(WESTERN_POLYGON);
  });

  it('returns eastern near-antimeridian polygon unchanged', () => {
    const result = splitAtAntimeridian(EASTERN_POLYGON);
    expect(result).toEqual(EASTERN_POLYGON);
  });

  it('splits only the crossing part of a MultiPolygon', () => {
    const result = splitAtAntimeridian(MULTI_WITH_CROSSING);

    expect(result.type).toBe('MultiPolygon');
    const multi = result as GeoJSON.MultiPolygon;

    // Should have 3 parts: 1 original normal + 2 from split crossing
    expect(multi.coordinates.length).toBe(3);
  });

  it('returns Point geometry unchanged', () => {
    const point: GeoJSON.Point = { type: 'Point', coordinates: [180, 50] };
    const result = splitAtAntimeridian(point);
    expect(result).toEqual(point);
  });

  it('returns LineString geometry unchanged', () => {
    const line: GeoJSON.LineString = {
      type: 'LineString',
      coordinates: [
        [179, 50],
        [-179, 50]
      ]
    };
    const result = splitAtAntimeridian(line);
    expect(result).toEqual(line);
  });

  it('handles simple symmetric crossing polygon', () => {
    const crossing: GeoJSON.Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [179, 50],
          [-179, 50],
          [-179, 52],
          [179, 52],
          [179, 50]
        ]
      ]
    };

    const result = splitAtAntimeridian(crossing);
    expect(result.type).toBe('MultiPolygon');

    const multi = result as GeoJSON.MultiPolygon;
    expect(multi.coordinates.length).toBe(2);

    // All rings should be closed
    for (const polyCoords of multi.coordinates) {
      const ring = polyCoords[0];
      expect(ring[0][0]).toBe(ring[ring.length - 1][0]);
      expect(ring[0][1]).toBe(ring[ring.length - 1][1]);
    }
  });

  it('does not produce globe-spanning longitude range', () => {
    const result = splitAtAntimeridian(
      CDSE_ANTIMERIDIAN_POLYGON
    ) as GeoJSON.MultiPolygon;

    for (const polyCoords of result.coordinates) {
      const ring = polyCoords[0];
      const lons = ring.map(p => p[0]);
      const lonRange = Math.max(...lons) - Math.min(...lons);
      // Each part should span a small longitude range, not the whole globe
      expect(lonRange).toBeLessThan(10);
    }
  });
});
