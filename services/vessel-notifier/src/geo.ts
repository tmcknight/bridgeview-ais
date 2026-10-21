/** Blue Water Bridge center coordinates */
export const BRIDGE_CENTER = {
  lat: 42.9982,
  lng: -82.423,
};

/** Distance thresholds */
export const CLOSE_APPROACH_DISTANCE_NM = 0.5;

/** Extra NM tracked beyond a watch point's radius so approaches are seen */
export const TRACKING_PADDING_NM = 5;

const DEG_TO_RAD = Math.PI / 180;
const EARTH_RADIUS_NM = 3440.065;

/**
 * Calculate distance between two coordinates using the Haversine formula.
 * Returns distance in nautical miles.
 */
export function haversineDistanceNM(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const dLat = (lat2 - lat1) * DEG_TO_RAD;
  const dLon = (lon2 - lon1) * DEG_TO_RAD;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * DEG_TO_RAD) *
      Math.cos(lat2 * DEG_TO_RAD) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_NM * c;
}

/**
 * Calculate distance from a position to the Blue Water Bridge.
 */
export function distanceToBridge(lat: number, lon: number): number {
  return haversineDistanceNM(lat, lon, BRIDGE_CENTER.lat, BRIDGE_CENTER.lng);
}

/**
 * Find where a vessel moving from `from` to `to` came closest to a point.
 * Uses a local flat-earth projection, which is accurate over the short
 * distances between consecutive AIS reports.
 *
 * `t` is the position of closest approach along the segment: 0 at `from`,
 * 1 at `to`, > 1 when the point is still ahead, < 0 when it was already behind.
 * `distanceNM` is the distance at closest approach, clamped to the segment.
 */
export function closestApproach(
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number,
  pointLat: number,
  pointLon: number
): { t: number; distanceNM: number } {
  const cosLat = Math.cos(pointLat * DEG_TO_RAD);
  const project = (lat: number, lon: number) => ({
    x: (lon - pointLon) * 60 * cosLat,
    y: (lat - pointLat) * 60,
  });

  const a = project(fromLat, fromLon);
  const b = project(toLat, toLon);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;

  // Point is at the origin of the projection
  const t = lengthSq === 0 ? 1 : -(a.x * dx + a.y * dy) / lengthSq;
  const clamped = Math.min(1, Math.max(0, t));
  const distanceNM = Math.hypot(a.x + clamped * dx, a.y + clamped * dy);

  return { t, distanceNM };
}

/**
 * Build an AIS subscription bounding box around a point, padded by
 * `paddingNM` so vessels are tracked before they reach the point.
 */
export function boundingBoxAround(
  lat: number,
  lon: number,
  paddingNM: number
): [[number, number], [number, number]] {
  const dLat = paddingNM / 60;
  const dLon = paddingNM / (60 * Math.cos(lat * DEG_TO_RAD));
  return [
    [lat - dLat, lon - dLon],
    [lat + dLat, lon + dLon],
  ];
}

/**
 * Determine the direction of travel relative to a reference latitude
 * (the bridge by default).
 */
export function getDirection(
  cog: number,
  lat: number,
  refLat: number = BRIDGE_CENTER.lat
): "northbound" | "southbound" {
  const heading = ((cog % 360) + 360) % 360;
  // Northbound: heading roughly 315-45 degrees
  // Southbound: heading roughly 135-225 degrees
  // Default based on position relative to bridge
  if (heading > 315 || heading < 45) return "northbound";
  if (heading > 135 && heading < 225) return "southbound";
  // Ambiguous - use position relative to the reference point
  return lat > refLat ? "southbound" : "northbound";
}
