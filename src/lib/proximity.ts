/**
 * Property-to-property proximity primitives for Field packet grouping.
 *
 * The existing src/lib/projections-distance.ts computes drive time from a
 * hardcoded HQ origin to one destination. Packet clustering needs the
 * pairwise relationship between arbitrary properties, so this adds:
 *   - haversineMiles: zero-dependency straight-line distance (the cheap gate
 *     used for clustering; all active properties already have lat/lng).
 *   - centroid / maxPairwiseMiles: cluster geometry.
 *   - nearestNeighborOrder: a simple walk order through a cluster.
 *   - osrmRouteMinutes: optional refinement reusing the public OSRM server,
 *     generalized to N waypoints (returns null on any failure, like the
 *     existing helper, so callers fall back to straight-line ordering).
 */

export type LatLng = { lat: number; lng: number };

const EARTH_RADIUS_MILES = 3958.8;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function haversineMiles(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function centroid(points: LatLng[]): LatLng | null {
  if (points.length === 0) return null;
  const sum = points.reduce(
    (acc, p) => ({ lat: acc.lat + p.lat, lng: acc.lng + p.lng }),
    { lat: 0, lng: 0 },
  );
  return { lat: sum.lat / points.length, lng: sum.lng / points.length };
}

/** Largest straight-line distance between any two points in the set (the
 *  complete-linkage gate that prevents single-linkage chaining from
 *  producing a too-spread cluster). 0 for a singleton. */
export function maxPairwiseMiles(points: LatLng[]): number {
  let max = 0;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const d = haversineMiles(points[i], points[j]);
      if (d > max) max = d;
    }
  }
  return max;
}

/** Greedy nearest-neighbor visiting order starting from `start` (or the
 *  westernmost point if omitted). Returns indices into `points`. Good
 *  enough for a handful of stops; OSRM can refine later. */
export function nearestNeighborOrder(points: LatLng[], startIndex = 0): number[] {
  const n = points.length;
  if (n <= 2) return points.map((_, i) => i);
  const visited = new Set<number>([startIndex]);
  const order = [startIndex];
  let current = startIndex;
  while (order.length < n) {
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < n; i++) {
      if (visited.has(i)) continue;
      const d = haversineMiles(points[current], points[i]);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    visited.add(best);
    order.push(best);
    current = best;
  }
  return order;
}

/**
 * Total driving minutes across an ordered list of waypoints via the public
 * OSRM server (project-osrm.org), generalizing the single-leg helper in
 * projections-distance.ts. Returns null on any failure (network, no route,
 * fewer than 2 points) so callers can fall back to straight-line estimates.
 */
export async function osrmRouteMinutes(waypoints: LatLng[]): Promise<number | null> {
  if (waypoints.length < 2) return null;
  const coords = waypoints.map((w) => `${w.lng},${w.lat}`).join(';');
  const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=false`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (!r.ok) return null;
    const data = (await r.json()) as { routes?: Array<{ duration: number }> };
    if (!data.routes?.length) return null;
    return Math.round(data.routes[0].duration / 60);
  } catch {
    return null;
  }
}
