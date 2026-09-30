/**
 * Copied from STEX src/utils/antimeridian.ts @ d360627 — keep in sync by hand.
 */
/**
 * Antimeridian-crossing geometry utilities.
 *
 * STAC catalogs (including CDSE) sometimes return Polygon geometries that
 * cross the antimeridian (±180° longitude) as a single ring mixing positive
 * and negative longitudes. Per RFC 7946 §3.1.9, such geometries should be
 * split into a MultiPolygon with separate parts on each side.
 *
 * Without splitting, map renderers (OpenLayers, Leaflet) draw a polygon
 * that wraps around the entire globe instead of a small region near ±180°.
 */

// ── Types ────────────────────────────────────────────────────────

type Position = number[];
type Ring = Position[];

// ── Detection ────────────────────────────────────────────────────

/**
 * Detect whether a polygon ring crosses the antimeridian.
 *
 * Heuristic: if any consecutive pair of vertices has a longitude jump > 180°,
 * the ring crosses the antimeridian.
 */
function ringCrossesAntimeridian(ring: Ring): boolean {
  for (let i = 0; i < ring.length - 1; i++) {
    const lon1 = ring[i][0];
    const lon2 = ring[i + 1][0];
    if (Math.abs(lon2 - lon1) > 180) {
      return true;
    }
  }
  return false;
}

/**
 * Check whether a geometry crosses the antimeridian.
 */
export function crossesAntimeridian(geom: GeoJSON.Geometry): boolean {
  if (geom.type === 'Polygon') {
    return geom.coordinates.some(ringCrossesAntimeridian);
  }
  if (geom.type === 'MultiPolygon') {
    return geom.coordinates.some(poly => poly.some(ringCrossesAntimeridian));
  }
  return false;
}

// ── Splitting ────────────────────────────────────────────────────

/**
 * Interpolate the latitude where a segment crosses the antimeridian (lon=±180).
 */
function interpolateAtAntimeridian(
  p1: Position,
  p2: Position
): { lat: number; fromEast: boolean } {
  const [lon1, lat1] = p1;
  const [lon2, lat2] = p2;

  // Determine crossing direction
  const fromEast = lon1 > 0;

  // Normalize longitudes so the crossing is continuous:
  // If going east→west (positive→negative), add 360 to the negative lon
  // If going west→east (negative→positive), add 360 to the negative lon
  let nLon1 = lon1;
  let nLon2 = lon2;
  if (fromEast) {
    // e.g., 178 → -179: normalize -179 to 181
    nLon2 = lon2 + 360;
  } else {
    // e.g., -179 → 178: normalize -179 to 181
    nLon1 = lon1 + 360;
  }

  // Linear interpolation: find t where longitude = 180
  const t = (180 - nLon1) / (nLon2 - nLon1);
  const lat = lat1 + t * (lat2 - lat1);

  return { lat, fromEast };
}

/**
 * Split a single polygon ring at the antimeridian into east (+) and west (-) parts.
 *
 * Returns two arrays of partial rings — one for the eastern hemisphere (lon > 0)
 * and one for the western hemisphere (lon < 0). Each may contain multiple
 * disconnected segments.
 */
function splitRing(ring: Ring): { east: Ring[]; west: Ring[] } {
  const east: Ring[] = [];
  const west: Ring[] = [];
  let currentEast: Ring = [];
  let currentWest: Ring = [];

  // Determine which side the first point is on
  const firstLon = ring[0][0];
  let onEast = firstLon >= 0;

  if (onEast) {
    currentEast.push(ring[0]);
  } else {
    currentWest.push(ring[0]);
  }

  for (let i = 0; i < ring.length - 1; i++) {
    const p1 = ring[i];
    const p2 = ring[i + 1];
    const lon1 = p1[0];
    const lon2 = p2[0];

    if (Math.abs(lon2 - lon1) > 180) {
      // Crossing the antimeridian
      const { lat } = interpolateAtAntimeridian(p1, p2);

      if (onEast) {
        // Was on east side, crossing to west
        currentEast.push([180, lat]);
        east.push(currentEast);
        currentEast = [];
        currentWest.push([-180, lat]);
        currentWest.push(p2);
      } else {
        // Was on west side, crossing to east
        currentWest.push([-180, lat]);
        west.push(currentWest);
        currentWest = [];
        currentEast.push([180, lat]);
        currentEast.push(p2);
      }
      onEast = !onEast;
    } else {
      // Normal segment, no crossing
      if (onEast) {
        currentEast.push(p2);
      } else {
        currentWest.push(p2);
      }
    }
  }

  // Flush remaining segments
  if (currentEast.length > 0) east.push(currentEast);
  if (currentWest.length > 0) west.push(currentWest);

  return { east, west };
}

/**
 * Build a closed polygon ring from split segments on one side of the antimeridian.
 * Joins segments along the antimeridian edge (lon=±180).
 */
function buildClosedRing(segments: Ring[], boundaryLon: number): Ring | null {
  if (segments.length === 0) return null;

  // If there's only one segment, close it along the boundary
  if (segments.length === 1) {
    const seg = segments[0];
    const ring = [...seg];
    // Close the ring: last point → boundary → first point
    if (
      ring[0][0] !== ring[ring.length - 1][0] ||
      ring[0][1] !== ring[ring.length - 1][1]
    ) {
      ring.push(ring[0]);
    }
    return ring;
  }

  // Multiple segments: concatenate them, connecting along the antimeridian
  const ring: Ring = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    ring.push(...seg);

    // Connect to next segment along the antimeridian
    if (i < segments.length - 1) {
      const nextSeg = segments[i + 1];
      const lastPt = seg[seg.length - 1];
      const nextPt = nextSeg[0];
      // Both boundary points should already be at ±180, but ensure connection
      if (lastPt[1] !== nextPt[1]) {
        ring.push([boundaryLon, lastPt[1]]);
        ring.push([boundaryLon, nextPt[1]]);
      }
    }
  }

  // Close the ring
  if (ring.length > 0) {
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      ring.push([...first]);
    }
  }

  return ring.length >= 4 ? ring : null;
}

/**
 * Split a single Polygon at the antimeridian into a MultiPolygon.
 */
function splitPolygon(
  polygon: GeoJSON.Polygon
): GeoJSON.MultiPolygon | GeoJSON.Polygon {
  const outerRing = polygon.coordinates[0];

  if (!ringCrossesAntimeridian(outerRing)) {
    return polygon;
  }

  const { east, west } = splitRing(outerRing);

  const polygons: GeoJSON.Position[][][] = [];

  const eastRing = buildClosedRing(east, 180);
  if (eastRing) polygons.push([eastRing]);

  const westRing = buildClosedRing(west, -180);
  if (westRing) polygons.push([westRing]);

  if (polygons.length === 0) return polygon;
  if (polygons.length === 1) {
    return { type: 'Polygon', coordinates: polygons[0] };
  }

  return { type: 'MultiPolygon', coordinates: polygons };
}

// ── Public API ───────────────────────────────────────────────────

/**
 * If a geometry crosses the antimeridian, split it into a MultiPolygon
 * with separate parts on each side. Returns the original geometry unchanged
 * if it does not cross.
 *
 * Handles Polygon and MultiPolygon types. Other geometry types are returned as-is.
 */
export function splitAtAntimeridian(geom: GeoJSON.Geometry): GeoJSON.Geometry {
  try {
    if (geom.type === 'Polygon') {
      return splitPolygon(geom);
    }

    if (geom.type === 'MultiPolygon') {
      let anyCrossing = false;
      const resultPolygons: GeoJSON.Position[][][] = [];

      for (const polyCoords of geom.coordinates) {
        const poly: GeoJSON.Polygon = {
          type: 'Polygon',
          coordinates: polyCoords
        };
        if (polyCoords.some(ringCrossesAntimeridian)) {
          anyCrossing = true;
          const split = splitPolygon(poly);
          if (split.type === 'MultiPolygon') {
            resultPolygons.push(...split.coordinates);
          } else {
            resultPolygons.push(split.coordinates);
          }
        } else {
          resultPolygons.push(polyCoords);
        }
      }

      if (!anyCrossing) return geom;
      return { type: 'MultiPolygon', coordinates: resultPolygons };
    }

    // Point, LineString, etc. — return unchanged
    return geom;
  } catch {
    // Safety net: never break rendering due to splitting failure
    return geom;
  }
}
